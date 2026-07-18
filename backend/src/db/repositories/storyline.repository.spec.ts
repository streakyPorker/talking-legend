import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../test-utils';
import { StorylineRepository } from './storyline.repository';
import { GameRepository } from './game.repository';

describe('StorylineRepository', () => {
  let db: Database.Database;
  let repo: StorylineRepository;
  let gameRepo: GameRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new StorylineRepository(db);
    gameRepo = new GameRepository(db);
    gameRepo.create('game-1', 'Hero');
  });

  afterEach(() => {
    db.close();
  });

  const sampleState = {
    currentStage: 'intro',
    stageData: { npcs_introduced: ['Elder Marin'] },
    completedStages: [],
    activeEvents: ['event_welcome'],
  };

  it('upsert and findByGameId', () => {
    repo.upsert('game-1', sampleState);

    const found = repo.findByGameId('game-1');
    expect(found).toBeDefined();
    expect(found!.currentStage).toBe('intro');
    expect(found!.stageData).toEqual({ npcs_introduced: ['Elder Marin'] });
  });

  it('findByGameId returns undefined for missing game', () => {
    expect(repo.findByGameId('non-existent')).toBeUndefined();
  });

  it('upsert overwrites existing state', () => {
    repo.upsert('game-1', sampleState);

    const updated = {
      currentStage: 'exploration',
      stageData: {},
      completedStages: ['intro'],
      activeEvents: [],
    };
    repo.upsert('game-1', updated);

    const found = repo.findByGameId('game-1');
    expect(found!.currentStage).toBe('exploration');
    expect(found!.completedStages).toEqual(['intro']);
    expect(found!.activeEvents).toEqual([]);
  });

  it('JSON fields round-trip correctly', () => {
    repo.upsert('game-1', sampleState);
    const found = repo.findByGameId('game-1');
    expect(found!.stageData).toEqual({ npcs_introduced: ['Elder Marin'] });
    expect(found!.activeEvents).toEqual(['event_welcome']);
  });

  it('delete removes storyline', () => {
    repo.upsert('game-1', sampleState);
    repo.delete('game-1');
    expect(repo.findByGameId('game-1')).toBeUndefined();
  });
});
