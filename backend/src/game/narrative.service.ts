import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { appendNarrative, readNarrative } from '../utils/narrative-log';

@Injectable()
export class NarrativeService {
  constructor(private readonly config: ConfigService) {}

  /**
   * 追加一轮叙事到文件 — 同步操作。
   * 每行格式：`[turn] content`
   */
  append(gameId: string, turn: number, content: string): void {
    const line = `[${turn}] ${content}`;
    appendNarrative(this.config.gameDataDir, gameId, line);
  }

  /**
   * 读取最近 N 轮叙事，返回结构化 Markdown。
   * 将原始格式 `[turn] content` 转换为 `- [第turn轮] content`
   */
  getRecentHistory(gameId: string, recentCount = 5): string {
    const raw = readNarrative(this.config.gameDataDir, gameId);
    if (!raw) return '';
    const lines = raw.trim().split('\n');
    const recent = lines.slice(-recentCount);
    return recent
      .map(line => line.replace(/^\[(\d+)\]/, '- [第$1轮]'))
      .join('\n');
  }
}
