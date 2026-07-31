import { Injectable, NotFoundException, BadRequestException, ConflictException, Inject, forwardRef } from '@nestjs/common';
import { LegendLogger } from '../common/logger/legend.logger';
import type Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type {
  CreateGameRequest,
  CreateGameResponse,
  GameActionRequest,
  GameActionResponse,
  GameState,
  NPCDialogueResponse,
  WorldEvolutionResponse,
  NPCState,
  PlayerState,
  WorldState,
  MoveResult,
} from '@talking-legend/shared';
import { DB_INSTANCE } from '../db/tokens';
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
    @Inject(GameRepository) private readonly gameRepo: GameRepository,
    @Inject(WorldRepository) private readonly worldRepo: WorldRepository,
    @Inject(NpcRepository) private readonly npcRepo: NpcRepository,
    @Inject(PlayerRepository) private readonly playerRepo: PlayerRepository,
    @Inject(StorylineRepository) private readonly storylineRepo: StorylineRepository,
    @Inject(WorldConfigService) private readonly worldConfig: WorldConfigService,
    @Inject(GMEngine) private readonly gmEngine: GMEngine,
    @Inject(forwardRef(() => WorldService)) private readonly worldService: WorldService,
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

  async performAction(
    gameId: string,
    req: GameActionRequest,
  ): Promise<GameActionResponse> {
    this.logger.debug(`performAction (non-stream): gameId=${gameId} action=${req.action} target=${req.target ?? '(none)'}`);

    // Atomic read-modify-write via db.transaction()
    const doAction = this.db.transaction((): { narrative: string; npcResponses: NPCDialogueResponse[]; worldChanges: WorldEvolutionResponse } => {
      const game = this.gameRepo.findById(gameId);
      if (!game) {
        throw new NotFoundException(`Game not found: ${gameId}`);
      }

      // TODO: LLM integration — placeholder narrative
      const narrative = `You ${req.action}${req.target ? ` at ${req.target}` : ''}. The world shifts subtly in response.`;
      const npcResponses: NPCDialogueResponse[] = [];
      const worldChanges: WorldEvolutionResponse = {
        narrative,
        stateChanges: [],
        newEvents: [],
      };

      const expectedTurn = game.turn;
      const updatedTurn = game.turn + 1;

      // Optimistic concurrency: only update if turn matches expected value
      const updated = this.gameRepo.updateTurn(gameId, updatedTurn, expectedTurn);
      if (!updated) {
        throw new NotFoundException(`Game ${gameId} was modified by another request — retry`);
      }

      return { narrative, npcResponses, worldChanges };
    });

    const { narrative, npcResponses, worldChanges } = doAction();

    // Re-read the full state after the transaction
    const storedGame = this.gameRepo.findById(gameId);
    const world = this.worldRepo.findByGameId(gameId)!;
    const npcs = this.npcRepo.findByGameId(gameId);
    const player = this.playerRepo.findByGameId(gameId)!;

    const updatedState: GameState = {
      id: gameId,
      world,
      npcs,
      player,
      turn: storedGame!.turn,
      phase: storedGame!.phase,
    };

    return { narrative, npcResponses, worldChanges, updatedState };
  }

  async moveToRegion(gameId: string, targetRegion: string, trigger: 'click' | 'dialogue' = 'click'): Promise<MoveResult> {
    this.logger.log(`Move ${trigger}: ${gameId} → ${targetRegion}`);
    // Delegate to WorldService for data operation
    const result = await this.worldService.moveToRegion(gameId, targetRegion);

    // Bump turn + update player location (原子操作)
    this.db.transaction(() => {
      const game = this.gameRepo.findById(gameId);
      const newTurn = (game?.turn ?? 0) + 1;
      this.gameRepo.updateTurn(gameId, newTurn, game?.turn ?? 0);
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
    const gameState = await this.getGameState(gameId);

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

  /**
   * Save game state to a numbered slot.
   * Copies DB file and narrative log to data/saves/slot_N.*
   */
  async saveGame(gameId: string, slot: number): Promise<{ success: boolean; meta: SaveRecord }> {
    const game = this.gameRepo.findById(gameId);
    if (!game) throw new NotFoundException(`Game not found: ${gameId}`);

    const world = this.worldRepo.findByGameId(gameId);
    const player = this.playerRepo.findByGameId(gameId);

    const savesDir = path.join(process.cwd(), 'data', 'saves');
    fs.mkdirSync(savesDir, { recursive: true });

    // Save metadata to DB
    this.saveRepo.upsert(slot, {
      playerName: game.player.name,
      turn: game.turn,
      region: world?.currentRegion ?? '',
      world: world?.name ?? '',
    });

    // Copy DB file
    const dbSrc = path.join(process.cwd(), 'data', 'talking-legend.db');
    const dbDst = path.join(savesDir, `slot_${slot}.db`);
    fs.copyFileSync(dbSrc, dbDst);

    // Copy narrative log if it exists
    const narrativeSrc = path.join(process.cwd(), 'data', 'games', gameId, 'narrative.log');
    const narrativeDst = path.join(savesDir, `slot_${slot}.narrative.log`);
    if (fs.existsSync(narrativeSrc)) {
      fs.copyFileSync(narrativeSrc, narrativeDst);
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
   * Verify that a save file exists and return its meta.
   * The actual DB swap (copy save file over main DB) happens in the controller.
   */
  loadSave(slot: number): { success: boolean; meta: SaveRecord } {
    const meta = this.saveRepo.findBySlot(slot);
    if (!meta) throw new NotFoundException(`Save slot ${slot} not found`);

    const savePath = path.join(process.cwd(), 'data', 'saves', `slot_${slot}.db`);
    if (!fs.existsSync(savePath)) {
      throw new NotFoundException(`Save file not found for slot ${slot}`);
    }

    return { success: true, meta };
  }

  /**
   * Delete a save slot — removes DB row and file.
   */
  async deleteSave(slot: number): Promise<void> {
    this.saveRepo.delete(slot);

    const savesDir = path.join(process.cwd(), 'data', 'saves');
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
