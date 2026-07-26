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
    const regions = this.data.regions as Array<{ id: string; name: string }> | undefined;
    const regionNames = regions?.map((r) => r.name).join('、') ?? '未知';

    return [
      `## 世界状态`,
      `- 时间：${this.data.timeOfDay ?? '清晨'}`,
      `- 天气：${this.data.weather ?? '晴朗'}`,
      `- 当前位置：${this.data.currentRegion ?? '未知'}（${this.data.currentRegionName ?? ''}）`,
      `- 可探索区域：${regionNames}`,
    ].join('\n');
  }

  renderCompact(): string {
    return `当前 ${this.data.timeOfDay ?? '清晨'} · ${this.data.weather ?? '晴朗'} · 位于 ${this.data.currentRegion ?? '未知'}`;
  }

  renderMinimal(): string {
    return `${this.data.currentRegion ?? '未知'} · ${this.data.timeOfDay ?? ''}`;
  }
}
