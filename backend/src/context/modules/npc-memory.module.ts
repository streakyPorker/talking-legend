/**
 * RFC-004: NPC 记忆模块。
 * 提供 NPC 对玩家的记忆（分级过滤后）。
 */

import { BaseContextModule } from './base.module';
import { MemoryFilter, type ClassifiedMemory } from '../memory-filter';

export class NpcMemoryModule extends BaseContextModule {
  readonly name = 'npc_memory';
  readonly mandatory = false;

  private readonly memoryFilter = new MemoryFilter();

  renderFull(): string {
    const memories = this.data.memories as ClassifiedMemory[] | undefined;
    if (!memories || memories.length === 0) {
      return '暂无对此玩家的记忆。';
    }

    const filtered = this.memoryFilter.filterForContext(memories);
    return `## NPC 对玩家的记忆\n${this.memoryFilter.renderContextSummary(filtered)}`;
  }

  renderCompact(): string {
    const memories = this.data.memories as ClassifiedMemory[] | undefined;
    if (!memories || memories.length === 0) {
      return '无记忆';
    }
    const filtered = this.memoryFilter.filterForContext(memories);
    const count = filtered.important.length + filtered.normal.length;
    let result = `${count} 条相关记忆`;
    if (filtered.trivialCount > 0) {
      result += `（+${filtered.trivialCount} 段日常）`;
    }
    return result;
  }

  renderMinimal(): string {
    const memories = this.data.memories as ClassifiedMemory[] | undefined;
    const count = memories?.length ?? 0;
    return count > 0 ? `${count}条记忆` : '无记忆';
  }
}
