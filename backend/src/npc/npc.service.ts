import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { DB_INSTANCE } from '../db/tokens';
import { NpcRepository } from '../db/repositories/npc.repository';
import { NpcEngine, type NpcDialogueChunkEvent, type NpcMoodChangeEvent } from '../llm/npc-engine';
import { WorldRepository } from '../db/repositories/world.repository';
import { PlayerRepository } from '../db/repositories/player.repository';
import { GameEventsRepository } from '../db/repositories/game-events.repository';
import { NarrativeService } from '../game/narrative.service';
import { LLMClient } from '../llm/client';
import type { NPCState } from '@talking-legend/shared';
import type { NpcStreamEvent } from '../llm/npc-engine';
import { LegendLogger } from '../common/logger/legend.logger';

@Injectable()
export class NpcService {
  private readonly logger = new LegendLogger(NpcService.name);
  private readonly locks = new Set<string>();

  constructor(
    @Inject(DB_INSTANCE) private readonly db: Database.Database,
    @Inject(NpcRepository) private readonly npcRepo: NpcRepository,
    @Inject(NpcEngine) private readonly npcEngine: NpcEngine,
    @Inject(WorldRepository) private readonly worldRepo: WorldRepository,
    @Inject(PlayerRepository) private readonly playerRepo: PlayerRepository,
    @Inject(GameEventsRepository) private readonly gameEventsRepo: GameEventsRepository,
    @Inject(NarrativeService) private readonly narrativeService: NarrativeService,
    @Inject(LLMClient) private readonly llmClient: LLMClient,
  ) {}

  /**
   * NPC 对话流式 SSE 生成 (RFC-011 DB-backed)。
   *
   * 1. 校验 NPC 存在 + 同区域
   * 2. 并发锁（同一 NPC 同时只能一个对话）
   * 3. 从 DB 加载记忆作为历史 → 调 NpcEngine.generate()
   * 4. 完成后将对话保存到 npc_memories（含 importance）
   */
  async *talkStream(
    gameId: string,
    npcId: string,
    playerMessage: string,
  ): AsyncIterable<string> {
    // ── 1. 并发锁 ──────────────────────────────────────────
    if (this.locks.has(npcId)) {
      throw new ConflictException(`NPC ${npcId} is already in a conversation`);
    }
    this.locks.add(npcId);

    try {
      // ── 2. 读 DB 验证 NPC 存在 + 同区域 ──────────────────
      const snapshot = this.db.transaction(() => {
        const npc = this.npcRepo.findById(npcId);
        if (!npc) {
          throw new NotFoundException(`NPC not found: ${npcId}`);
        }

        const player = this.playerRepo.findByGameId(gameId);
        if (!player) {
          throw new NotFoundException(`Player not found for game: ${gameId}`);
        }

        const world = this.worldRepo.findByGameId(gameId);
        if (!world) {
          throw new NotFoundException(`World not found for game: ${gameId}`);
        }

        // 同区域校验
        if (npc.location !== player.location) {
          throw new BadRequestException(
            `NPC is in "${npc.location}" but player is in "${player.location}" — must be in the same region to talk`,
          );
        }

        return { npc, player, world };
      })();

      // ── 3. 从 DB 加载记忆构建历史 ────────────────────────
      const memories = this.npcRepo.getMemories(npcId);
      // 将最近的记忆转换为对话历史格式（最多 MAX*2 条）
      const recentMemories = memories.slice(-40);
      const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      for (const memory of recentMemories) {
        // 记忆存储为 "role||content" 格式的 dialogue 类型时拆分
        const sepIdx = memory.indexOf('||');
        if (sepIdx > 0) {
          const role = memory.substring(0, sepIdx) as 'user' | 'assistant';
          conversationHistory.push({ role, content: memory.substring(sepIdx + 2) });
        }
      }

      // ── 4. 调 NpcEngine.generate() ──────────────────────
      const generator = this.npcEngine.generate(
        gameId,
        snapshot.npc,
        playerMessage,
        snapshot.player.name,
        conversationHistory,
      );

      let npcResponse = '';
      for await (const event of generator) {
        yield JSON.stringify(event);
        if (event.type === 'chunk') {
          npcResponse += event.content;
        }
      }

      // ── 5. 保存对话到 DB ──────────────────────────────────
      const importance = this.calcImportance(npcResponse, playerMessage);
      try {
        // 保存玩家消息（role||content 格式）
        this.npcRepo.addMemory(npcId, `user||${playerMessage}`, 0, importance, 'dialogue');
        // 保存 NPC 回应
        this.npcRepo.addMemory(npcId, `assistant||${npcResponse}`, 0, importance, 'dialogue');
      } catch (err) {
        this.logger.warn(`Failed to save NPC memory: ${(err as Error).message}`);
      }
    } finally {
      // ── 6. 释放锁 ─────────────────────────────────────────
      this.locks.delete(npcId);
    }
  }

