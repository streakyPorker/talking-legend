/**
 * RFC-004: 世界状态模块。
 * 提供时间/天气/当前区域/区域列表等世界状态上下文。
 * [强制模块]
 */

import { BaseContextModule } from './base.module';

export class WorldStateModule extends BaseContextModule {
  readonly name = 'world_state';
  readonly mandatory = true;

  renderFull(): string {
    const regions = this.data.regions as Array<{ id: string; name: string; description?: string }> | undefined;
    const worldDesc = (this.data.worldDescription as string) || '';
    const currentDesc = regions?.find((r) => r.id === this.data.currentRegion)?.description || '';
    const npcs = this.data.npcs as Array<{ name: string; role: string; personality: string; location: string; mood: string }> | undefined;
    const currentNpcs = npcs?.filter((n) => n.location === this.data.currentRegion) ?? [];

    const lines = [
      `## 世界设定`,
      worldDesc ? ` ${worldDesc}` : '',
      `## 当前状态`,
      `- 时间：${this.data.timeOfDay ?? '清晨'}`,
      `- 天气：${this.data.weather ?? '晴朗'}`,
      `- 当前位置：${this.data.currentRegionName ?? this.data.currentRegion ?? '未知'} — ${currentDesc}`,
      `- 可探索区域：`,
    ];
    if (regions) {
      for (const r of regions) {
        lines.push(`  · ${r.name}：${r.description || ''}`);
      }
    }
    if (currentNpcs.length > 0) {
      lines.push(`## 当前区域人物`);
      for (const n of currentNpcs) {
        lines.push(`- ${n.name}（${n.role}）：${n.personality} 当前状态：${n.mood}`);
      }
    }
    if (npcs && npcs.length > 0) {
      const otherNpcs = npcs.filter((n) => n.location !== this.data.currentRegion);
      if (otherNpcs.length > 0) {
        lines.push(`## 其他区域人物`);
        for (const n of otherNpcs) {
          lines.push(`- ${n.name}（${n.role}）在${n.location}`);
        }
      }
    }

    return lines.filter(Boolean).join('\n');
  }

  renderCompact(): string {
    return `当前 ${this.data.timeOfDay ?? '清晨'} · ${this.data.weather ?? '晴朗'} · 位于 ${this.data.currentRegion ?? '未知'}`;
  }

  renderMinimal(): string {
    return `${this.data.currentRegion ?? '未知'} · ${this.data.timeOfDay ?? ''}`;
  }
}
