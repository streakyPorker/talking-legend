/**
 * RFC-004: ContextModule 函数级单测
 * 测试每个模块的 render / granularity 输出格式。
 */

import { describe, it, expect } from 'vitest';
import {
  WorldStateModule,
  NpcPersonaModule,
  NpcMemoryModule,
  PlayerStateModule,
  NarrativeHistoryModule,
  ActiveEventsModule,
  ScenarioHintModule,
  IntentInputModule,
} from './index';

import type { ClassifiedMemory } from '../memory-filter';
import type { NarrativeHistory } from '../narrative-history';

// ─── WorldStateModule ─────────────────────────────────────

describe('WorldStateModule', () => {
  const mod = new WorldStateModule();

  it('render includes timeOfDay, weather, currentRegion', () => {
    mod.setData({
      timeOfDay: '黄昏',
      weather: '暴雨',
      currentRegion: 'forest',
      currentRegionName: '低语森林',
      regions: [
        { id: 'village', name: '村庄', description: '宁静的村庄' },
        { id: 'forest', name: '低语森林', description: '古老森林' },
      ],
    });
    const text = mod.renderFull();
    expect(text).toContain('黄昏');
    expect(text).toContain('暴雨');
    expect(text).toContain('低语森林');
    expect(text).toContain('古老森林');
  });

  it('compact returns single-line summary', () => {
    mod.setData({ timeOfDay: '清晨', weather: '晴朗', currentRegion: 'village' });
    const text = mod.renderCompact();
    expect(text).toContain('清晨');
    expect(text).toContain('village');
    // No markdown headers
    expect(text).not.toContain('##');
  });

  it('minimal returns bare identifiers', () => {
    mod.setData({ currentRegion: 'lake', timeOfDay: '午夜' });
    const text = mod.renderMinimal();
    expect(text).toContain('lake');
  });
});

// ─── NpcPersonaModule ─────────────────────────────────────

describe('NpcPersonaModule', () => {
  const mod = new NpcPersonaModule();

  it('render includes all persona fields', () => {
    mod.setData({
      npcName: 'Elder Marin',
      npcRole: 'Village Elder',
      npcLocation: 'village',
      npcPersonality: 'Wise and patient',
      npcMood: 'welcoming',
    });
    const text = mod.renderFull();
    expect(text).toContain('Elder Marin');
    expect(text).toContain('Village Elder');
    expect(text).toContain('welcoming');
  });

  it('compact returns one-line persona', () => {
    mod.setData({ npcName: 'Kael', npcRole: 'Ranger', npcMood: 'cautious' });
    expect(mod.renderCompact()).toContain('cautious');
  });
});

// ─── NpcMemoryModule ──────────────────────────────────────

describe('NpcMemoryModule', () => {
  const mod = new NpcMemoryModule();

  it('render shows no memories when empty', () => {
    mod.setData({ memories: [] });
    expect(mod.renderFull()).toContain('暂无');
  });

  it('render includes important and normal memories', () => {
    const memories: ClassifiedMemory[] = [
      { id: 1, npcId: 'n1', content: '救命之恩', turn: 2, tier: 'important', createdAt: '' },
      { id: 2, npcId: 'n1', content: '问路', turn: 10, tier: 'normal', createdAt: '' },
      { id: 3, npcId: 'n1', content: '你好', turn: 1, tier: 'trivial', createdAt: '' },
    ];
    mod.setData({ memories });
    const text = mod.renderFull();
    expect(text).toContain('[重要] 救命之恩');
    expect(text).toContain('[普通] 问路');
    expect(text).toContain('日常对话');
  });

  it('compact returns memory count summary', () => {
    const memories: ClassifiedMemory[] = [
      { id: 1, npcId: 'n1', content: 'a', turn: 1, tier: 'important', createdAt: '' },
      { id: 2, npcId: 'n1', content: 'b', turn: 2, tier: 'normal', createdAt: '' },
    ];
    mod.setData({ memories });
    const text = mod.renderCompact();
    expect(text).toContain('条');
  });
});

