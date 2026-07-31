import { Injectable } from '@nestjs/common';
import { LegendLogger } from '../common/logger/legend.logger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as TOML from '@iarna/toml';

interface SettingsFile { env?: Record<string, string>; }

// ── 配置 schema 元数据（唯一声明源，controller 不再维护） ──────────

export interface ConfigItem {
  key: string;
  tomlPath: string;
  label: string;
  type: 'text' | 'number' | 'password';
  hotReload: boolean;
  min?: number;
  max?: number;
  readonly?: boolean;
}

export interface ConfigSection {
  key: string;
  label: string;
  restartRequired: boolean;
  items: ConfigItem[];
}

export const CONFIG_SCHEMA: ConfigSection[] = [
  {
    key: 'anthropic',
    label: '模型配置',
    restartRequired: true,
    items: [
      { key: 'opus_model', tomlPath: 'anthropic.opus_model', label: 'Opus 模型', type: 'text', hotReload: false },
      { key: 'sonnet_model', tomlPath: 'anthropic.sonnet_model', label: 'Sonnet 模型', type: 'text', hotReload: false },
      { key: 'haiku_model', tomlPath: 'anthropic.haiku_model', label: 'Haiku 模型', type: 'text', hotReload: false },
    ],
  },
  {
    key: 'model_tiers',
    label: '模型层级前缀',
    restartRequired: true,
    items: [
      { key: 'opus', tomlPath: 'model_tiers.opus', label: 'Opus 前缀', type: 'text', hotReload: false },
      { key: 'sonnet', tomlPath: 'model_tiers.sonnet', label: 'Sonnet 前缀', type: 'text', hotReload: false },
      { key: 'haiku', tomlPath: 'model_tiers.haiku', label: 'Haiku 前缀', type: 'text', hotReload: false },
    ],
  },
  {
    key: 'server',
    label: '服务器',
    restartRequired: true,
    items: [
      { key: 'port', tomlPath: 'server.port', label: '端口', type: 'number', hotReload: false, min: 1, max: 65535 },
    ],
  },
  {
    key: 'llm.max_tokens',
    label: 'Token 预算 (max_tokens)',
    restartRequired: false,
    items: [
      { key: 'opus', tomlPath: 'llm.max_tokens.opus', label: 'Opus', type: 'number', hotReload: true, min: 1, max: 200000 },
      { key: 'sonnet', tomlPath: 'llm.max_tokens.sonnet', label: 'Sonnet', type: 'number', hotReload: true, min: 1, max: 200000 },
      { key: 'haiku', tomlPath: 'llm.max_tokens.haiku', label: 'Haiku', type: 'number', hotReload: true, min: 1, max: 200000 },
    ],
  },
  {
    key: 'llm.thinking',
    label: 'Extended Thinking',
    restartRequired: false,
    items: [
      { key: 'opus_budget', tomlPath: 'llm.thinking.opus_budget', label: 'Opus budget', type: 'number', hotReload: true, min: 0, max: 32000 },
      { key: 'sonnet_budget', tomlPath: 'llm.thinking.sonnet_budget', label: 'Sonnet budget', type: 'number', hotReload: true, min: 0, max: 32000 },
    ],
  },
  {
    key: 'llm.context_budget',
    label: '上下文预算',
    restartRequired: false,
    items: [
      { key: 'opus', tomlPath: 'llm.context_budget.opus', label: 'Opus', type: 'number', hotReload: true, min: 1000, max: 1000000 },
      { key: 'sonnet', tomlPath: 'llm.context_budget.sonnet', label: 'Sonnet', type: 'number', hotReload: true, min: 1000, max: 1000000 },
      { key: 'haiku', tomlPath: 'llm.context_budget.haiku', label: 'Haiku', type: 'number', hotReload: true, min: 1000, max: 1000000 },
    ],
  },
  {
    key: 'llm.stream',
    label: '流式超时',
    restartRequired: false,
    items: [
      { key: 'timeout_ms', tomlPath: 'llm.stream.timeout_ms', label: '超时 (ms)', type: 'number', hotReload: true, min: 1000, max: 300000 },
    ],
  },
  {
    key: 'npc',
    label: 'NPC 对话',
    restartRequired: false,
    items: [
      { key: 'history_rounds', tomlPath: 'npc.history_rounds', label: '历史轮数', type: 'number', hotReload: true, min: 0, max: 100 },
    ],
  },
];

