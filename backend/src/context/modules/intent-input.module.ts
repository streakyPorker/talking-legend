/**
 * RFC-004: 意图输入模块。
 * 提供玩家输入文本 + 可用意图标签列表 + 场景 NPC 名。
 * [意图分类时强制]
 */

import { BaseContextModule } from './base.module';

export class IntentInputModule extends BaseContextModule {
  readonly name = 'intent_input';
  readonly mandatory = true;

  renderFull(): string {
    const labels = (this.data.intentLabels as string[]) ?? [];
    const npcNames = (this.data.npcNames as string[]) ?? [];
    const input = (this.data.playerInput as string) ?? '';

    return [
      `## 玩家输入`,
      `"${input}"`,
      `## 可用意图`,
      labels.join(', ') || '(未配置)',
      `## 附近 NPC`,
      npcNames.join(', ') || '无',
    ].join('\n');
  }

  renderCompact(): string {
    const input = (this.data.playerInput as string) ?? '';
    const labels = (this.data.intentLabels as string[]) ?? [];
    return `输入: "${input}" · 意图: ${labels.join(',')}`;
  }

  renderMinimal(): string {
    return `"${(this.data.playerInput as string)?.slice(0, 30) ?? ''}"`;
  }
}
