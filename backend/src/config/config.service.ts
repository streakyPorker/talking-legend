import { Injectable } from '@nestjs/common';
import { LegendLogger } from '../common/logger/legend.logger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as TOML from '@iarna/toml';

interface SettingsFile { env?: Record<string, string>; }

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

  /** config.toml 文件绝对路径（供 Controller 使用） */
  get tomlPath(): string { return path.resolve(__dirname, '..', '..', '..', 'config.toml'); }

  /** 通用 getter：按 tomlPath 返回当前值（供 ConfigController.resolveValue 使用） */
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

  /** 重新从 config.toml 加载配置（热加载用） */
  reloadToml(): void {
    this.loadToml(this.tomlPath);
  }

  // ── private ───────────────────────────────────────────────────

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
