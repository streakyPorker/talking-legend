/**
 * RFC-005: ContextProvider — DB 与 ContextBuilder 管线之间的数据注入层。
 *
 * 职责：
 *   1. 读取 DB 数据（world / player / npcs / storyline / narrative）
 *   2. 创建 ContextModule 实例并 setData() 注入数据
 *   3. 注册到 Map → 交由 GMContextBuilder.build() 组装
 *
 * 本文件不修改任何 ContextModule 源码，仅做数据映射与注入。
 */

import { Injectable, Inject } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { DB_INSTANCE } from '../db/tokens';
import { WorldRepository } from '../db/repositories/world.repository';
import { NpcRepository } from '../db/repositories/npc.repository';
import { PlayerRepository } from '../db/repositories/player.repository';
import { StorylineRepository } from '../db/repositories/storyline.repository';
import { WorldConfigService } from '../world-config/world-config.service';
import { NarrativeService } from './narrative.service';
import type { ContextModule, AssembledContext } from '../context/context-module.interface';
import type { NarrativeHistory, NarrativeEntry } from '../context/narrative-history';
import { GMContextBuilder, NpcContextBuilder } from '../context/context-builder';
import {
  WorldStateModule,
  PlayerStateModule,
  NarrativeHistoryModule,
  ActiveEventsModule,
  ScenarioHintModule,
  NpcPersonaModule,
  NpcMemoryModule,
} from '../context/modules';
import type { ClassifiedMemory } from '../context/memory-filter';

@Injectable()
export class ContextProvider {
  constructor(
    @Inject(DB_INSTANCE) private readonly db: Database.Database,
    @Inject(WorldRepository) private readonly worldRepo: WorldRepository,
    @Inject(NpcRepository) private readonly npcRepo: NpcRepository,
    @Inject(PlayerRepository) private readonly playerRepo: PlayerRepository,
    @Inject(StorylineRepository) private readonly storylineRepo: StorylineRepository,
    @Inject(WorldConfigService) private readonly worldConfig: WorldConfigService,
    @Inject(NarrativeService) private readonly narrativeService: NarrativeService,
  ) {}

  /**
   * 为 GM 叙事调用组装完整上下文。
   *
   * @param gameId  游戏 ID
   * @param budget   token 预算上限（如 200000 for Opus）
   * @returns        AssembledContext（含 systemPrompt + tokenEstimate）
   */
  async buildGMContext(gameId: string, budget: number): Promise<AssembledContext> {
    // ── 1. 读取 DB 数据 ──────────────────────────────────────
    const world = this.worldRepo.findByGameId(gameId);
    const player = this.playerRepo.findByGameId(gameId);
    const storyline = this.storylineRepo.findByGameId(gameId);

    // WorldConfig 按 world.name 匹配（name 即目录名/id）
    const worldCfg = world
      ? this.worldConfig.getWorld(world.name)
      : undefined;

    // NarrativeService 返回格式化文本，需转换为 NarrativeHistory
    const narrativeText = this.narrativeService.getRecentHistory(gameId);

    // ── 2. 创建模块实例 + setData 注入 ─────────────────────

    const modules = new Map<string, ContextModule>();

    // 读取 NPC 列表
    const npcs = this.npcRepo.findByGameId(gameId);

    // world_state（强制）— 注入完整世界描述+区域详情+NPC
    const worldModule = new WorldStateModule();
    worldModule.setData({
      timeOfDay: world?.timeOfDay ?? '清晨',
      weather: world?.weather ?? '晴朗',
      currentRegion: world?.currentRegion ?? '未知',
      currentRegionName: worldCfg?.regions?.find((r) => r.id === world?.currentRegion)?.name ?? '',
      worldDescription: worldCfg?.description ?? world?.description ?? '',
      regions: (world?.regions ?? []).map((r) => {
        const cfg = worldCfg?.regions?.find((c) => c.id === r.id);
        return { id: r.id, name: cfg?.name ?? r.name, description: cfg?.description ?? r.description };
      }),
      npcs: (npcs ?? []).map((n) => ({
        name: n.name,
        role: n.role,
        personality: n.personality,
        location: n.location,
        mood: n.currentMood,
      })),
    });
    modules.set('world_state', worldModule);

    // player_state（非强制）
    const playerModule = new PlayerStateModule();
    playerModule.setData({
      playerName: player?.name ?? '未知',
      playerLocation: player?.location ?? '未知',
      inventory: player?.inventory ?? [],
      reputation: player?.reputation ?? {},
      quests: player?.quests ?? [],
    });
    modules.set('player_state', playerModule);

    // narrative_history（非强制）
    const historyModule = new NarrativeHistoryModule();
    historyModule.setData({
      history: narrativeText ? parseNarrativeHistory(narrativeText) : undefined,
    });
    modules.set('narrative_history', historyModule);

    // active_events（非强制）
    const eventsModule = new ActiveEventsModule();
    eventsModule.setData({
      events: storyline?.activeEvents ?? [],
    });
    modules.set('active_events', eventsModule);

    // scenario_hint（非强制）
    const hintModule = new ScenarioHintModule();
    // WorldConfig 当前不含 gmHint 字段，使用回退默认值
    const gmHint: string | undefined = (worldCfg as Record<string, unknown> | undefined)?.gmHint as string | undefined;
    hintModule.setData({
      hint: gmHint ?? '无特殊指引。',
    });
    modules.set('scenario_hint', hintModule);

    // ── 3. 交由 GMContextBuilder 组装 ────────────────────────
    const builder = new GMContextBuilder(modules);
    return builder.build(gameId, budget);
  }

