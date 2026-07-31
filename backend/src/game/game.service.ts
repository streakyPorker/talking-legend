import { Injectable, NotFoundException, BadRequestException, ConflictException, Inject } from '@nestjs/common';
import { LegendLogger } from '../common/logger/legend.logger';
import type Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type {
  CreateGameRequest,
  CreateGameResponse,
  GameState,
  NPCState,
  PlayerState,
  WorldState,
  MoveResult,
} from '@talking-legend/shared';
import { DB_INSTANCE, DATABASE_MANAGER } from '../db/tokens';
import { DbConnectionManager } from '../db/db-connection-manager';
import { GameRepository } from '../db/repositories/game.repository';
import { WorldRepository } from '../db/repositories/world.repository';
import { NpcRepository } from '../db/repositories/npc.repository';
import { PlayerRepository } from '../db/repositories/player.repository';
import { StorylineRepository } from '../db/repositories/storyline.repository';
import { WorldConfigService } from '../world-config/world-config.service';
import { WorldService } from '../world/world.service';
import { GMEngine } from '../llm/gm-engine';
import { TravelLogRepository } from '../db/repositories/travel-log.repository';
import { NarrativeService } from './narrative.service';
import { SaveRepository, SaveRecord } from '../db/repositories/save.repository';
import { v4 as uuidv4 } from '../utils/id';

@Injectable()
export class GameService {
  private readonly logger = new LegendLogger(GameService.name);
  private readonly activeGenerations = new Set<string>();

  getGameState(gameId: string): GameState {
    const storedGame = this.gameRepo.findById(gameId);
    if (!storedGame) {
      throw new NotFoundException(`Game not found: ${gameId}`);
    }
    const world = this.worldRepo.findByGameId(gameId);
    const npcs = this.npcRepo.findByGameId(gameId);
    const player = this.playerRepo.findByGameId(gameId);
    if (!world || !player) {
      throw new Error('Game state incomplete');
    }
    return {
      id: gameId,
      world,
      npcs,
      player,
      turn: storedGame.turn,
      phase: storedGame.phase,
    };
  }

  /** 获取完整游戏状态（含叙事历史+事件），用于刷新/读档恢复 */
  getFullState(gameId: string) {
    const gameState = this.getGameState(gameId);
    const narrative = this.narrativeService.getRecentHistory(gameId);
    return {
      ...gameState,
      narrative: narrative || '',
    };
  }

  constructor(
    @Inject(DB_INSTANCE) private readonly db: Database.Database,
    @Inject(DATABASE_MANAGER) private readonly dbManager: DbConnectionManager,
    @Inject(GameRepository) private readonly gameRepo: GameRepository,
    @Inject(WorldRepository) private readonly worldRepo: WorldRepository,
    @Inject(NpcRepository) private readonly npcRepo: NpcRepository,
    @Inject(PlayerRepository) private readonly playerRepo: PlayerRepository,
    @Inject(StorylineRepository) private readonly storylineRepo: StorylineRepository,
    @Inject(WorldConfigService) private readonly worldConfig: WorldConfigService,
    @Inject(GMEngine) private readonly gmEngine: GMEngine,
    @Inject(WorldService) private readonly worldService: WorldService,
    @Inject(TravelLogRepository) private readonly travelLogRepo: TravelLogRepository,
    @Inject(SaveRepository) private readonly saveRepo: SaveRepository,
    @Inject(NarrativeService) private readonly narrativeService: NarrativeService,
  ) {}

