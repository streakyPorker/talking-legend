import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../test-utils';
import { LlmLogRepository } from './llm-log.repository';
import { GameRepository } from './game.repository';

describe('LlmLogRepository', () => {
  let db: Database.Database;
  let repo: LlmLogRepository;
  let gameRepo: GameRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new LlmLogRepository(db);
    gameRepo = new GameRepository(db);
    gameRepo.create('game-1', 'Hero');
  });

  afterEach(() => {
    db.close();
  });

  it('insert and findById', () => {
    const id = repo.insert({
      gameId: 'game-1',
      callType: 'gm',
      model: 'claude-sonnet-4-6',
      promptTokens: 100,
      completionTokens: 50,
      latencyMs: 1200,
      costUsd: 0.015,
    });

    const found = repo.findById(id);
    expect(found).toBeDefined();
    expect(found!.callType).toBe('gm');
    expect(found!.model).toBe('claude-sonnet-4-6');
    expect(found!.costUsd).toBe(0.015);
  });

  it('findByGameId returns all logs for a game', () => {
    repo.insert({ gameId: 'game-1', callType: 'gm', model: 'opus', promptTokens: 200, completionTokens: 100, latencyMs: 3000, costUsd: 0.03 });
    repo.insert({ gameId: 'game-1', callType: 'npc_dialogue', model: 'sonnet', promptTokens: 150, completionTokens: 75, latencyMs: 2000, costUsd: 0.02 });

    const logs = repo.findByGameId('game-1');
    expect(logs).toHaveLength(2);
  });

  it('getTotalCost aggregates correctly', () => {
    repo.insert({ gameId: 'game-1', callType: 'gm', model: 'opus', promptTokens: 200, completionTokens: 100, latencyMs: 3000, costUsd: 0.03 });
    repo.insert({ gameId: 'game-1', callType: 'npc_dialogue', model: 'sonnet', promptTokens: 150, completionTokens: 75, latencyMs: 2000, costUsd: 0.02 });

    const total = repo.getTotalCost('game-1');
    expect(total).toBeCloseTo(0.05, 5);
  });

  it('getCostBreakdown groups by call_type', () => {
    repo.insert({ gameId: 'game-1', callType: 'gm', model: 'opus', promptTokens: 100, completionTokens: 50, latencyMs: 1000, costUsd: 0.01 });
    repo.insert({ gameId: 'game-1', callType: 'gm', model: 'opus', promptTokens: 200, completionTokens: 100, latencyMs: 2000, costUsd: 0.02 });
    repo.insert({ gameId: 'game-1', callType: 'npc_dialogue', model: 'sonnet', promptTokens: 150, completionTokens: 75, latencyMs: 1500, costUsd: 0.015 });

    const breakdown = repo.getCostBreakdown('game-1');
    expect(breakdown).toHaveLength(2);

    const gmCost = breakdown.find((b) => b.callType === 'gm');
    expect(gmCost).toBeDefined();
    expect(gmCost!.totalCostUsd).toBeCloseTo(0.03, 5);
    expect(gmCost!.totalCalls).toBe(2);
  });

  it('getRecentByGameId returns limited logs', () => {
    for (let i = 0; i < 5; i++) {
      repo.insert({ gameId: 'game-1', callType: 'gm', model: 'opus', promptTokens: 100, completionTokens: 50, latencyMs: 1000, costUsd: 0.01 });
    }

    const recent = repo.getRecentByGameId('game-1', 3);
    expect(recent).toHaveLength(3);
    // IDs assigned in order — most recent will have highest ID
    expect(recent[0].id).toBeGreaterThanOrEqual(1);
  });
});
