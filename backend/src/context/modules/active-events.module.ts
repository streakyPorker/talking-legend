/**
 * RFC-004: 活跃事件模块。
 * 提供当前活跃的世界事件信息。
 */

import { BaseContextModule } from './base.module';

export class ActiveEventsModule extends BaseContextModule {
  readonly name = 'active_events';
  readonly mandatory = false;

  renderFull(): string {
    const events = this.data.events as string[] | undefined;
    if (!events || events.length === 0) {
      return '当前无活跃事件。';
    }

    return ['## 活跃事件', ...events.map((e) => `- ${e}`)].join('\n');
  }

  renderCompact(): string {
    const events = this.data.events as string[] | undefined;
    if (!events || events.length === 0) {
      return '无活跃事件';
    }
    return `${events.length} 个活跃事件: ${events.join('; ')}`;
  }

  renderMinimal(): string {
    const events = this.data.events as string[] | undefined;
    return events?.length ? `${events.length}个事件` : '无事';
  }
}
