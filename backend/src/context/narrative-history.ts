/**
 * RFC-004: 叙事历史分层管理器。
 *
 * 近端 N 轮保留原文，远端通过 Haiku 压缩为摘要。
 * 存储继续使用 narrative-log 纯文本文件。
 */

export interface NarrativeEntry {
  turn: number;
  content: string;
  timestamp: string;
}

export interface NarrativeHistory {
  recent: NarrativeEntry[];
  summary: string | null;
  totalRounds: number;
}

export class NarrativeHistoryManager {
  private entries: NarrativeEntry[] = [];
  private summary: string | null = null;

  /** 近端保留轮数 */
  private readonly recentCount: number;

  constructor(recentCount = 5) {
    this.recentCount = recentCount;
  }

  /** 追加新叙事条目 */
  append(turn: number, content: string): void {
    this.entries.push({
      turn,
      content,
      timestamp: new Date().toISOString(),
    });
  }

  /** 获取最近 n 轮原文 */
  getRecent(n?: number): NarrativeEntry[] {
    const count = n ?? this.recentCount;
    return this.entries.slice(-count);
  }

  /** 获取远端摘要 */
  getSummary(): string | null {
    return this.summary;
  }

  /** 更新远端摘要（由 Haiku 异步生成后写入） */
  updateSummary(summary: string): void {
    this.summary = summary;
  }

  /** 获取完整历史结构（供 NpcHistoryModule 使用） */
  getHistory(): NarrativeHistory {
    return {
      recent: this.getRecent(),
      summary: this.summary,
      totalRounds: this.entries.length,
    };
  }

  /** 远端条目数（近端之外的轮数） */
  getArchivedCount(): number {
    return Math.max(0, this.entries.length - this.recentCount);
  }

  /** 总轮数 */
  get totalRounds(): number {
    return this.entries.length;
  }
}
