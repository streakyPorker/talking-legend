import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../test-utils';
import { WorldRepository } from './world.repository';
import { GameRepository } from './game.repository';

describe('WorldRepository', () => {
  let db: Database.Database;
  let repo: WorldRepository;
  let gameRepo: GameRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new WorldRepository(db);
    gameRepo = new GameRepository(db);
    gameRepo.create('game-1', 'Hero');
  });

  afterEach(() => {
    db.close();
  });

  const sampleWorld = {
    name: 'Aethelgard',
    description: 'Test realm',
    regions: [
      { id: 'village', name: 'Stoneshire', description: 'A village', connectedRegions: ['forest'] },
      { id: 'forest', name: 'Dark Wood', description: 'A forest', connectedRegions: ['village'] },
    ],
    currentRegion: 'village',
    timeOfDay: 'morning' as const,
    weather: 'clear' as const,
    globalEvents: [],
  };

  it('upsert and findByGameId', () => {
    repo.upsert('game-1', sampleWorld);

    const found = repo.findByGameId('game-1');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Aethelgard');
    expect(found!.regions).toHaveLength(2);
    expect(found!.regions[0].name).toBe('Stoneshire');
    expect(found!.globalEvents).toEqual([]);
  });

  it('findByGameId returns undefined for missing game', () => {
    expect(repo.findByGameId('non-existent')).toBeUndefined();
  });

  it('upsert overwrites existing world', () => {
    repo.upsert('game-1', sampleWorld);

    const updated = {
      ...sampleWorld,
      name: 'Updated Realm',
      weather: 'rainy' as const,
    };
    repo.upsert('game-1', updated);

    const found = repo.findByGameId('game-1');
    expect(found!.name).toBe('Updated Realm');
    expect(found!.weather).toBe('rainy');
  });

  it('JSON regions round-trip correctly', () => {
    repo.upsert('game-1', sampleWorld);
    const found = repo.findByGameId('game-1');

    // Verify deep equality
    expect(found!.regions).toEqual(sampleWorld.regions);
    expect(found!.currentRegion).toBe('village');
    expect(found!.timeOfDay).toBe('morning');
  });

  it('delete removes world', () => {
    repo.upsert('game-1', sampleWorld);
    repo.delete('game-1');
    expect(repo.findByGameId('game-1')).toBeUndefined();
  });

  it('cascade on game delete removes world', () => {
    repo.upsert('game-1', sampleWorld);
    gameRepo.delete('game-1');
    expect(repo.findByGameId('game-1')).toBeUndefined();
  });
});
