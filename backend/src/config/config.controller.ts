import {
  Controller,
  Get,
  Put,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from './config.service.js';

// ── 配置 schema 元数据（硬编码） ──────────────────────────────────

interface ConfigItem {
  key: string;
  tomlPath: string;
  label: string;
  type: 'text' | 'number' | 'password';
  hotReload: boolean;
  min?: number;
  max?: number;
  readonly?: boolean;
}

interface ConfigSection {
  key: string;
  label: string;
  restartRequired: boolean;
  items: ConfigItem[];
}

const CONFIG_SCHEMA: ConfigSection[] = [
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
      { key: 'opus', tomlPath: 'model_tiers.opus', label: 'Opus 前缀', type: 'text', hotReload: false, readonly: true },
      { key: 'sonnet', tomlPath: 'model_tiers.sonnet', label: 'Sonnet 前缀', type: 'text', hotReload: false, readonly: true },
      { key: 'haiku', tomlPath: 'model_tiers.haiku', label: 'Haiku 前缀', type: 'text', hotReload: false, readonly: true },
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
      { key: 'timeout_ms', tomlPath: 'llm.stream.timeout_ms', label: '超时 (ms)', type: 'number', hotReload: true, min: 5000, max: 300000 },
    ],
  },
  {
    key: 'npc',
    label: 'NPC 对话',
    restartRequired: false,
    items: [
      { key: 'history_rounds', tomlPath: 'npc.history_rounds', label: '历史轮数', type: 'number', hotReload: true, min: 1, max: 100 },
    ],
  },
];

// ── 响应类型 ─────────────────────────────────────────────────────

interface GetConfigResponse {
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
    }>;
  }>;
}

interface PutConfigRequest {
  changes: Record<string, string | number>;
}

interface PutConfigResponse {
  applied: string[];
  restartRequired: string[];
  errors: string[];
}

// ── TOML 行级替换 ───────────────────────────────────────────────

/**
 * 将 dot-path key 分解为 section header 部分和 key 名称部分。
 * 如 "llm.max_tokens.opus" → { section: "llm.max_tokens", keyName: "opus" }
 * 如 "server.port"      → { section: "server", keyName: "port" }
 * 如 "npc.history_rounds" → { section: "npc", keyName: "history_rounds" }
 */
function parseDotPath(dotPath: string): { section: string; keyName: string } {
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
function applyTomlChange(
  lines: string[],
  section: string,
  key: string,
  value: string,
): boolean {
  let inSection = false;
  let sectionStartIndex = -1;
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
        sectionStartIndex = i;
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

// ── Controller ───────────────────────────────────────────────────

@Controller('config')
export class ConfigController {
  private readonly logger = new Logger(ConfigController.name);

  constructor(private readonly configService: ConfigService) {}

  @Get()
  getConfig(): GetConfigResponse {
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
      })),
    }));

    return { sections };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  updateConfig(@Body() body: PutConfigRequest): PutConfigResponse {
    const changes = body.changes;
    if (!changes || typeof changes !== 'object') {
      return { applied: [], restartRequired: [], errors: ['Invalid body: changes must be an object'] };
    }

    const dotPaths = Object.keys(changes);
    if (dotPaths.length === 0) {
      return { applied: [], restartRequired: [], errors: [] };
    }

    const tomlPath = path.resolve(__dirname, '..', '..', '..', 'config.toml');
    let lines: string[];

    try {
      const content = fs.readFileSync(tomlPath, 'utf-8');
      lines = content.split('\n');
    } catch {
      return { applied: [], restartRequired: [], errors: [`Cannot read config.toml at ${tomlPath}`] };
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

      // 白名单校验：只允许 schema 中声明的 dotPath
      const item = itemByTomlPath.get(dotPath);
      if (!item) {
        errors.push(`${dotPath}: not in config schema`);
        continue;
      }

      // 数字范围校验
      if (item.type === 'number') {
        const num = Number(value);
        if (isNaN(num)) { errors.push(`${dotPath}: must be a number`); continue; }
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

      // 序列化 TOML 值（字符串加引号，数字和布尔值不加）
      const serialized = typeof value === 'string' ? `"${value.replace(/"/g, '\\"')}"` : String(value);

      const replaced = applyTomlChange(lines, parsed.section, parsed.keyName, serialized);

      if (replaced) {
        applied.push(dotPath);

        // 检查是否可热加载
        const schemaItem = itemByTomlPath.get(dotPath);
        if (schemaItem && !schemaItem.hotReload) {
          restartRequired.push(dotPath);
        }
      } else {
        errors.push(`${dotPath}: section [${parsed.section}] not found`);
      }
    }

    // 写回文件
    try {
      fs.writeFileSync(tomlPath, lines.join('\n'), 'utf-8');
    } catch {
      return {
        applied: [],
        restartRequired: [],
        errors: [`Cannot write config.toml at ${tomlPath}`],
      };
    }

    // 热加载
    this.configService.reloadToml();

    return { applied, restartRequired, errors };
  }

  /** 通过 ConfigService 的 getter 获取当前值 */
  private resolveValue(item: ConfigItem): string | number {
    const tomlPath = item.tomlPath;
    // 硬编码映射到 ConfigService 的 getter
    let raw: string | number;

    switch (tomlPath) {
      case 'anthropic.opus_model':
        raw = this.configService.llmOpusModel;
        break;
      case 'anthropic.sonnet_model':
        raw = this.configService.llmSonnetModel;
        break;
      case 'anthropic.haiku_model':
        raw = this.configService.llmHaikuModel;
        break;
      case 'model_tiers.opus':
        raw = this.configService.opusModelPrefixes.join(', ');
        break;
      case 'model_tiers.sonnet':
        raw = this.configService.sonnetModelPrefixes.join(', ');
        break;
      case 'model_tiers.haiku':
        raw = this.configService.haikuModelPrefixes.join(', ');
        break;
      case 'server.port':
        raw = this.configService.port;
        break;
      case 'llm.max_tokens.opus':
        raw = this.configService.llmMaxTokensOpus;
        break;
      case 'llm.max_tokens.sonnet':
        raw = this.configService.llmMaxTokensSonnet;
        break;
      case 'llm.max_tokens.haiku':
        raw = this.configService.llmMaxTokensHaiku;
        break;
      case 'llm.thinking.opus_budget':
        raw = this.configService.llmThinkingOpus;
        break;
      case 'llm.thinking.sonnet_budget':
        raw = this.configService.llmThinkingSonnet;
        break;
      case 'llm.context_budget.opus':
        raw = this.configService.llmContextBudgetOpus;
        break;
      case 'llm.context_budget.sonnet':
        raw = this.configService.llmContextBudgetSonnet;
        break;
      case 'llm.context_budget.haiku':
        raw = this.configService.llmContextBudgetHaiku;
        break;
      case 'llm.stream.timeout_ms':
        raw = this.configService.llmStreamTimeoutMs;
        break;
      case 'npc.history_rounds':
        raw = this.configService.npcHistoryRounds;
        break;
      default:
        raw = '';
    }

    return item.type === 'number' ? Number(raw) : String(raw);
  }
}
