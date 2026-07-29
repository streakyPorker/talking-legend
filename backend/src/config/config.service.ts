import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as TOML from '@iarna/toml';

interface SettingsFile { env?: Record<string, string>; }

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  private settings: SettingsFile | null = null;
  private toml: Record<string, unknown> = {};

  constructor() { this.load(); }

  // ── 优先级: process.env > settings.json > config.toml > 默认值 ──

  /** 按 TOML 路径读取值（如 "anthropic.opus_model"）→ env → settings → toml → default */
  private get(path: string, envKey: string, defaultVal: string): string {
    if (process.env[envKey]) return process.env[envKey]!;
    const sv = this.settings?.env?.[envKey];
    if (sv) return sv;
    const tv = this.tomlGet(path);
    if (tv) return tv;
    return defaultVal;
  }

  private getNum(path: string, envKey: string, defaultVal: number): number {
    return Number(this.get(path, envKey, String(defaultVal)));
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

  get port(): number { return this.getNum('server.port', 'PORT', 4001); }

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

  // 路径
  get dbPath(): string      { return this.get('db.path', 'DB_PATH', path.join(process.cwd(), 'data', 'talking-legend.db')); }
  get gameDataDir(): string { return path.join(process.cwd(), 'data', 'games'); }

  get worldsDir(): string {
    if (process.env.WORLDS_DIR) return process.env.WORLDS_DIR;
    return path.resolve(__dirname, '..', '..', '..', 'worlds');
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
    // 2. config.toml
    const tomlPath = path.resolve(__dirname, '..', '..', '..', 'config.toml');
    this.loadToml(tomlPath);
  }
}
