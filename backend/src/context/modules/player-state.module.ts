/**
 * RFC-004: 玩家状态模块。
 * 提供玩家位置/物品/声望/任务信息。
 */

import { BaseContextModule } from './base.module';

export class PlayerStateModule extends BaseContextModule {
  readonly name = 'player_state';
  readonly mandatory = false;

  renderFull(): string {
    const inv = this.data.inventory as string[] | undefined;
    const rep = this.data.reputation as Record<string, number> | undefined;
    const quests = this.data.quests as Array<{ title: string; status: string }> | undefined;

    const lines: string[] = ['## 玩家状态'];
    lines.push(`- 姓名：${this.data.playerName ?? '未知'}`);
    lines.push(`- 位置：${this.data.playerLocation ?? '未知'}`);
    lines.push(`- 物品：${inv?.join('、') ?? '空'}`);

    if (rep && Object.keys(rep).length > 0) {
      const repStr = Object.entries(rep)
        .map(([k, v]) => `${k}:${v}`)
        .join('、');
      lines.push(`- 声望：${repStr}`);
    }

    if (quests && quests.length > 0) {
      const questStr = quests.map((q) => `${q.title}(${q.status})`).join('、');
      lines.push(`- 任务：${questStr}`);
    }

    return lines.join('\n');
  }

  renderCompact(): string {
    const inv = this.data.inventory as string[] | undefined;
    const quests = this.data.quests as Array<{ title: string; status: string }> | undefined;
    return [
      `玩家 ${this.data.playerName ?? '?'} · ${this.data.playerLocation ?? '?'}`,
      inv?.length ? `携带${inv.length}件物品` : '',
      quests?.length ? `${quests.length}个任务` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  renderMinimal(): string {
    return `玩家 ${this.data.playerName ?? '?'} · ${this.data.playerLocation ?? '?'}`;
  }
}
