import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../test-utils';
import { PlayerRepository } from './player.repository';
import { GameRepository } from './game.repository';

describe('PlayerRepository', () => {
  let db: Database.Database;
  let repo: PlayerRepository;
  let gameRepo: GameRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new PlayerRepository(db);
    gameRepo = new GameRepository(db);
    gameRepo.create('game-1', 'Hero');
  });

  afterEach(() => {
    db.close();
  });

  const samplePlayer = {
    name: 'Hero',
    location: 'village',
    inventory: ['sword', 'shield'],
    reputation: { village: 10, forest: 5 },
    quests: [
      { id: 'q-1', title: 'Save the village', description: 'Help the villagers', status: 'active' as const, progress: 0 },
    ],
  };

  it('upsert and findByGameId', () => {
    repo.upsert('game-1', samplePlayer);

    const found = repo.findByGameId('game-1');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Hero');
    expect(found!.inventory).toEqual(['sword', 'shield']);
    expect(found!.reputation).toEqual({ village: 10, forest: 5 });
  });

  it('findByGameId returns undefined for missing game', () => {
    expect(repo.findByGameId('non-existent')).toBeUndefined();
  });

  it('upsert with quests stores them', () => {
    repo.upsert('game-1', samplePlayer);

    const quests = repo.getQuests('game-1');
    expect(quests).toHaveLength(1);
    expect(quests[0].title).toBe('Save the village');
    expect(quests[0].status).toBe('active');
  });

  it('addQuest inserts a new quest', () => {
    repo.upsert('game-1', { ...samplePlayer, quests: [] });
    repo.addQuest('game-1', {
      id: 'q-2',
      title: 'Find the treasure',
      description: 'Search the forest',
      status: 'active',
      progress: 0,
    });

    const quests = repo.getQuests('game-1');
    expect(quests).toHaveLength(1);
    expect(quests[0].title).toBe('Find the treasure');
  });

  it('updateQuest modifies quest fields', () => {
    repo.upsert('game-1', samplePlayer);
    repo.updateQuest('q-1', { status: 'completed', progress: 100 });

    const quests = repo.getQuests('game-1');
    expect(quests[0].status).toBe('completed');
    expect(quests[0].progress).toBe(100);
  });

  it('upsert replaces all quests (write-through)', () => {
    repo.upsert('game-1', samplePlayer);

    // Second upsert with different quests
    repo.upsert('game-1', {
      ...samplePlayer,
      quests: [{ id: 'q-2', title: 'New quest', description: 'desc', status: 'active', progress: 0 }],
    });

    const quests = repo.getQuests('game-1');
    expect(quests).toHaveLength(1);
    expect(quests[0].id).toBe('q-2');
  });

  it('JSON inventory round-trips correctly', () => {
    repo.upsert('game-1', samplePlayer);
    const found = repo.findByGameId('game-1');
    expect(found!.inventory).toEqual(['sword', 'shield']);
  });

  it('JSON reputation round-trips correctly', () => {
    repo.upsert('game-1', samplePlayer);
    const found = repo.findByGameId('game-1');
    expect(found!.reputation).toEqual({ village: 10, forest: 5 });
  });
});
