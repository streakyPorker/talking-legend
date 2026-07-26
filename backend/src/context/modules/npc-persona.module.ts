/**
 * RFC-004: NPC 人设模块。
 * 提供 NPC 的名称/性格/情绪/角色信息。
 * [NPC 对话时强制]
 */

import { BaseContextModule } from './base.module';

export class NpcPersonaModule extends BaseContextModule {
  readonly name = 'npc_persona';
  readonly mandatory = true;

  renderFull(): string {
    return [
      `## NPC 信息`,
      `- 名称：${this.data.npcName ?? '未知'}`,
      `- 角色：${this.data.npcRole ?? '居民'}`,
      `- 位置：${this.data.npcLocation ?? '未知'}`,
      `- 性格：${this.data.npcPersonality ?? '普通'}`,
      `- 当前情绪：${this.data.npcMood ?? '平静'}`,
    ].join('\n');
  }

  renderCompact(): string {
    return `${this.data.npcName ?? 'NPC'}（${this.data.npcRole ?? ''}），情绪${this.data.npcMood ?? '平静'}`;
  }

  renderMinimal(): string {
    return `${this.data.npcName ?? 'NPC'} · ${this.data.npcMood ?? ''}`;
  }
}
