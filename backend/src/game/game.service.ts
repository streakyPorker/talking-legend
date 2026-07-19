import { Injectable, NotFoundException, Inject } from '@nestjs/common';
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
import { v4 as uuidv4 } from '../utils/id';

@Injectable()
export class GameService {
  constructor(
    @Inject(DB_INSTANCE) private readonly db: Database.Database,
    private readonly gameRepo: GameRepository,
    private readonly worldRepo: WorldRepository,
    private readonly npcRepo: NpcRepository,
    private readonly playerRepo: PlayerRepository,
  ) {}

  async createGame(req: CreateGameRequest): Promise<CreateGameResponse> {
    const gameId = uuidv4();
    const playerName = req.playerName;

    // Seed worlds table
    const worldState: WorldState = {
      name: 'Aethelgard',
      description: 'A realm where legends are forged by deeds and words hold power.',
      regions: [
        { id: 'village', name: 'Stoneshire Village', description: 'A peaceful village nestled in the valley.', connectedRegions: ['forest', 'mountains'] },
        { id: 'forest', name: 'Whispering Woods', description: 'Ancient trees that murmur secrets to those who listen.', connectedRegions: ['village', 'lake'] },
        { id: 'mountains', name: 'Dragonspine Peaks', description: 'Jagged mountains where few dare to tread.', connectedRegions: ['village'] },
        { id: 'lake', name: 'Mirror Lake', description: 'A crystal-clear lake that reflects more than just the sky.', connectedRegions: ['forest'] },
      ],
      currentRegion: 'village',
      timeOfDay: 'morning',
      weather: 'clear',
      globalEvents: [],
    };

    // Seed NPCs table
    const npcs: NPCState[] = [
      {
        id: uuidv4(),
        name: 'Elder Marin',
        role: 'Village Elder',
        personality: 'Wise, patient, and carries the weight of many stories.',
        currentMood: 'welcoming',
        location: 'village',
        memoryOfPlayer: [],
        isAlive: true,
      },
      {
        id: uuidv4(),
        name: 'Ranger Kael',
        role: 'Forest Ranger',
        personality: 'Quiet, observant, fiercely protective of the woods.',
        currentMood: 'cautious',
        location: 'forest',
        memoryOfPlayer: [],
        isAlive: true,
      },
    ];

    // Seed players table
    const playerState: PlayerState = {
      name: playerName,
      location: 'village',
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
}
