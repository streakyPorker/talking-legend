import { Injectable } from '@nestjs/common';
import type {
  CreateGameRequest,
  CreateGameResponse,
  GameActionRequest,
  GameActionResponse,
  GameState,
  NPCDialogueResponse,
  WorldEvolutionResponse,
} from '@talking-legend/shared';
import { v4 as uuidv4 } from '../utils/id';

// In-memory game store (will be replaced with a database later)
const games = new Map<string, GameState>();

@Injectable()
export class GameService {
  async createGame(req: CreateGameRequest): Promise<CreateGameResponse> {
    const gameId = uuidv4();

    const initialState: GameState = {
      id: gameId,
      world: {
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
      },
      npcs: [
        {
          id: 'elder_marin',
          name: 'Elder Marin',
          role: 'Village Elder',
          personality: 'Wise, patient, and carries the weight of many stories.',
          currentMood: 'welcoming',
          location: 'village',
          memoryOfPlayer: [],
          isAlive: true,
        },
        {
          id: 'ranger_kael',
          name: 'Ranger Kael',
          role: 'Forest Ranger',
          personality: 'Quiet, observant, fiercely protective of the woods.',
          currentMood: 'cautious',
          location: 'forest',
          memoryOfPlayer: [],
          isAlive: true,
        },
      ],
      player: {
        name: req.playerName,
        location: 'village',
        inventory: [],
        reputation: {},
        quests: [],
      },
      turn: 0,
      phase: 'intro',
    };

    games.set(gameId, initialState);
    return { gameId, initialState };
  }

  async performAction(
    gameId: string,
    req: GameActionRequest,
  ): Promise<GameActionResponse> {
    const game = games.get(gameId);
    if (!game) {
      throw new Error(`Game not found: ${gameId}`);
    }

    // TODO: LLM integration — this is a placeholder narrative
    const narrative = `You ${req.action}${req.target ? ` at ${req.target}` : ''}. The world shifts subtly in response.`;
    const npcResponses: NPCDialogueResponse[] = [];
    const worldChanges: WorldEvolutionResponse = {
      narrative,
      stateChanges: [],
      newEvents: [],
    };

    const updatedState: GameState = {
      ...game,
      turn: game.turn + 1,
    };

    games.set(gameId, updatedState);
    return { narrative, npcResponses, worldChanges, updatedState };
  }
}