export interface GetConfigResponse {
  sections: Array<{
    key: string;
    label: string;
    restartRequired: boolean;
    items: Array<{
      key: string;
      label: string;
      value: string | number;
      type: string;
      hotReload: boolean;
      readonly: boolean;
      min?: number;
      max?: number;
    }>;
  }>;
}

export interface PutConfigResponse {
  applied: string[];
  restartRequired: string[];
  errors: string[];
}

// ── TOML 行级替换（导出为纯函数，便于单测） ───────────────────

/**
 * 将 dot-path key 分解为 section header 部分和 key 名称部分。
 * 如 "llm.max_tokens.opus" → { section: "llm.max_tokens", keyName: "opus" }
 */
export function parseDotPath(dotPath: string): { section: string; keyName: string } {
  const lastDot = dotPath.lastIndexOf('.');
  if (lastDot === -1) {
    throw new Error(`Invalid dot-path: ${dotPath} — no section prefix`);
  }
  return {
    section: dotPath.slice(0, lastDot),
    keyName: dotPath.slice(lastDot + 1),
  };
}

/**
 * 在 TOML 文件内容中定位 `[section]` 区块，替换或追加 key = value 行。
 * 保留注释和空行。
 */
export function applyTomlChange(
  lines: string[],
  section: string,
  key: string,
  value: string,
): boolean {
  let inSection = false;
  let replaced = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检测 section 头
    const sectionMatch = line.match(/^\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      if (inSection) {
        // 已离开目标 section 且未替换 → 在 section 末尾追加
        break;
      }
      if (sectionMatch[1] === section) {
        inSection = true;
      }
      continue;
    }

    if (!inSection) continue;

    // 检测 key = value 行（跳过注释/空行）
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const existingKey = line.slice(0, eqIndex).trim();
    if (existingKey === key) {
      // 保留缩进，只替换值部分
      const indent = line.slice(0, line.indexOf(line.trim()));
      lines[i] = `${indent}${key} = ${value}`;
      replaced = true;
      break;
    }
  }

  if (!replaced && inSection) {
    // 在 section 末尾追加（最后一个元素之后）
    lines.push(`${key} = ${value}`);
    replaced = true;
  }

  return replaced;
}

@Injectable()
export class ConfigService {
  private readonly logger = new LegendLogger(ConfigService.name);
  private settings: SettingsFile | null = null;
  private toml: Record<string, unknown> = {};

  constructor() { this.load(); }

  // ── 优先级: process.env > settings.json > config.toml > 默认值 ──

  /** 按 TOML 路径读取值（如 "anthropic.opus_model"）→ env → settings → toml → default */
  private get(tomlPath: string, envKey: string, defaultVal: string): string {
    if (process.env[envKey]) return process.env[envKey]!;
    const sv = this.settings?.env?.[envKey];
    if (sv) return sv;
    const tv = this.tomlGet(tomlPath);
    if (tv) return tv;
    return defaultVal;
  }

  private getNum(tomlPath: string, envKey: string, defaultVal: number): number {
    return Number(this.get(tomlPath, envKey, String(defaultVal)));
  }

  /** dot-path 读取嵌套 TOML 值 */
  private tomlGet(dotPath: string): string | undefined {
    const parts = dotPath.split('.');
    let node: unknown = this.toml;
    for (const p of parts) {
      if (typeof node !== 'object' || node === null) return undefined;
      node = (node as Record<string, unknown>)[p];
    }
    return node !== undefined ? String(node) : undefined;
  }

  /** dot-path 读取 TOML 字符串数组 */
  private tomlGetArray(dotPath: string): string[] {
    const parts = dotPath.split('.');
    let node: unknown = this.toml;
    for (const p of parts) {
      if (typeof node !== 'object' || node === null) return [];
      node = (node as Record<string, unknown>)[p];
    }
    return Array.isArray(node) ? node.map(String) : [];
  }