  async createGame(req: CreateGameRequest): Promise<CreateGameResponse> {
    const gameId = uuidv4();
    const playerName = req.playerName;

    const config = req.scenario
      ? this.worldConfig.getWorld(req.scenario)
      : this.worldConfig.getDefaultWorld();
    if (!config) {
      throw new BadRequestException(
        req.scenario
          ? `Unknown scenario: ${req.scenario}. Available: ${this.worldConfig.listWorlds().map((w) => w.id).join(', ')}`
          : 'No world configs available',
      );
    }

    // Seed worlds table — runtime defaults (time/weather/events) stay in code
    const worldState: WorldState = {
      name: config.name,
      description: config.description,
      regions: config.regions.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        connectedRegions: r.connectedRegions,
      })),
      currentRegion: config.startingRegion,
      timeOfDay: 'morning',
      weather: 'clear',
      globalEvents: [],
    };

    // Seed NPCs table — id/memory/aliveness are per-game-instance runtime state
    const npcs: NPCState[] = config.npcs.map((cfg) => ({
      id: uuidv4(),
      name: cfg.name,
      role: cfg.role,
      personality: cfg.personality,
      currentMood: cfg.initialMood,
      location: cfg.location,
      memoryOfPlayer: [],
      isAlive: true,
    }));

    // Seed players table
    const playerState: PlayerState = {
      name: playerName,
      location: config.startingRegion,
      inventory: [],
      reputation: {},
      quests: [],
    };

    // Wrap all seed writes in a transaction
    const seed = this.db.transaction(() => {
      this.gameRepo.create(gameId, playerName);
      this.worldRepo.upsert(gameId, worldState);
      for (const npc of npcs) {
        this.npcRepo.create(gameId, npc);
      }
      this.playerRepo.upsert(gameId, playerState);
    });
    seed();

    this.logger.log(`Game created: ${gameId} player="${playerName}" world="${config.name}"`);

    // Assemble the full initial state
    const gameState: GameState = {
      id: gameId,
      world: worldState,
      npcs,
      player: playerState,
      turn: 0,
      phase: 'intro',
    };

    return { gameId, initialState: gameState };
  }

  /**
   * 移动玩家到相邻区域（点击移动或 GM 流内 tool 调用）。
   *
   * 移动语义 = 「行动即 1 回合」：
   *  - 点击路由（trigger='click'，bumpTurn=true）→ 移动消耗 1 回合。
   *  - GM 流式行动 Phase1 已先 bump turn，流内 moveTo tool 以
   *    trigger='dialogue', bumpTurn=false 调用，不再额外 bump。
   *
   * WorldService.moveToRegion 仅做连通性校验 + 生成叙事（不写库）；
   * 本方法在**单个事务**内完成：world.upsert + (可选)turn bump +
   * player.location 更新 + travel_log 插入。
   */
  async moveToRegion(
    gameId: string,
    targetRegion: string,
    trigger: 'click' | 'dialogue' = 'click',
    bumpTurn = true,
  ): Promise<MoveResult> {
    this.logger.log(`Move ${trigger}${bumpTurn ? '' : '(no-bump)'}: ${gameId} → ${targetRegion}`);

    // WorldService only validates connectivity and crafts the narrative — no write.
    const result = await this.worldService.moveToRegion(gameId, targetRegion);

    // 单事务：world upsert + optional turn bump + player.location + travel_log
    this.db.transaction(() => {
      const game = this.gameRepo.findById(gameId);
      if (!game) {
        throw new NotFoundException(`Game not found: ${gameId}`);
      }

      const newTurn = game.turn + (bumpTurn ? 1 : 0);

      if (bumpTurn) {
        const updated = this.gameRepo.updateTurn(gameId, newTurn, game.turn);
        if (!updated) {
          throw new ConflictException(`Game ${gameId} was modified by another request — retry`);
        }
      }

      // Upsert world state with the new currentRegion (self-contained, not via
      // WorldService write path).
      const world = this.worldRepo.findByGameId(gameId);
      if (!world) {
        throw new Error('Game state incomplete');
      }
      this.worldRepo.upsert(gameId, { ...world, currentRegion: targetRegion });

      this.playerRepo.updateLocation(gameId, targetRegion);

      // Record travel
      this.travelLogRepo.insert({
        gameId,
        fromRegion: result.fromRegion,
        toRegion: targetRegion,
        turn: newTurn,
        trigger,
      });
    })();

    // Re-read full game state
    const gameState = this.getGameState(gameId);

    return {
      success: true,
      message: `前往${result.targetName}`,
      narrative: result.narrative,
      gameState,
    };
  }

  async *performActionStream(
    gameId: string,
    action: string,
    target?: string,
  ): AsyncIterable<string> {
    this.logger.debug(`performActionStream: gameId=${gameId} action=${action} target=${target ?? '(none)'}`);

    // 并发锁：同一局游戏同一时间只能有一个 GM 生成
    if (this.activeGenerations.has(gameId)) {
      this.logger.warn(`Generation already active for gameId=${gameId}`);
      throw new ConflictException('GM is already generating for this game');
    }
    this.activeGenerations.add(gameId);

    try {
      // Phase 1: db.transaction 读取快照 + turn bump
      const snapshot = this.db.transaction(() => {
        const game = this.gameRepo.findById(gameId);
        if (!game) {
          throw new NotFoundException(`Game not found: ${gameId}`);
        }
        const newTurn = game.turn + 1;
        const updated = this.gameRepo.updateTurn(gameId, newTurn, game.turn);
        if (!updated) {
          throw new ConflictException('Game modified by another request');
        }
        const world = this.worldRepo.findByGameId(gameId);
        const player = this.playerRepo.findByGameId(gameId);
        if (!world || !player) {
          throw new Error('Game state incomplete');
        }
        return {
          turn: newTurn,
          world,
          npcs: this.npcRepo.findByGameId(gameId),
          player,
          storyline: this.storylineRepo.findByGameId(gameId),
        };
      })();

      this.logger.debug(`DB snapshot: turn=${snapshot.turn} region=${snapshot.world?.currentRegion ?? '?'}`);
      this.logger.log(`GM stream started: gameId=${gameId}`);

      // Phase 2: GMEngine generate
      const generator = this.gmEngine.generateWithTools(gameId, action, target, snapshot.turn);
      for await (const event of generator) {
        if (event.type === 'chunk') {
          yield JSON.stringify(event);
        } else if (event.type === 'done') {
          yield JSON.stringify(event);
        } else if (event.type === 'tool_call') {
          yield JSON.stringify({ type: 'tool_call', name: event.name, args: event.args });
        } else if (event.type === 'tool_result') {
          yield JSON.stringify({ type: 'tool_result', success: event.success, message: event.message, stateChanges: event.stateChanges });
        } else {
          yield JSON.stringify(event);
        }
      }

      this.logger.log(`GM stream completed: gameId=${gameId}`);
    } catch (err) {
      this.logger.debug(`GM stream error for gameId=${gameId}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      this.activeGenerations.delete(gameId);
    }
  }

  // ── Save / Load ───────────────────────────────────────────────

  private savesDir(): string {
    return path.join(process.cwd(), 'data', 'saves');
  }

  /** 校验 slot 为 0-99 整数，避免路径拼接注入。 */
  private assertValidSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot > 99) {
      throw new BadRequestException(`Invalid save slot: ${slot} (must be integer 0-99)`);
    }
  }

  /**
   * Save game state to a numbered slot.
   *
   * 使用 `VACUUM INTO` 生成一致快照（自动合并 -wal）到 data/saves/slot_N.db，
   * narrative.log 一并快照到 slot_N.narrative.log。
   */
  async saveGame(gameId: string, slot: number): Promise<{ success: boolean; meta: SaveRecord }> {
    this.assertValidSlot(slot);
    const game = this.gameRepo.findById(gameId);
    if (!game) throw new NotFoundException(`Game not found: ${gameId}`);

    const world = this.worldRepo.findByGameId(gameId);

    const savesDir = this.savesDir();
    fs.mkdirSync(savesDir, { recursive: true });

    // Save metadata to DB
    this.saveRepo.upsert(slot, {
      playerName: game.player.name,
      turn: game.turn,
      region: world?.currentRegion ?? '',
      world: world?.name ?? '',
      gameId,
    });

    // VACUUM INTO a consistent snapshot (merges -wal so no data is lost).
    const savedDb = path.join(savesDir, `slot_${slot}.db`);
    if (fs.existsSync(savedDb)) fs.unlinkSync(savedDb);
    // Escape single quotes for SQL string literal (path may contain them).
    const escaped = savedDb.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);

    // Copy narrative log if it exists
    const narrativeSrc = path.join(process.cwd(), 'data', 'games', gameId, 'narrative.log');
    const narrativeDst = path.join(savesDir, `slot_${slot}.narrative.log`);
    if (fs.existsSync(narrativeSrc)) {
      fs.copyFileSync(narrativeSrc, narrativeDst);
    } else if (fs.existsSync(narrativeDst)) {
      // Stale narrative snapshot — remove so a later load doesn't restore an old log.
      fs.unlinkSync(narrativeDst);
    }

    const meta = this.saveRepo.findBySlot(slot)!;
    this.logger.log(`Game saved: gameId=${gameId} slot=${slot} turn=${game.turn}`);
    return { success: true, meta };
  }

  /**
   * List all save slots.
   */
  listSaves(): SaveRecord[] {
    return this.saveRepo.findAll();
  }

  /**
   * Load a save slot — swaps the live connection to the snapshot.
   *
   * Order is critical: metadata (gameId etc.) is read from the current DB's
   * `saves` table BEFORE the reset overwrites it. Then `dbManager.reset()`
   * closes the old connection, restores the snapshot over the main DB,
   * clears stale -wal/-shm, reopens + re-migrates. narrative.log is restored
   * from the slot snapshot.
   */
  loadSave(slot: number): { success: boolean; gameId: string; meta: SaveRecord } {
    this.assertValidSlot(slot);
    // 1. Read metadata FROM the current DB — must happen before the swap.
    const meta = this.saveRepo.findBySlot(slot);
    if (!meta) throw new NotFoundException(`Save slot ${slot} not found`);

    const savePath = path.join(this.savesDir(), `slot_${slot}.db`);
    if (!fs.existsSync(savePath)) {
      throw new NotFoundException(`Save file not found for slot ${slot}`);
    }

    // 2. Swap the live connection to the snapshot DB.
    this.dbManager.reset(savePath);

    // 3. Restore narrative.log from the slot snapshot (if present).
    this.restoreNarrative(slot, meta.gameId);

    this.logger.log(`Game loaded: slot=${slot} gameId=${meta.gameId} turn=${meta.turn}`);
    return { success: true, gameId: meta.gameId, meta };
  }

  /** 将 slot 快照的 narrative 恢复到 data/games/<gameId>/narrative.log。 */
  private restoreNarrative(slot: number, gameId: string): void {
    const narrativeSrc = path.join(this.savesDir(), `slot_${slot}.narrative.log`);
    if (!fs.existsSync(narrativeSrc)) return; // 没有快照则跳过

    const targetDir = path.join(process.cwd(), 'data', 'games', gameId);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(narrativeSrc, path.join(targetDir, 'narrative.log'));
  }

  /**
   * Delete a save slot — removes DB row and file.
   */
  async deleteSave(slot: number): Promise<void> {
    this.assertValidSlot(slot);
    this.saveRepo.delete(slot);

    const savesDir = this.savesDir();
    const dbPath = path.join(savesDir, `slot_${slot}.db`);
    const narrativePath = path.join(savesDir, `slot_${slot}.narrative.log`);

    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(narrativePath)) fs.unlinkSync(narrativePath);

    this.logger.log(`Save deleted: slot=${slot}`);
  }

  /**
   * Auto-save to slot 0. Fire-and-forget (errors caught silently).
   */
  async autoSave(gameId: string): Promise<void> {
    try {
      await this.saveGame(gameId, 0);
    } catch (err) {
      this.logger.warn(`Auto-save failed for gameId=${gameId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