// ─── PlayerStateModule ────────────────────────────────────

describe('PlayerStateModule', () => {
  const mod = new PlayerStateModule();

  it('render includes inventory, reputation, quests', () => {
    mod.setData({
      playerName: 'Alice',
      playerLocation: 'village',
      inventory: ['木剑', '药水'],
      reputation: { village: 10 },
      quests: [{ title: '寻找猎人', status: 'active' }],
    });
    const text = mod.renderFull();
    expect(text).toContain('Alice');
    expect(text).toContain('木剑');
    expect(text).toContain('village:10');
    expect(text).toContain('寻找猎人');
  });

  it('handles empty inventory and quests gracefully', () => {
    mod.setData({ playerName: 'Bob', playerLocation: 'forest' });
    const text = mod.renderFull();
    expect(text).toContain('Bob');
    expect(text).toContain('空');
  });

  it('compact is concise', () => {
    mod.setData({ playerName: 'Alice', playerLocation: 'village', inventory: ['剑'] });
    expect(mod.renderCompact().length).toBeLessThan(mod.renderFull().length);
  });
});

// ─── NarrativeHistoryModule ───────────────────────────────

describe('NarrativeHistoryModule', () => {
  const mod = new NarrativeHistoryModule();

  it('render shows recent entries and summary', () => {
    const history: NarrativeHistory = {
      recent: [
        { turn: 3, content: '玩家进入森林', timestamp: '' },
        { turn: 4, content: '玩家发现古镜', timestamp: '' },
      ],
      summary: '玩家探索了村庄和森林',
      totalRounds: 5,
    };
    mod.setData({ history });
    const text = mod.renderFull();
    expect(text).toContain('玩家进入森林');
    expect(text).toContain('玩家发现古镜');
    expect(text).toContain('玩家探索了村庄和森林');
  });

  it('render shows placeholder when no history', () => {
    mod.setData({ history: { recent: [], summary: null, totalRounds: 0 } });
    expect(mod.renderFull()).toContain('暂无');
  });
});

// ─── ActiveEventsModule ───────────────────────────────────

describe('ActiveEventsModule', () => {
  const mod = new ActiveEventsModule();

  it('render lists events', () => {
    mod.setData({ events: ['森林异常', '村庄庆典'] });
    const text = mod.renderFull();
    expect(text).toContain('森林异常');
    expect(text).toContain('村庄庆典');
  });

  it('render shows no events message when empty', () => {
    mod.setData({ events: [] });
    expect(mod.renderFull()).toContain('无活跃事件');
  });
});

// ─── ScenarioHintModule ───────────────────────────────────

describe('ScenarioHintModule', () => {
  const mod = new ScenarioHintModule();

  it('render shows hint when present', () => {
    mod.setData({ hint: '引导玩家前往湖边' });
    expect(mod.renderFull()).toContain('引导玩家前往湖边');
  });

  it('render shows default message when no hint', () => {
    mod.setData({});
    expect(mod.renderFull()).toContain('自由探索');
  });
});

// ─── IntentInputModule ────────────────────────────────────

describe('IntentInputModule', () => {
  const mod = new IntentInputModule();

  it('render includes player input, labels, npc names', () => {
    mod.setData({
      playerInput: '我问长老关于龙的事',
      intentLabels: ['inquire', 'trade', 'explore'],
      npcNames: ['Elder Marin', 'Ranger Kael'],
    });
    const text = mod.renderFull();
    expect(text).toContain('我问长老关于龙的事');
    expect(text).toContain('inquire');
    expect(text).toContain('Elder Marin');
  });

  it('compact is shorter', () => {
    mod.setData({ playerInput: '探索森林', intentLabels: ['explore'] });
    expect(mod.renderCompact().length).toBeLessThan(mod.renderFull().length);
  });
});
