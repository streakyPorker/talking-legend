import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../db/test-utils';
import { GameService } from '../game/game.service';
import { GameRepository } from '../db/repositories/game.repository';
import { WorldRepository } from '../db/repositories/world.repository';
import { NpcRepository } from '../db/repositories/npc.repository';
import { PlayerRepository } from '../db/repositories/player.repository';

describe('GameService', () => {
  let db: Database.Database;
  let service: GameService;

  beforeEach(() => {
    db = createTestDb();
    service = new GameService(
      db,
      new GameRepository(db),
      new WorldRepository(db),
      new NpcRepository(db),
      new PlayerRepository(db),
    );
  });

  afterEach(() => {
    db.close();
  });

  describe('createGame', () => {
    it('should create a new game with valid input', async () => {
      const result = await service.createGame({ playerName: 'TestHero' });

      expect(result.gameId).toBeDefined();
      expect(result.gameId).toMatch(/^[a-f0-9-]{36}$/);
      expect(result.initialState.player.name).toBe('TestHero');
      expect(result.initialState.world.name).toBe('Aethelgard');
      expect(result.initialState.phase).toBe('intro');
      expect(result.initialState.npcs).toHaveLength(2);
    });

    it('should set player in starting village location', async () => {
      const result = await service.createGame({ playerName: 'Adventurer' });
      expect(result.initialState.player.location).toBe('village');
      expect(result.initialState.world.currentRegion).toBe('village');
    });

    it('should persist game to DB (survives re-read)', async () => {
      const { gameId } = await service.createGame({ playerName: 'PersistTest' });

      // Verify the game was persisted by reading directly from repos
      const gameRepo = new GameRepository(db);
      const worldRepo = new WorldRepository(db);
      const npcRepo = new NpcRepository(db);

      const game = gameRepo.findById(gameId);
      expect(game).toBeDefined();
      expect(game!.turn).toBe(0);

      const world = worldRepo.findByGameId(gameId);
      expect(world).toBeDefined();
      expect(world!.name).toBe('Aethelgard');

      const npcs = npcRepo.findByGameId(gameId);
      expect(npcs).toHaveLength(2);
    });
  });

  describe('performAction', () => {
    it('should process an action and increment turn', async () => {
      const { gameId } = await service.createGame({ playerName: 'TestHero' });
      const result = await service.performAction(gameId, {
        gameId,
        action: 'explore',
        target: 'forest',
      });

      expect(result.narrative).toContain('explore');
      expect(result.updatedState.turn).toBe(1);
      expect(result.npcResponses).toEqual([]);
    });

    it('should persist turn increment to DB', async () => {
      const { gameId } = await service.createGame({ playerName: 'TestHero' });

      await service.performAction(gameId, {
        gameId,
        action: 'look around',
      });

      const gameRepo = new GameRepository(db);
      const game = gameRepo.findById(gameId);
      expect(game!.turn).toBe(1);
    });

    it('should throw for unknown game ID', async () => {
      await expect(
        service.performAction('non-existent-id', {
          gameId: 'non-existent-id',
          action: 'look around',
        }),
      ).rejects.toThrow('Game not found');
    });
  });
});
