import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../test-utils';
import { GameRepository } from './game.repository';
import { WorldRepository } from './world.repository';
import { NpcRepository } from './npc.repository';
import { PlayerRepository } from './player.repository';

describe('GameRepository', () => {
  let db: Database.Database;
  let repo: GameRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new GameRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('create and findById', () => {
    const result = repo.create('game-1', 'TestHero');
    expect(result.id).toBe('game-1');
    expect(result.turn).toBe(0);
    expect(result.phase).toBe('intro');
    expect(result.player.name).toBe('TestHero');
  });

  it('findById returns undefined for missing game', () => {
    expect(repo.findById('non-existent')).toBeUndefined();
  });

  it('updateTurn succeeds with correct expected turn', () => {
    repo.create('game-1', 'Hero');
    const updated = repo.updateTurn('game-1', 1, 0);
    expect(updated).toBe(true);

    const game = repo.findById('game-1');
    expect(game!.turn).toBe(1);
  });

  it('updateTurn fails with wrong expected turn (optimistic lock)', () => {
    repo.create('game-1', 'Hero');
    // expected turn is 0, but we try to update from turn 99
    const updated = repo.updateTurn('game-1', 1, 99);
    expect(updated).toBe(false);

    const game = repo.findById('game-1');
    expect(game!.turn).toBe(0); // unchanged
  });

  it('updatePhase changes phase', () => {
    repo.create('game-1', 'Hero');
    repo.updatePhase('game-1', 'exploration');

    const game = repo.findById('game-1');
    expect(game!.phase).toBe('exploration');
  });

  it('delete removes game', () => {
    repo.create('game-1', 'Hero');
    repo.delete('game-1');
    expect(repo.findById('game-1')).toBeUndefined();
  });

  it('list returns all games ordered by created_at desc', () => {
    repo.create('game-1', 'First');
    repo.create('game-2', 'Second');

    const games = repo.list();
    expect(games).toHaveLength(2);
  });

  it('delete cascades to worlds and npcs', () => {
    // Set up related data
    const worldRepo = new WorldRepository(db);
    const npcRepo = new NpcRepository(db);
    const playerRepo = new PlayerRepository(db);

    repo.create('game-1', 'Hero');
    worldRepo.upsert('game-1', {
      name: 'TestWorld',
      description: 'desc',
      regions: [],
      currentRegion: 'village',
      timeOfDay: 'morning',
      weather: 'clear',
      globalEvents: [],
    });
    npcRepo.create('game-1', {
      id: 'npc-1',
      name: 'TestNPC',
      role: 'test',
      personality: 'test',
      currentMood: 'neutral',
      location: 'village',
      memoryOfPlayer: [],
      isAlive: true,
    });
    playerRepo.upsert('game-1', {
      name: 'Hero',
      location: 'village',
      inventory: [],
      reputation: {},
      quests: [],
    });

    // Delete game — cascade should clean up related rows
    repo.delete('game-1');

    expect(worldRepo.findByGameId('game-1')).toBeUndefined();
    expect(npcRepo.findByGameId('game-1')).toHaveLength(0);
    expect(playerRepo.findByGameId('game-1')).toBeUndefined();
  });
});

describe('GameRepository — empty database', () => {
  let db: Database.Database;
  let repo: GameRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new GameRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('list returns empty array when no games exist', () => {
    expect(repo.list()).toHaveLength(0);
  });
});
