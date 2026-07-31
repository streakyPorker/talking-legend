import { create } from 'zustand';
import type { GameState } from '@talking-legend/shared';

interface GameStore {
  gameState: GameState | null;
  setGameState: (state: GameState) => void;
  /** 完整恢复状态（含叙事历史），用于刷新/读档 */
  restoreGame: (state: GameState, narrative?: string) => void;
  updateTurn: (turn: number) => void;
  clearGame: () => void;

  narrative: string[];
  addPlayerAction: (action: string) => void;
  appendNarrativeChunk: (chunk: string) => void;
  clearNarrative: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  gameState: null,
  setGameState: (state) => set({ gameState: state }),
  restoreGame: (state, narrative) =>
    set({
      gameState: state,
      narrative: narrative ? narrative.split('\n').filter(Boolean) : [],
    }),
  updateTurn: (turn) =>
    set((s) => ({
      gameState: s.gameState ? { ...s.gameState, turn } : null,
    })),
  clearGame: () => set({ gameState: null, narrative: [] }),

  narrative: [],
  addPlayerAction: (action) =>
    set((s) => ({ narrative: [...s.narrative, `> ${action}`, ''] })),
  appendNarrativeChunk: (chunk) =>
    set((s) => {
      const lines = [...s.narrative];
      lines[lines.length - 1] = (lines[lines.length - 1] || '') + chunk;
      return { narrative: lines };
    }),
  clearNarrative: () => set({ narrative: [] }),
}));
