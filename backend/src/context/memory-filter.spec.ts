/**
 * RFC-004: MemoryFilter 函数级单测
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryFilter, type ClassifiedMemory } from './memory-filter';

function makeMemory(
  overrides: Partial<ClassifiedMemory> = {},
): ClassifiedMemory {
  return {
    id: 1,
    npcId: 'npc-1',
    content: '默认记忆',
    turn: 1,
    tier: 'normal',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('MemoryFilter', () => {
  let filter: MemoryFilter;

  beforeEach(() => {
    filter = new MemoryFilter(10);
  });

  describe('classifyMemory', () => {
    it('classifies betrayal as important', () => {
      const result = filter.classifyMemory('玩家背叛了NPC的信任');
      expect(result.tier).toBe('important');
    });

    it('classifies life-saving as important', () => {
      const result = filter.classifyMemory('玩家救命之恩没齿难忘');
      expect(result.tier).toBe('important');
    });

    it('classifies greeting as trivial', () => {
      const result = filter.classifyMemory('玩家说了你好');
      expect(result.tier).toBe('trivial');
    });

    it('classifies normal conversation as normal', () => {
      const result = filter.classifyMemory('玩家问NPC关于森林的路');
      expect(result.tier).toBe('normal');
    });

    it('falls back to normal on error', () => {
      // Simulate: the heuristic should never throw, but if it did → normal
      const result = filter.classifyMemory('');
      expect(result.tier).toBe('normal');
    });

    it('preserves content in classification result', () => {
      const result = filter.classifyMemory('玩家发现了宝藏');
      expect(result.content).toBe('玩家发现了宝藏');
      expect(result.tier).toBe('important');
    });
  });

  describe('filterForContext', () => {
    it('returns all important memories', () => {
      const memories: ClassifiedMemory[] = [
        makeMemory({ id: 1, tier: 'important', content: '救命之恩', turn: 1 }),
        makeMemory({ id: 2, tier: 'important', content: '背叛', turn: 2 }),
        makeMemory({ id: 3, tier: 'normal', content: '闲聊', turn: 3 }),
      ];
      const result = filter.filterForContext(memories);
      expect(result.important).toHaveLength(2);
      expect(result.normal).toHaveLength(1);
      expect(result.trivialCount).toBe(0);
    });

    it('limits normal memories to the configured limit', () => {
      const filterSmall = new MemoryFilter(3);
      const memories: ClassifiedMemory[] = Array.from(
        { length: 10 },
        (_, i) => makeMemory({ id: i + 1, tier: 'normal', content: `记忆${i}`, turn: i + 1 }),
      );
      const result = filterSmall.filterForContext(memories);
      expect(result.normal).toHaveLength(3);
      // Should be the most recent 3 (highest turn)
      expect(result.normal[0].turn).toBe(10);
      expect(result.normal[1].turn).toBe(9);
      expect(result.normal[2].turn).toBe(8);
    });

    it('counts trivial memories without including content', () => {
      const memories: ClassifiedMemory[] = [
        makeMemory({ id: 1, tier: 'trivial', content: '你好' }),
        makeMemory({ id: 2, tier: 'trivial', content: '再见' }),
        makeMemory({ id: 3, tier: 'trivial', content: '谢谢' }),
      ];
      const result = filter.filterForContext(memories);
      expect(result.important).toHaveLength(0);
      expect(result.normal).toHaveLength(0);
      expect(result.trivialCount).toBe(3);
    });

    it('returns empty filtered state for empty input', () => {
      const result = filter.filterForContext([]);
      expect(result.important).toEqual([]);
      expect(result.normal).toEqual([]);
      expect(result.trivialCount).toBe(0);
    });
  });

  describe('renderContextSummary', () => {
    it('formats important and normal memories with labels', () => {
      const filtered = {
        important: [
          makeMemory({ id: 1, tier: 'important', content: '救命之恩', turn: 2 }),
        ],
        normal: [
          makeMemory({ id: 2, tier: 'normal', content: '问路', turn: 10 }),
        ],
        trivialCount: 5,
      };
      const text = filter.renderContextSummary(filtered);
      expect(text).toContain('[重要] 救命之恩（第2轮）');
      expect(text).toContain('[普通] 问路（第10轮）');
      expect(text).toContain('还有 5 段日常对话未列出');
    });

    it('returns placeholder when no memories', () => {
      const filtered = { important: [], normal: [], trivialCount: 0 };
      expect(filter.renderContextSummary(filtered)).toBe('暂无记忆');
    });

    it('omits trivial line when count is zero', () => {
      const filtered = {
        important: [makeMemory({ id: 1, tier: 'important', content: '秘密', turn: 1 })],
        normal: [],
        trivialCount: 0,
      };
      const text = filter.renderContextSummary(filtered);
      expect(text).not.toContain('日常对话');
    });
  });
});
