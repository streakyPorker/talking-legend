/**
 * RFC-005: ContextProvider 单元测试。
 *
 * Mock 所有外部依赖（repositories / WorldConfigService / NarrativeService），
 * 验证 buildGMContext 数据映射 + 组装正确性。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextProvider } from './context-provider';
import type { WorldState } from '@talking-legend/shared';
import type { PlayerState } from '@talking-legend/shared';
import type { NPCState } from '@talking-legend/shared';
import type { StorylineState } from '../db/repositories/storyline.repository';
import type { AssembledContext } from '../context/context-module.interface';

// ── Helpers: 最小化的 factory ──────────────────────────────

function makeWorldState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    name: 'village',
    description: '宁静的村庄',
    currentRegion: 'village_center',
    timeOfDay: '清晨',
    weather: '晴朗',
    regions: [
      { id: 'village_center', name: '村中心', description: '村子的中心广场', connectedRegions: ['forest_edge'] },
      { id: 'forest_edge', name: '森林边缘', description: '密林的入口', connectedRegions: ['village_center'] },
    ],
    globalEvents: [],
    ...overrides,
  };
}

function makePlayerState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    name: '冒险者',
    location: 'village_center',
    inventory: ['老旧的地图', '干粮'],
    reputation: { village: 10 },
    quests: [
      { id: 'q1', title: '寻找失落的徽章', description: '在森林中找到失踪骑士的徽章', status: 'active', progress: 0 },
    ],
    ...overrides,
  };
}

function makeStorylineState(overrides: Partial<StorylineState> = {}): StorylineState {
  return {
    currentStage: 'intro',
    stageData: {},
    completedStages: [],
    activeEvents: ['奇怪的嚎叫声从森林传来', '村庄井水干涸'],
    ...overrides,
  };
}

function makeNarrativeText(entries: Array<{ turn: number; content: string }> = []): string {
  if (entries.length === 0) return '';
  return entries.map((e) => `- [第${e.turn}轮] ${e.content}`).join('\n');
}

// ── Factory: 创建 ContextProvider（依赖注入全部 mock） ─────

interface MockDeps {
  worldRepo: { findByGameId: ReturnType<typeof vi.fn> };
  playerRepo: { findByGameId: ReturnType<typeof vi.fn> };
  npcRepo: { findByGameId: ReturnType<typeof vi.fn> };
  storylineRepo: { findByGameId: ReturnType<typeof vi.fn> };
  worldConfig: { getWorld: ReturnType<typeof vi.fn> };
  narrativeService: { getRecentHistory: ReturnType<typeof vi.fn> };
  travelLogRepo: { getRecent: ReturnType<typeof vi.fn> };
}

function createProvider(overrides: Partial<MockDeps> = {}): { provider: ContextProvider; deps: MockDeps } {
  const deps: MockDeps = {
    worldRepo: { findByGameId: vi.fn().mockReturnValue(undefined) },
    playerRepo: { findByGameId: vi.fn().mockReturnValue(undefined) },
    npcRepo: { findByGameId: vi.fn().mockReturnValue([]) },
    storylineRepo: { findByGameId: vi.fn().mockReturnValue(undefined) },
    worldConfig: { getWorld: vi.fn().mockReturnValue(undefined) },
    narrativeService: { getRecentHistory: vi.fn().mockReturnValue('') },
    travelLogRepo: { getRecent: vi.fn().mockReturnValue([]) },
    ...overrides,
  };

  // ContextProvider constructor uses @Inject for each dependency.
  // In tests we bypass Nest DI: cast to unknown then ContextProvider,
  // since the class is plain TS and decorators don't affect runtime.
  const provider = new ContextProvider(
    Symbol('DB_INSTANCE') as never,
    deps.worldRepo as never,
    deps.npcRepo as never,
    deps.playerRepo as never,
    deps.storylineRepo as never,
    deps.worldConfig as never,
    deps.narrativeService as never,
    deps.travelLogRepo as never,
  );

  return { provider, deps };
}

// ── Tests ──────────────────────────────────────────────────

describe('ContextProvider', () => {
  const BUDGET = 200000;

  describe('buildGMContext', () => {
    it('返回 AssembledContext 含 systemPrompt 和 tokenEstimate', async () => {
      const { provider, deps } = createProvider({
        worldRepo: {
          findByGameId: vi.fn().mockReturnValue(makeWorldState()),
        },
        playerRepo: {
          findByGameId: vi.fn().mockReturnValue(makePlayerState()),
        },
        storylineRepo: {
          findByGameId: vi.fn().mockReturnValue(makeStorylineState()),
        },
        worldConfig: {
          getWorld: vi.fn().mockReturnValue({
            id: 'village',
            name: 'village',
            description: '宁静的村庄',
            startingRegion: 'village_center',
            regions: [
              { id: 'village_center', name: '村中心', description: '村子的中心广场', connectedRegions: ['forest_edge'] },
              { id: 'forest_edge', name: '森林边缘', description: '密林的入口', connectedRegions: ['village_center'] },
            ],
            npcs: [],
          }),
        },
        narrativeService: {
          getRecentHistory: vi.fn().mockReturnValue(
            makeNarrativeText([
              { turn: 0, content: '你踏入村庄，阳光洒在石板路上。' },
              { turn: 1, content: '一位老人向你走来，神色焦急。' },
            ]),
          ),
        },
      });

      const result = await provider.buildGMContext('game-1', BUDGET);

      // 类型检查
      expect(result).toBeDefined();
      expect(typeof result.systemPrompt).toBe('string');
      expect(typeof result.tokenEstimate).toBe('number');

      // 内容检查
      expect(result.systemPrompt.length).toBeGreaterThan(0);
      expect(result.tokenEstimate).toBeGreaterThan(0);

      // systemPrompt 应包含 key 数据
      expect(result.systemPrompt).toContain('世界设定');
      expect(result.systemPrompt).toContain('清晨');
      expect(result.systemPrompt).toContain('晴朗');
      expect(result.systemPrompt).toContain('village_center');

      expect(result.systemPrompt).toContain('玩家状态');
      expect(result.systemPrompt).toContain('冒险者');
      expect(result.systemPrompt).toContain('老旧的地图');

      expect(result.systemPrompt).toContain('近期事件');
      expect(result.systemPrompt).toContain('你踏入村庄');

      expect(result.systemPrompt).toContain('活跃事件');
      expect(result.systemPrompt).toContain('奇怪的嚎叫声');

      expect(result.systemPrompt).toContain('GM 指引');

      // userPrompt 应为空（不由 ContextProvider 填充）
      expect(result.userPrompt).toBe('');
    });

    it('所有 repo 返回 undefined 也不报错（使用默认值）', async () => {
      const { provider } = createProvider({
        worldRepo: { findByGameId: vi.fn().mockReturnValue(undefined) },
        playerRepo: { findByGameId: vi.fn().mockReturnValue(undefined) },
        storylineRepo: { findByGameId: vi.fn().mockReturnValue(undefined) },
        worldConfig: { getWorld: vi.fn().mockReturnValue(undefined) },
        narrativeService: { getRecentHistory: vi.fn().mockReturnValue('') },
      });

      // 不应抛错
      const result = await provider.buildGMContext('game-1', BUDGET);

      expect(result).toBeDefined();
      expect(result.systemPrompt).toContain('世界设定');
      // 默认值应生效
      expect(result.systemPrompt).toContain('清晨');
      expect(result.systemPrompt).toContain('晴朗');
      expect(result.systemPrompt).toContain('未知');
    });

    it('narrativeService 返回空字符串不报错', async () => {
      const { provider, deps } = createProvider({
        worldRepo: {
          findByGameId: vi.fn().mockReturnValue(makeWorldState()),
        },
        playerRepo: {
          findByGameId: vi.fn().mockReturnValue(makePlayerState()),
        },
        storylineRepo: {
          findByGameId: vi.fn().mockReturnValue(makeStorylineState()),
        },
        worldConfig: {
          getWorld: vi.fn().mockReturnValue({
            id: 'village',
            name: 'village',
            description: 'test',
            startingRegion: 'village_center',
            regions: [],
            npcs: [],
          }),
        },
        narrativeService: {
          getRecentHistory: vi.fn().mockReturnValue(''),
        },
      });

      const result = await provider.buildGMContext('game-2', BUDGET);

      expect(result).toBeDefined();
      // 无历史时应显示"暂无叙事历史"
      expect(result.systemPrompt).toContain('暂无叙事历史');
    });

    it('tokenEstimate > 0', async () => {
      const { provider } = createProvider({
        worldRepo: {
          findByGameId: vi.fn().mockReturnValue(makeWorldState()),
        },
        playerRepo: {
          findByGameId: vi.fn().mockReturnValue(makePlayerState()),
        },
        storylineRepo: {
          findByGameId: vi.fn().mockReturnValue(makeStorylineState()),
        },
        worldConfig: {
          getWorld: vi.fn().mockReturnValue({
            id: 'village',
            name: 'village',
            description: 'test',
            startingRegion: 'village_center',
            regions: [],
            npcs: [],
          }),
        },
        narrativeService: {
          getRecentHistory: vi.fn().mockReturnValue(
            makeNarrativeText([
              { turn: 0, content: '事件一。' },
              { turn: 1, content: '事件二。' },
              { turn: 2, content: '事件三。' },
            ]),
          ),
        },
      });

      const result = await provider.buildGMContext('game-3', BUDGET);

      // 有数据时 tokenEstimate 必然 > 0
      expect(result.tokenEstimate).toBeGreaterThan(0);
    });

    it('systemPrompt 非空', async () => {
      const { provider } = createProvider({
        worldRepo: {
          findByGameId: vi.fn().mockReturnValue(makeWorldState()),
        },
        playerRepo: {
          findByGameId: vi.fn().mockReturnValue(makePlayerState()),
        },
        storylineRepo: {
          findByGameId: vi.fn().mockReturnValue(makeStorylineState()),
        },
        worldConfig: {
          getWorld: vi.fn().mockReturnValue({
            id: 'village',
            name: 'village',
            description: 'test',
            startingRegion: 'village_center',
            regions: [],
            npcs: [],
          }),
        },
        narrativeService: {
          getRecentHistory: vi.fn().mockReturnValue(
            makeNarrativeText([{ turn: 0, content: '游戏开始。' }]),
          ),
        },
      });

      const result = await provider.buildGMContext('game-4', BUDGET);

      expect(result.systemPrompt.length).toBeGreaterThan(0);
      expect(result.systemPrompt.trim()).not.toBe('');
    });

    it('预算不足时抛出 ContextBudgetExceededError', async () => {
      const { provider } = createProvider({
        worldRepo: {
          findByGameId: vi.fn().mockReturnValue(makeWorldState()),
        },
        playerRepo: {
          findByGameId: vi.fn().mockReturnValue(makePlayerState()),
        },
        storylineRepo: {
          findByGameId: vi.fn().mockReturnValue(makeStorylineState()),
        },
        worldConfig: {
          getWorld: vi.fn().mockReturnValue({
            id: 'village',
            name: 'village',
            description: 'test',
            startingRegion: 'village_center',
            regions: [],
            npcs: [],
          }),
        },
        narrativeService: {
          getRecentHistory: vi.fn().mockReturnValue(''),
        },
      });

      // 1 token 预算，强制模块肯定超
      await expect(
        provider.buildGMContext('game-5', 1),
      ).rejects.toThrow('Context budget exceeded');
    });

    it('scenario_hint 使用 WorldConfig.gmHint 当字段存在时', async () => {
      const { provider } = createProvider({
        worldRepo: {
          findByGameId: vi.fn().mockReturnValue(makeWorldState()),
        },
        playerRepo: { findByGameId: vi.fn().mockReturnValue(makePlayerState()) },
        storylineRepo: { findByGameId: vi.fn().mockReturnValue(undefined) },
        worldConfig: {
          // WorldConfig 不含 gmHint，构造时通过 Record 注入
          getWorld: vi.fn().mockReturnValue({
            id: 'village',
            name: 'village',
            description: 'test',
            startingRegion: 'village_center',
            regions: [],
            npcs: [],
            gmHint: '指引玩家前往森林探索失踪骑士的线索。',
          }),
        },
        narrativeService: { getRecentHistory: vi.fn().mockReturnValue('') },
      });

      const result = await provider.buildGMContext('game-6', BUDGET);

      expect(result.systemPrompt).toContain('指引玩家前往森林探索失踪骑士的线索');
    });

    it('scenario_hint 回退到默认值当 gmHint 不存在', async () => {
      const { provider } = createProvider({
        worldRepo: {
          findByGameId: vi.fn().mockReturnValue(makeWorldState()),
        },
        playerRepo: { findByGameId: vi.fn().mockReturnValue(makePlayerState()) },
        storylineRepo: { findByGameId: vi.fn().mockReturnValue(undefined) },
        worldConfig: {
          getWorld: vi.fn().mockReturnValue({
            id: 'village',
            name: 'village',
            description: 'test',
            startingRegion: 'village_center',
            regions: [],
            npcs: [],
          }),
        },
        narrativeService: { getRecentHistory: vi.fn().mockReturnValue('') },
      });

      const result = await provider.buildGMContext('game-7', BUDGET);

      expect(result.systemPrompt).toContain('无特殊指引');
    });
  });
});
