import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../db/test-utils';
import { WorldService } from './world.service';
import { WorldRepository } from '../db/repositories/world.repository';
import { GameRepository } from '../db/repositories/game.repository';
import type { WorldState } from '@talking-legend/shared';

describe('WorldService', () => {
  let db: Database.Database;
  let gameRepo: GameRepository;
  let worldRepo: WorldRepository;
  let service: WorldService;

  const sampleWorld: WorldState = {
    name: 'Aethelgard',
    description: 'Test realm',
    regions: [
      { id: 'village', name: 'Stoneshire', description: 'A village', connectedRegions: ['forest'] },
      { id: 'forest', name: 'Dark Wood', description: 'A dark forest', connectedRegions: ['village'] },
    ],
    currentRegion: 'village',
    timeOfDay: 'morning' as const,
    weather: 'clear' as const,
    globalEvents: [],
  };

  beforeEach(() => {
    db = createTestDb();
    gameRepo = new GameRepository(db);
    worldRepo = new WorldRepository(db);
    service = new WorldService(worldRepo);

    gameRepo.create('game-1', 'Hero');
    worldRepo.upsert('game-1', sampleWorld);
  });

  afterEach(() => {
    db.close();
  });

  describe('moveToRegion', () => {
    it('should validate connectivity and return from/target for a connected region', async () => {
      const result = await service.moveToRegion('game-1', 'forest');

      expect(result.fromRegion).toBe('village');
      expect(result.targetName).toBe('Dark Wood');
      expect(result.narrative).toContain('Stoneshire');
      expect(result.narrative).toContain('Dark Wood');

      // Read-only: must NOT mutate world state
      const unchanged = worldRepo.findByGameId('game-1');
      expect(unchanged!.currentRegion).toBe('village');
    });

    it('should throw when target region is not connected', async () => {
      await expect(service.moveToRegion('game-1', 'lake')).rejects.toThrow('无法到达 lake');
    });

    it('should return narrative containing the target region description', async () => {
      const result = await service.moveToRegion('game-1', 'forest');

      expect(result.narrative).toContain('dark forest');
    });

    it('should throw for non-existent game', async () => {
      await expect(service.moveToRegion('non-existent', 'forest')).rejects.toThrow('游戏不存在');
    });

    it('should not persist moves — world state stays unchanged', async () => {
      // Move to forest (read-only — no DB write)
      const toForest = await service.moveToRegion('game-1', 'forest');
      expect(toForest.fromRegion).toBe('village');
      expect(toForest.targetName).toBe('Dark Wood');

      // World state must remain untouched — currentRegion keeps its original value
      const world = worldRepo.findByGameId('game-1');
      expect(world!.currentRegion).toBe('village');
    });

    it('should return correct return type structure', async () => {
      const result = await service.moveToRegion('game-1', 'forest');

      expect(result).toHaveProperty('fromRegion');
      expect(result).toHaveProperty('targetName');
      expect(result).toHaveProperty('narrative');
      expect(typeof result.fromRegion).toBe('string');
      expect(typeof result.targetName).toBe('string');
      expect(typeof result.narrative).toBe('string');
    });
  });
});