  // ── 模型层级前缀（用于 LLMClient 自动识别模型能力） ──
  get opusModelPrefixes(): string[]   { return this.tomlGetArray('model_tiers.opus'); }
  get sonnetModelPrefixes(): string[] { return this.tomlGetArray('model_tiers.sonnet'); }
  get haikuModelPrefixes(): string[]  { return this.tomlGetArray('model_tiers.haiku'); }

  // ── 公开 getter ──────────────────────────────────────────────

  get port(): number { return this.getNum('server.port', 'PORT', 31943); }

  /** 去除模型名末尾的可选后缀如 [1M]、[128K] */
  private cleanModel(name: string): string { return name.replace(/\[.*\]$/, '').trim(); }

  get llmApiKey(): string    { return this.get('anthropic.api_key', 'ANTHROPIC_AUTH_TOKEN', ''); }
  get llmBaseUrl(): string   { return this.get('anthropic.base_url', 'ANTHROPIC_BASE_URL', 'https://api.anthropic.com'); }
  get llmOpusModel(): string   { return this.cleanModel(this.get('anthropic.opus_model', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'claude-opus-4-8')); }
  get llmSonnetModel(): string { return this.cleanModel(this.get('anthropic.sonnet_model', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'claude-sonnet-4-6')); }
  get llmHaikuModel(): string  { return this.cleanModel(this.get('anthropic.haiku_model', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'claude-haiku-4-5-20251001')); }

  get llmMaxTokensOpus(): number   { return this.getNum('llm.max_tokens.opus', 'LLM_MAX_TOKENS_OPUS', 40960); }
  get llmMaxTokensSonnet(): number { return this.getNum('llm.max_tokens.sonnet', 'LLM_MAX_TOKENS_SONNET', 5120); }
  get llmMaxTokensHaiku(): number  { return this.getNum('llm.max_tokens.haiku', 'LLM_MAX_TOKENS_HAIKU', 512); }

  get llmThinkingOpus(): number   { return this.getNum('llm.thinking.opus_budget', 'LLM_THINKING_BUDGET_OPUS', 4096); }
  get llmThinkingSonnet(): number { return this.getNum('llm.thinking.sonnet_budget', 'LLM_THINKING_BUDGET_SONNET', 2048); }

  get llmStreamTimeoutMs(): number   { return this.getNum('llm.stream.timeout_ms', 'LLM_STREAM_TIMEOUT_MS', 90000); }
  get llmContextBudgetOpus(): number   { return this.getNum('llm.context_budget.opus', 'LLM_CONTEXT_BUDGET_OPUS', 180000); }
  get llmContextBudgetSonnet(): number { return this.getNum('llm.context_budget.sonnet', 'LLM_CONTEXT_BUDGET_SONNET', 50000); }
  get llmContextBudgetHaiku(): number  { return this.getNum('llm.context_budget.haiku', 'LLM_CONTEXT_BUDGET_HAIKU', 8000); }

  get npcHistoryRounds(): number  { return this.getNum('npc.history_rounds', 'NPC_HISTORY_ROUNDS', 20); }

  // 路径
  get dbPath(): string      { return this.get('db.path', 'DB_PATH', path.join(process.cwd(), 'data', 'talking-legend.db')); }
  get gameDataDir(): string { return path.join(process.cwd(), 'data', 'games'); }

  get worldsDir(): string {
    if (process.env.WORLDS_DIR) return process.env.WORLDS_DIR;
    return path.resolve(__dirname, '..', '..', '..', 'worlds');
  }

  /** config.toml 文件绝对路径（供写回使用） */
  get tomlPath(): string { return path.resolve(__dirname, '..', '..', '..', 'config.toml'); }

