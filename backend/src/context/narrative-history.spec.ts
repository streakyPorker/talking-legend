/**
 * RFC-004: NarrativeHistoryManager 函数级单测
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NarrativeHistoryManager } from './narrative-history';

describe('NarrativeHistoryManager', () => {
  let manager: NarrativeHistoryManager;

  beforeEach(() => {
    manager = new NarrativeHistoryManager(5); // 近端保留 5 轮
  });

  it('starts with empty history', () => {
    expect(manager.totalRounds).toBe(0);
    expect(manager.getRecent()).toEqual([]);
    expect(manager.getSummary()).toBeNull();
  });

  it('append adds new entry and increments totalRounds', () => {
    manager.append(1, '玩家进入了村庄。');
    expect(manager.totalRounds).toBe(1);
    expect(manager.getRecent()).toHaveLength(1);
    expect(manager.getRecent()[0].turn).toBe(1);
    expect(manager.getRecent()[0].content).toBe('玩家进入了村庄。');
  });

  it('getRecent returns only the last N entries', () => {
    for (let i = 1; i <= 10; i++) {
      manager.append(i, `第${i}轮叙事`);
    }
    const recent = manager.getRecent();
    expect(recent).toHaveLength(5);
    expect(recent[0].turn).toBe(6);
    expect(recent[4].turn).toBe(10);
  });

  it('getRecent with custom count returns specified number', () => {
    for (let i = 1; i <= 10; i++) {
      manager.append(i, `叙事 ${i}`);
    }
    expect(manager.getRecent(3)).toHaveLength(3);
    expect(manager.getRecent(10)).toHaveLength(10);
  });

  it('updateSummary sets and getSummary returns the summary', () => {
    manager.updateSummary('玩家曾探索村庄、与游侠交谈。');
    expect(manager.getSummary()).toBe('玩家曾探索村庄、与游侠交谈。');
    // overwrite
    manager.updateSummary('新的摘要内容');
    expect(manager.getSummary()).toBe('新的摘要内容');
  });

  it('getHistory returns complete structure', () => {
    manager.append(1, '第一轮');
    manager.append(2, '第二轮');
    manager.updateSummary('摘要');

    const history = manager.getHistory();
    expect(history.recent).toHaveLength(2);
    expect(history.summary).toBe('摘要');
    expect(history.totalRounds).toBe(2);
  });

  it('getArchivedCount returns entries beyond recent window', () => {
    for (let i = 1; i <= 8; i++) {
      manager.append(i, `叙事${i}`);
    }
    expect(manager.getArchivedCount()).toBe(3); // 8 - 5 = 3
  });

  it('getArchivedCount returns 0 when entries <= recent limit', () => {
    manager.append(1, '第一轮');
    manager.append(2, '第二轮');
    expect(manager.getArchivedCount()).toBe(0);
  });
});
