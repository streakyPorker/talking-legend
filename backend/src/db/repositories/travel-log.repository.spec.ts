import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../test-utils';
import { TravelLogRepository } from './travel-log.repository';

describe('TravelLogRepository', () => {
  let db: Database.Database;
  let repo: TravelLogRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new TravelLogRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should insert and retrieve by gameId', () => {
    repo.insert({ gameId: 'g1', fromRegion: 'village', toRegion: 'forest', turn: 3, trigger: 'click' });
    const entries = repo.findByGameId('g1');
    expect(entries).toHaveLength(1);
    expect(entries[0].fromRegion).toBe('village');
    expect(entries[0].toRegion).toBe('forest');
    expect(entries[0].trigger).toBe('click');
    expect(entries[0].turn).toBe(3);
    expect(entries[0].id).toBeGreaterThan(0);
    expect(entries[0].createdAt).toBeTruthy();
  });

  it('should return inserted id', () => {
    const id = repo.insert({ gameId: 'g1', fromRegion: 'a', toRegion: 'b', turn: 1, trigger: 'dialogue' });
    expect(id).toBeGreaterThan(0);
  });

  it('findByGameId returns chronologically ordered entries', () => {
    repo.insert({ gameId: 'g1', fromRegion: 'a', toRegion: 'b', turn: 1, trigger: 'click' });
    repo.insert({ gameId: 'g1', fromRegion: 'b', toRegion: 'c', turn: 2, trigger: 'dialogue' });
    repo.insert({ gameId: 'g1', fromRegion: 'c', toRegion: 'd', turn: 3, trigger: 'click' });

    const entries = repo.findByGameId('g1');
    expect(entries).toHaveLength(3);
    expect(entries[0].toRegion).toBe('b');
    expect(entries[1].toRegion).toBe('c');
    expect(entries[2].toRegion).toBe('d');
  });

  it('getRecent returns most recent entries limited', () => {
    repo.insert({ gameId: 'g1', fromRegion: 'a', toRegion: 'b', turn: 1, trigger: 'click' });
    repo.insert({ gameId: 'g1', fromRegion: 'b', toRegion: 'c', turn: 2, trigger: 'dialogue' });
    repo.insert({ gameId: 'g1', fromRegion: 'c', toRegion: 'd', turn: 3, trigger: 'click' });
    repo.insert({ gameId: 'g1', fromRegion: 'd', toRegion: 'e', turn: 4, trigger: 'click' });

    const recent = repo.getRecent('g1', 2);
    expect(recent).toHaveLength(2);
    expect(recent[0].toRegion).toBe('e'); // most recent first (id desc)
    expect(recent[1].toRegion).toBe('d');
  });

  it('getRecent defaults to limit 5', () => {
    for (let i = 1; i <= 10; i++) {
      repo.insert({ gameId: 'g1', fromRegion: `r${i}`, toRegion: `r${i + 1}`, turn: i, trigger: 'click' });
    }

    const recent = repo.getRecent('g1');
    expect(recent).toHaveLength(5);
  });

  it('returns empty for unknown gameId', () => {
    expect(repo.findByGameId('unknown')).toHaveLength(0);
    expect(repo.getRecent('unknown')).toHaveLength(0);
  });

  it('isolates entries between games', () => {
    repo.insert({ gameId: 'g1', fromRegion: 'a', toRegion: 'b', turn: 1, trigger: 'click' });
    repo.insert({ gameId: 'g2', fromRegion: 'x', toRegion: 'y', turn: 1, trigger: 'dialogue' });

    expect(repo.findByGameId('g1')).toHaveLength(1);
    expect(repo.findByGameId('g2')).toHaveLength(1);
    expect(repo.findByGameId('g1')[0].toRegion).toBe('b');
    expect(repo.findByGameId('g2')[0].toRegion).toBe('y');
  });
});