  /** 通用 getter：按 tomlPath 返回当前值 */
  getTomlValue(tomlPath: string): string | number | undefined {
    const map: Record<string, () => string | number> = {
      'anthropic.opus_model': () => this.llmOpusModel,
      'anthropic.sonnet_model': () => this.llmSonnetModel,
      'anthropic.haiku_model': () => this.llmHaikuModel,
      'model_tiers.opus': () => (this.opusModelPrefixes ?? []).join(', '),
      'model_tiers.sonnet': () => (this.sonnetModelPrefixes ?? []).join(', '),
      'model_tiers.haiku': () => (this.haikuModelPrefixes ?? []).join(', '),
      'server.port': () => this.port,
      'llm.max_tokens.opus': () => this.llmMaxTokensOpus,
      'llm.max_tokens.sonnet': () => this.llmMaxTokensSonnet,
      'llm.max_tokens.haiku': () => this.llmMaxTokensHaiku,
      'llm.thinking.opus_budget': () => this.llmThinkingOpus,
      'llm.thinking.sonnet_budget': () => this.llmThinkingSonnet,
      'llm.context_budget.opus': () => this.llmContextBudgetOpus,
      'llm.context_budget.sonnet': () => this.llmContextBudgetSonnet,
      'llm.context_budget.haiku': () => this.llmContextBudgetHaiku,
      'llm.stream.timeout_ms': () => this.llmStreamTimeoutMs,
      'npc.history_rounds': () => this.getNum('npc.history_rounds', 'NPC_HISTORY_ROUNDS', 20),
    };
    const getter = map[tomlPath];
    return getter ? getter() : undefined;
  }

  // ── 配置中心业务（原 ConfigController 逻辑下沉） ──────────────

  /** 组装配置中心 GET 响应（遍历 CONFIG_SCHEMA + 解析当前值） */
  getConfigData(): GetConfigResponse {
    const sections = CONFIG_SCHEMA.map((section) => ({
      key: section.key,
      label: section.label,
      restartRequired: section.restartRequired,
      items: section.items.map((item) => ({
        key: item.key,
        label: item.label,
        value: this.resolveValue(item),
        type: item.type,
        hotReload: item.hotReload,
        readonly: item.readonly ?? false,
        min: item.min,
        max: item.max,
      })),
    }));
    return { sections };
  }

  /** 应用 PUT 配置修改：白名单校验 + TOML 行级替换 + 写回 + 热加载 */
  applyChanges(changes: Record<string, string | number>): PutConfigResponse {
    if (!changes || typeof changes !== 'object') {
      return { applied: [], restartRequired: [], errors: ['Invalid body: changes must be an object'] };
    }

    const dotPaths = Object.keys(changes);
    if (dotPaths.length === 0) {
      return { applied: [], restartRequired: [], errors: [] };
    }

    const tomlPath = this.tomlPath;
    let lines: string[];

    try {
      const content = fs.readFileSync(tomlPath, 'utf-8');
      lines = content.split('\n');
    } catch {
      return { applied: [], restartRequired: [], errors: ['Cannot read config.toml'] };
    }

    // 构建 schema 查找表：tomlPath → ConfigItem
    const itemByTomlPath = new Map<string, ConfigItem>();
    for (const section of CONFIG_SCHEMA) {
      for (const item of section.items) {
        itemByTomlPath.set(item.tomlPath, item);
      }
    }

    const applied: string[] = [];
    const restartRequired: string[] = [];
    const errors: string[] = [];

    for (const dotPath of dotPaths) {
      const value = changes[dotPath];
      if (value === undefined || value === null) {
        errors.push(`${dotPath}: value is required`);
        continue;
      }
      // 类型守卫：只允许 string 和 number
      if (typeof value !== 'string' && typeof value !== 'number') {
        errors.push(`${dotPath}: value must be a string or number`);
        continue;
      }

      // 白名单校验：只允许 schema 中声明的 dotPath
      const item = itemByTomlPath.get(dotPath);
      if (!item) {
        errors.push(`${dotPath}: not in config schema`);
        continue;
      }

      // 只读字段拒绝写入
      if (item.readonly) {
        errors.push(`${dotPath}: is readonly`);
        continue;
      }

      // 数字范围校验
      if (item.type === 'number') {
        const num = Number(value);
        if (isNaN(num)) { errors.push(`${dotPath}: must be a number`); continue; }
        if (!Number.isInteger(num)) { errors.push(`${dotPath}: must be an integer`); continue; }
        if (item.min !== undefined && num < item.min) { errors.push(`${dotPath}: min ${item.min}`); continue; }
        if (item.max !== undefined && num > item.max) { errors.push(`${dotPath}: max ${item.max}`); continue; }
      }

      let parsed: { section: string; keyName: string };
      try {
        parsed = parseDotPath(dotPath);
      } catch {
        errors.push(`${dotPath}: invalid dot-path`);
        continue;
      }

      // model_tiers.* 是 TOML 数组格式；普通字段字符串加引号，数字不加
      const serialized = this.serializeValue(dotPath, value);

      const replaced = applyTomlChange(lines, parsed.section, parsed.keyName, serialized);

      if (replaced) {
        applied.push(dotPath);
        const schemaItem = itemByTomlPath.get(dotPath);
        if (schemaItem && !schemaItem.hotReload) {
          restartRequired.push(dotPath);
        }
      } else {
        errors.push(`${dotPath}: section [${parsed.section}] not found`);
      }
    }

    // errors 非空且没有有效修改时，跳过写入文件
    if (errors.length > 0 && applied.length === 0) {
      return { applied, restartRequired, errors };
    }

    // 写回文件
    try {
      fs.writeFileSync(tomlPath, lines.join('\n'), 'utf-8');
      this.logger.log(`Config file written to ${tomlPath} (${applied.length} changes)`);
    } catch {
      this.logger.error(`Failed to write config file at ${tomlPath}`);
      return {
        applied: [],
        restartRequired: [],
        errors: ['Cannot write config.toml'],
      };
    }

    // 热加载
    this.reloadToml();

    return { applied, restartRequired, errors };
  }

