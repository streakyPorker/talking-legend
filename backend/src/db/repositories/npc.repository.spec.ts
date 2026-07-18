import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../test-utils';
import { NpcRepository } from './npc.repository';
import { GameRepository } from './game.repository';

describe('NpcRepository', () => {
  let db: Database.Database;
  let repo: NpcRepository;
  let gameRepo: GameRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new NpcRepository(db);
    gameRepo = new GameRepository(db);
    // Games table is parent for NPCs (FK constraint)
    gameRepo.create('game-1', 'Hero');
  });

  afterEach(() => {
    db.close();
  });

  const sampleNpc = {
    id: 'npc-1',
    name: 'Elder Marin',
    role: 'Village Elder',
    personality: 'Wise and patient',
    currentMood: 'welcoming',
    location: 'village',
    memoryOfPlayer: [],
    isAlive: true,
  };

  it('create and findByGameId', () => {
    repo.create('game-1', sampleNpc);

    const npcs = repo.findByGameId('game-1');
    expect(npcs).toHaveLength(1);
    expect(npcs[0].name).toBe('Elder Marin');
    expect(npcs[0].isAlive).toBe(true);
  });

  it('findById returns a single NPC', () => {
    repo.create('game-1', sampleNpc);
    const found = repo.findById('npc-1');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Elder Marin');
  });

  it('findById returns undefined for missing NPC', () => {
    expect(repo.findById('non-existent')).toBeUndefined();
  });

  it('create stores memories', () => {
    const npcWithMemories = {
      ...sampleNpc,
      memoryOfPlayer: ['Greeted the player warmly', 'Told a story about the forest'],
    };
    repo.create('game-1', npcWithMemories);

    const memories = repo.getMemories('npc-1');
    expect(memories).toHaveLength(2);
    expect(memories[0]).toBe('Greeted the player warmly');
  });

  it('addMemory appends a memory entry', () => {
    repo.create('game-1', sampleNpc);
    repo.addMemory('npc-1', 'Player helped the village', 1);

    const memories = repo.getMemories('npc-1');
    expect(memories).toHaveLength(1);
    expect(memories[0]).toBe('Player helped the village');
  });

  it('update modifies NPC fields', () => {
    repo.create('game-1', sampleNpc);
    repo.update('npc-1', { currentMood: 'angry', location: 'forest' });

    const npc = repo.findById('npc-1');
    expect(npc!.currentMood).toBe('angry');
    expect(npc!.location).toBe('forest');
    expect(npc!.name).toBe('Elder Marin'); // unchanged
  });

  it('delete removes NPC and its memories', () => {
    repo.create('game-1', sampleNpc);
    repo.addMemory('npc-1', 'Some memory', 1);
    repo.delete('npc-1');

    expect(repo.findById('npc-1')).toBeUndefined();
    expect(repo.getMemories('npc-1')).toHaveLength(0);
  });

  it('findByGameId returns empty array for game with no NPCs', () => {
    expect(repo.findByGameId('game-1')).toHaveLength(0);
  });

  it('is_alive maps correctly to/from boolean', () => {
    const deadNpc = { ...sampleNpc, id: 'npc-dead', isAlive: false };
    repo.create('game-1', deadNpc);

    const npc = repo.findById('npc-dead');
    expect(npc!.isAlive).toBe(false);
  });
});
