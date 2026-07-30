import { create } from 'zustand';
import type { GameState } from '@talking-legend/shared';

interface GameStore {
  gameState: GameState | null;
  setGameState: (state: GameState) => void;
  updateTurn: (turn: number) => void;
  clearGame: () => void;

  narrative: string[];
  addPlayerAction: (action: string) => void;
  appendNarrativeChunk: (chunk: string) => void;
  addToolResult: (message: string) => void;
  clearNarrative: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  gameState: null,
  setGameState: (state) => set({ gameState: state }),
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
  addToolResult: (message) =>
    set((s) => ({ narrative: [...s.narrative, `[系统] ${message}`, ''] })),
  clearNarrative: () => set({ narrative: [] }),
}));