  /** 恢复默认配置（复制 config.default.toml 覆盖 config.toml） */
  resetToDefault(): { success: boolean; message: string } {
    const tomlPath = this.tomlPath;
    const defaultPath = tomlPath.replace(/\.toml$/, '.default.toml');

    try {
      if (!fs.existsSync(defaultPath)) {
        return { success: false, message: `Default config not found at ${defaultPath}` };
      }
      fs.copyFileSync(defaultPath, tomlPath);
      this.reloadToml();
      this.logger.log('Config reset to defaults');
      return { success: true, message: '已恢复默认配置，部分项需重启后端' };
    } catch (err) {
      this.logger.error('Failed to reset config', (err as Error).message);
      return { success: false, message: '恢复默认配置失败' };
    }
  }

  /** 重新从 config.toml 加载配置（热加载用） */
  reloadToml(): void {
    this.loadToml(this.tomlPath);
  }

  // ── private ───────────────────────────────────────────────────

  /** 通过 getTomlValue 获取当前值（password 类型不回传实际值） */
  private resolveValue(item: ConfigItem): string | number {
    if (item.type === 'password') return '****';

    const raw = this.getTomlValue(item.tomlPath) ?? '';
    const result = item.type === 'number' ? Number(raw) : String(raw);
    // 字符串值序列化时转义换行符
    return typeof result === 'string' ? result.replace(/\n/g, '\\n') : result;
  }

  /** TOML 值序列化：数组 / 字符串（加引号） / 数字（裸值） */
  private serializeValue(dotPath: string, value: string | number): string {
    const isArrayValue = dotPath.startsWith('model_tiers.');
    return isArrayValue
      ? `[${String(value).split(',').map((s) => `"${s.trim().replace(/"/g, '\\"')}"`).join(', ')}]`
      : typeof value === 'string' ? `"${value.replace(/"/g, '\\"')}"` : String(value);
  }

  private get settingsPath(): string {
    return path.join(os.homedir(), '.claude', 'settings.json');
  }

  private loadToml(filePath: string): void {
    try {
      this.toml = TOML.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
      this.logger.log(`Config loaded from ${filePath}`);
    } catch {
      this.toml = {};
      this.logger.warn(`config.toml not found at ${filePath}, using defaults`);
    }
  }

  private load(): void {
    // 1. ~/.claude/settings.json
    try {
      this.settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
      this.logger.log('Settings loaded from ' + this.settingsPath);
    } catch {
      this.settings = null;
      this.logger.warn('settings.json not found, skeleton mode');
    }
    // 2. config.toml（复用 this.tomlPath）
    this.loadToml(this.tomlPath);
  }
}