  /**
   * 为 NPC 对话调用组装完整上下文。
   *
   * 模块组合：npc_persona(强制) + npc_memory + world_state(强制) + narrative_history + player_state
   *
   * @param gameId   游戏 ID
   * @param npcId    NPC ID
   * @param budget   token 预算上限（如 50000 for Sonnet）
   * @returns        AssembledContext（含 systemPrompt + tokenEstimate）
   */
  async buildNpcContext(gameId: string, npcId: string, budget: number): Promise<AssembledContext> {
    // ── 1. 读取 DB 数据 ──────────────────────────────────────
    const world = this.worldRepo.findByGameId(gameId);
    const npc = this.npcRepo.findById(npcId);
    if (!npc) throw new Error(`NPC not found: ${npcId}`);

    const player = this.playerRepo.findByGameId(gameId);
    const storyline = this.storylineRepo.findByGameId(gameId);

    // WorldConfig 按 world.name 匹配
    const worldCfg = world
      ? this.worldConfig.getWorld(world.name)
      : undefined;

    // NarrativeService 返回格式化文本，需转换为 NarrativeHistory
    const narrativeText = this.narrativeService.getRecentHistory(gameId);

    // ── 2. 创建模块实例 + setData 注入 ─────────────────────

    const modules = new Map<string, ContextModule>();

    // npc_persona（强制）
    const personaModule = new NpcPersonaModule();
    personaModule.setData({
      npcName: npc.name,
      npcRole: npc.role,
      npcLocation: npc.location,
      npcPersonality: npc.personality,
      npcMood: npc.currentMood,
    });
    modules.set('npc_persona', personaModule);

    // npc_memory（非强制）— 从 string[] 转为 ClassifiedMemory[]
    const rawMemories = this.npcRepo.getMemories(npcId);
    const classified: ClassifiedMemory[] = rawMemories.map((content, i) => ({
      id: i,
      npcId,
      content,
      turn: 0,
      tier: 'normal' as const,
      createdAt: '',
    }));
    const memoryModule = new NpcMemoryModule();
    memoryModule.setData({ memories: classified });
    modules.set('npc_memory', memoryModule);

    // world_state（强制）— 注入完整世界描述+区域详情+NPC
    const npcs = this.npcRepo.findByGameId(gameId);
    const worldModule = new WorldStateModule();
    worldModule.setData({
      timeOfDay: world?.timeOfDay ?? '清晨',
      weather: world?.weather ?? '晴朗',
      currentRegion: world?.currentRegion ?? '未知',
      currentRegionName: worldCfg?.regions?.find((r) => r.id === world?.currentRegion)?.name ?? '',
      worldDescription: worldCfg?.description ?? world?.description ?? '',
      regions: (world?.regions ?? []).map((r) => {
        const cfg = worldCfg?.regions?.find((c) => c.id === r.id);
        return { id: r.id, name: cfg?.name ?? r.name, description: cfg?.description ?? r.description };
      }),
      npcs: (npcs ?? []).map((n) => ({
        name: n.name,
        role: n.role,
        personality: n.personality,
        location: n.location,
        mood: n.currentMood,
      })),
    });
    modules.set('world_state', worldModule);

    // narrative_history（非强制）
    const historyModule = new NarrativeHistoryModule();
    historyModule.setData({
      history: narrativeText ? parseNarrativeHistory(narrativeText) : undefined,
    });
    modules.set('narrative_history', historyModule);

    // player_state（非强制）
    const playerModule = new PlayerStateModule();
    playerModule.setData({
      playerName: player?.name ?? '未知',
      playerLocation: player?.location ?? '未知',
      inventory: player?.inventory ?? [],
      reputation: player?.reputation ?? {},
      quests: player?.quests ?? [],
    });
    modules.set('player_state', playerModule);

    // ── 3. 交由 NpcContextBuilder 组装 ────────────────────────
    const builder = new NpcContextBuilder(modules);
    return builder.build(gameId, budget);
  }
}

// ── Narrative 解析辅助 ────────────────────────────────────────

/**
 * 将 NarrativeService.getRecentHistory() 返回的格式化文本
 * 解析为 NarrativeHistory 结构，供 NarrativeHistoryModule 使用。
 *
 * 输入格式（每行）：
 *   `- [第N轮] content`
 *
 * 输出：
 *   { recent: NarrativeEntry[], summary: null, totalRounds }
 */
function parseNarrativeHistory(text: string): NarrativeHistory {
  const lines = text.trim().split('\n').filter(Boolean);
  const entries: NarrativeEntry[] = [];
  const re = /^-\s*\[第(\d+)轮\]\s*(.*)$/;

  for (const line of lines) {
    const match = line.match(re);
    if (match) {
      entries.push({
        turn: parseInt(match[1], 10),
        content: match[2].trim(),
        timestamp: '',
      });
    }
  }

  return {
    recent: entries,
    summary: null,
    totalRounds: entries.length,
  };
}