  /**
   * 从数据库获取 NPC 记忆（非 raw，用于 API 返回）。
   */
  getMemories(npcId: string): Array<{ content: string; importance: number; type: string }> {
    const npc = this.npcRepo.findById(npcId);
    if (!npc) {
      throw new NotFoundException(`NPC not found: ${npcId}`);
    }
    // Return structured memory
    const db = this.db;
    const stmt = db.prepare(
      'SELECT content, importance, type FROM npc_memories WHERE npc_id = ? ORDER BY id DESC LIMIT 50',
    );
    const rows = stmt.all(npcId) as Array<{ content: string; importance: number; type: string }>;
    return rows.map(r => ({
      content: r.content.startsWith('user||') || r.content.startsWith('assistant||')
        ? r.content.substring(r.content.indexOf('||') + 2)
        : r.content,
      importance: r.importance,
      type: r.type,
    }));
  }

  /**
   * 异步调用 Haiku 模型对 NPC 对话做摘要，写入 game_events + narrative_history。
   */
  async generateSummary(
    gameId: string,
    npcId: string,
    body: { dialogue: Array<{ role: string; content: string }>; playerName: string },
  ): Promise<void> {
    const npc = this.npcRepo.findById(npcId);
    if (!npc) {
      this.logger.warn(`generateSummary: NPC not found ${npcId}`);
      return;
    }

    try {
      // 构造摘要 prompt — 使用 Haiku 快速总结
      const dialogueText = body.dialogue
        .map(d => `${d.role}: ${d.content}`)
        .join('\n');

      const prompt = `请用一句话概括以下对话的核心内容：\n\n${dialogueText}\n\n摘要：`;

      const result = await this.llmClient.call({
        systemPrompt: '你是一个对话摘要助手。请用简洁的中文概括对话核心内容。',
        userPrompt: prompt,
        maxTokens: 256,
      });

      const summary = result.content.trim();
      const turn = 0;

      // 写入 game_events
      try {
        this.gameEventsRepo.insert({
          gameId,
          type: 'npc_dialogue_summary',
          location: npc.location,
          actors: [npc.name, body.playerName],
          summary,
          importance: 3,
          turn,
        });
      } catch { /* silent */ }

      // 写入 narrative_history（通过 NarrativeService）
      try {
        this.narrativeService.append(gameId, turn, `[${npc.name} 对话] ${summary}`);
      } catch { /* silent */ }

      this.logger.log(`NPC summary generated: npcId=${npcId} summary="${summary.slice(0, 80)}"`);
    } catch (err) {
      this.logger.warn(`NPC summary generation failed: ${(err as Error).message}`);
    }
  }

  /**
   * 根据对话长度估算 importance (1-5)。
   */
  private calcImportance(npcResponse: string, playerMessage: string): number {
    const totalLen = npcResponse.length + playerMessage.length;
    if (totalLen > 500) return 5;
    if (totalLen > 300) return 4;
    if (totalLen > 150) return 3;
    if (totalLen > 60) return 2;
    return 1;
  }
}
