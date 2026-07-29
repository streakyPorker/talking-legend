import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import type Database from 'better-sqlite3';
import { DB_INSTANCE } from '../db/tokens';
import { NpcRepository } from '../db/repositories/npc.repository';
import { NpcEngine } from '../llm/npc-engine';
import { WorldRepository } from '../db/repositories/world.repository';
import { PlayerRepository } from '../db/repositories/player.repository';
import type { NPCState } from '@talking-legend/shared';
import type { NpcStreamEvent } from '../llm/npc-engine';

@Injectable()
export class NpcService {
  private readonly history = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();
  private readonly MAX: number;
  private readonly locks = new Set<string>();

  constructor(
    @Inject(DB_INSTANCE) private readonly db: Database.Database,
    @Inject(NpcRepository) private readonly npcRepo: NpcRepository,
    @Inject(NpcEngine) private readonly npcEngine: NpcEngine,
    @Inject(WorldRepository) private readonly worldRepo: WorldRepository,
    @Inject(PlayerRepository) private readonly playerRepo: PlayerRepository,
  ) {
    this.MAX = Number(process.env.NPC_HISTORY_ROUNDS) || 20;
  }

  /**
   * NPC 对话流式 SSE 生成。
   *
   * 1. 校验 NPC 存在 + 同区域
   * 2. 并发锁（同一 NPC 同时只能一个对话）
   * 3. 取对话历史 + 调 NpcEngine.generate()
   * 4. 更新历史 Map
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

      // ── 3. 取对话历史 ────────────────────────────────────
      const historyKey = `${gameId}:${npcId}`;
      const conversationHistory = this.history.get(historyKey) ?? [];

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

      // ── 5. 更新历史 Map ───────────────────────────────────
      const updatedHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...conversationHistory,
        { role: 'user', content: playerMessage },
        { role: 'assistant', content: npcResponse },
      ];

      // 超过 MAX 轮时移除最早记录
      while (updatedHistory.length > this.MAX * 2) {
        updatedHistory.splice(0, 2);
      }

      this.history.set(historyKey, updatedHistory);
    } finally {
      // ── 6. 释放锁 ─────────────────────────────────────────
      this.locks.delete(npcId);
    }
  }
}
