// Shared types for talking-legend
// These types are used across frontend and backend

// === Game State ===

export interface GameState {
  id: string;
  world: WorldState;
  npcs: NPCState[];
  player: PlayerState;
  turn: number;
  phase: GamePhase;
}

export type GamePhase = 'intro' | 'exploration' | 'dialogue' | 'event' | 'combat' | 'conclusion';

export interface WorldState {
  name: string;
  description: string;
  regions: Region[];
  currentRegion: string;
  timeOfDay: string;
  weather: string;
  globalEvents: string[];
}

export interface Region {
  id: string;
  name: string;
  description: string;
  connectedRegions: string[];
}

// === NPC ===

export interface NPCState {
  id: string;
  name: string;
  role: string;
  personality: string;
  currentMood: string;
  location: string;
  memoryOfPlayer: string[];
  isAlive: boolean;
}

export interface NPCDialogueRequest {
  npcId: string;
  playerMessage: string;
  gameState: GameState;
}

export interface NPCDialogueResponse {
  npcId: string;
  message: string;
  moodChange: string;
  memoryUpdate: string;
}

// === Player ===

export interface PlayerState {
  name: string;
  location: string;
  inventory: string[];
  reputation: Record<string, number>;
  quests: Quest[];
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'completed' | 'failed';
  progress: number;
}

// === World Evolution ===

export interface WorldEvolutionRequest {
  gameState: GameState;
  playerAction: string;
}

export interface WorldEvolutionResponse {
  narrative: string;
  stateChanges: StateChange[];
  newEvents: string[];
}

export interface StateChange {
  target: 'world' | 'npc' | 'player';
  targetId?: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

// === API ===

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface CreateGameRequest {
  playerName: string;
  scenario?: string;
}

export interface CreateGameResponse {
  gameId: string;
  initialState: GameState;
}

export interface GameActionRequest {
  gameId: string;
  action: string;
  target?: string;
}

export interface GameActionResponse {
  narrative: string;
  npcResponses: NPCDialogueResponse[];
  worldChanges: WorldEvolutionResponse;
  updatedState: GameState;
}
