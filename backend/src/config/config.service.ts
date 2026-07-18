import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface SettingsFile {
  env?: Record<string, string>;
}

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  private settings: SettingsFile | null = null;

  constructor() {
    this.load();
  }

  get port(): number { return 3001; }

  // LLM — 全部来自 settings.json
  get llmApiKey(): string    { return this.getEnv('ANTHROPIC_AUTH_TOKEN') ?? ''; }
  get llmBaseUrl(): string   { return this.getEnv('ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com'; }
  get llmOpusModel(): string   { return this.getEnv('ANTHROPIC_DEFAULT_OPUS_MODEL')?? 'claude-opus-4-8'; }
  get llmSonnetModel(): string { return this.getEnv('ANTHROPIC_DEFAULT_SONNET_MODEL')?? 'claude-sonnet-4-6'; }
  get llmHaikuModel(): string  { return this.getEnv('ANTHROPIC_DEFAULT_HAIKU_MODEL')?? 'claude-haiku-4-5-20251001'; }

  // 路径
  get dbPath(): string      { return path.join(process.cwd(), 'data', 'talking-legend.db'); }
  get worldsDir(): string   { return path.join(process.cwd(), '..', 'worlds'); }
  get gameDataDir(): string { return path.join(process.cwd(), 'data', 'games'); }

  private get settingsPath(): string {
    return path.join(os.homedir(), '.claude', 'settings.json');
  }

  private load(): void {
    try {
      this.settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
      this.logger.log('Settings loaded from ' + this.settingsPath);
    } catch {
      this.settings = null;
      this.logger.warn('settings.json not found, running in skeleton mode');
    }
  }

  private getEnv(key: string): string | undefined {
    return this.settings?.env?.[key];
  }
}
