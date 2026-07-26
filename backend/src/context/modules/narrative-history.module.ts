/**
 * RFC-004: 叙事历史模块。
 * 提供近期叙事原文 + 远端摘要。
 */

import { BaseContextModule } from './base.module';
import type { NarrativeHistory } from '../narrative-history';

export class NarrativeHistoryModule extends BaseContextModule {
  readonly name = 'narrative_history';
  readonly mandatory = false;

  renderFull(): string {
    const history = this.data.history as NarrativeHistory | undefined;
    if (!history || history.totalRounds === 0) {
      return '暂无叙事历史。';
    }

    const lines: string[] = [];

    if (history.recent.length > 0) {
      lines.push('## 近期事件');
      for (const entry of history.recent) {
        lines.push(`- [第${entry.turn}轮] ${entry.content}`);
      }
    }

    if (history.summary) {
      lines.push('');
      lines.push('## 往事概要');
      lines.push(history.summary);
    }

    return lines.join('\n');
  }

  renderCompact(): string {
    const history = this.data.history as NarrativeHistory | undefined;
    if (!history || history.totalRounds === 0) {
      return '无历史';
    }
    const recentSummary = history.recent
      .map((e) => `[${e.turn}]${e.content.slice(0, 40)}...`)
      .join('; ');
    return `最近${history.recent.length}轮: ${recentSummary}${history.summary ? ' (+往事摘要)' : ''}`;
  }

  renderMinimal(): string {
    const history = this.data.history as NarrativeHistory | undefined;
    return history?.totalRounds ? `${history.totalRounds}轮历史` : '无历史';
  }
}
