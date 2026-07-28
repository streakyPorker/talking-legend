import { Injectable, NotFoundException, BadRequestException, ConflictException, Inject } from '@nestjs/common';
import type Database from 'better-sqlite3';
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
} from '@talking-legend/shared';
import { DB_INSTANCE } from '../db/tokens';
import { GameRepository } from '../db/repositories/game.repository';
import { WorldRepository } from '../db/repositories/world.repository';
import { NpcRepository } from '../db/repositories/npc.repository';
import { PlayerRepository } from '../db/repositories/player.repository';
import { StorylineRepository } from '../db/repositories/storyline.repository';
import { WorldConfigService } from '../world-config/world-config.service';
import { GMEngine } from '../llm/gm-engine';
import { v4 as uuidv4 } from '../utils/id';

@Injectable()
export class GameService {
  private readonly activeGenerations = new Set<string>();

  constructor(
    @Inject(DB_INSTANCE) private readonly db: Database.Database,
    @Inject(GameRepository) private readonly gameRepo: GameRepository,
    @Inject(WorldRepository) private readonly worldRepo: WorldRepository,
    @Inject(NpcRepository) private readonly npcRepo: NpcRepository,
    @Inject(PlayerRepository) private readonly playerRepo: PlayerRepository,
    @Inject(StorylineRepository) private readonly storylineRepo: StorylineRepository,
    @Inject(WorldConfigService) private readonly worldConfig: WorldConfigService,
    @Inject(GMEngine) private readonly gmEngine: GMEngine,
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

  async *performActionStream(
    gameId: string,
    action: string,
    target?: string,
  ): AsyncIterable<string> {
    // 并发锁：同一局游戏同一时间只能有一个 GM 生成
    if (this.activeGenerations.has(gameId)) {
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

      // Phase 2: GMEngine generate
      const generator = this.gmEngine.generate(gameId, action, target, snapshot.turn);
      for await (const event of generator) {
        yield JSON.stringify(event);
      }
    } finally {
      this.activeGenerations.delete(gameId);
    }
  }
}
