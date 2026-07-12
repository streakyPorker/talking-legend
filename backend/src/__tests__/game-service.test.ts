import { describe, it, expect } from 'vitest';
import { createGame, performAction } from '../services/game-service.js';

describe('GameService', () => {
  describe('createGame', () => {
    it('should create a new game with valid input', async () => {
      const result = await createGame({ playerName: 'TestHero' });

      expect(result.gameId).toBeDefined();
      expect(result.gameId).toMatch(/^[a-f0-9-]{36}$/);
      expect(result.initialState.player.name).toBe('TestHero');
      expect(result.initialState.world.name).toBe('Aethelgard');
      expect(result.initialState.phase).toBe('intro');
      expect(result.initialState.npcs).toHaveLength(2);
    });

    it('should set player in starting village location', async () => {
      const result = await createGame({ playerName: 'Adventurer' });
      expect(result.initialState.player.location).toBe('village');
      expect(result.initialState.world.currentRegion).toBe('village');
    });
  });

  describe('performAction', () => {
    it('should process an action and increment turn', async () => {
      const { gameId } = await createGame({ playerName: 'TestHero' });
      const result = await performAction(gameId, {
        gameId,
        action: 'explore',
        target: 'forest',
      });

      expect(result.narrative).toContain('explore');
      expect(result.updatedState.turn).toBe(1);
      expect(result.npcResponses).toEqual([]);
    });

    it('should throw for unknown game ID', async () => {
      await expect(
        performAction('non-existent-id', {
          gameId: 'non-existent-id',
          action: 'look around',
        }),
      ).rejects.toThrow('Game not found');
    });
  });
});
