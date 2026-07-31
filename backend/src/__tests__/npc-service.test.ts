/**
 * NpcService integration test.
 *
 * Tests the full NPC dialogue chain with a real SQLite DB and repositories,
 * mocking only the LLM engine (NpcEngine.generate). This ensures DB
 * persistence, region validation, and concurrency locking work correctly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../db/test-utils';
import { NpcService } from '../npc/npc.service';
import { NpcRepository } from '../db/repositories/npc.repository';
import { WorldRepository } from '../db/repositories/world.repository';
import { PlayerRepository } from '../db/repositories/player.repository';
import { GameRepository } from '../db/repositories/game.repository';
import { GameEventsRepository } from '../db/repositories/game-events.repository';
import { NarrativeService } from '../game/narrative.service';
import { DB_INSTANCE } from '../db/tokens';
import type { NpcStreamEvent } from '../llm/npc-engine';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

// ---------- helpers ----------

function createGame(db: Database.Database, gameId: string): void {
  const gameRepo = new GameRepository(db);
  gameRepo.create(gameId, 'TestPlayer');
}

function createWorld(db: Database.Database, gameId: string): void {
  const worldRepo = new WorldRepository(db);
  worldRepo.upsert(gameId, {
    name: 'TestWorld',
    description: 'A world for testing',
    currentRegion: 'village',
    timeOfDay: 'morning',
    weather: 'clear',
    regions: [
      { id: 'village', name: 'Village', description: 'A small village', connectedRegions: [] },
      { id: 'forest', name: 'Forest', description: 'A dark forest', connectedRegions: [] },
    ],
    globalEvents: [],
  });
}

function createPlayer(db: Database.Database, gameId: string, location = 'village'): void {
  const playerRepo = new PlayerRepository(db);
  playerRepo.upsert(gameId, {
    name: 'TestPlayer',
    location,
    inventory: [],
    reputation: {},
    quests: [],
  });
}

function createNpc(
  db: Database.Database,
  gameId: string,
  npcId: string,
  location = 'village',
): void {
  const npcRepo = new NpcRepository(db);
  npcRepo.create(gameId, {
    id: npcId,
    name: 'Elder',
    role: 'village elder',
    personality: 'Wise and kind',
    currentMood: 'peaceful',
    location,
    memoryOfPlayer: [],
    isAlive: true,
  });
}

/**
 * Create a mock NpcEngine whose generate() yields the given events.
 */
function mockNpcEngine(events: NpcStreamEvent[]) {
  const generateFn = vi.fn().mockImplementation(
    async function* (): AsyncGenerator<NpcStreamEvent> {
      for (const event of events) {
        yield event;
      }
    },
  );
  return {
    generate: generateFn,
    generateWithTools: vi.fn(),
  };
}

/**
 * Build a minimal mock for the LLMClient — only used by generateSummary
 * so a basic stub suffices.
 */
function mockLlmClient() {
  return {
    call: vi.fn().mockResolvedValue({ content: 'Test summary.' }),
    stream: vi.fn(),
    sonnetModel: 'test-sonnet',
    opusModel: 'test-opus',
    haikuModel: 'test-haiku',
  } as unknown as import('../llm/client').LLMClient;
}

/**
 * Build a minimal ConfigService stub for NarrativeService.
 */
function mockConfigService() {
  return {
    gameDataDir: '',
  } as unknown as import('../config/config.service').ConfigService;
}

// ---------- suite ----------

describe('NpcService', () => {
  let db: Database.Database;
  let npcRepo: NpcRepository;
  let worldRepo: WorldRepository;
  let playerRepo: PlayerRepository;
  let service: NpcService;
  let mockEngine: ReturnType<typeof mockNpcEngine>;

  // Shared fixture IDs
  const gameId = 'game-npc-test';
  const npcId = 'npc-elder';

  beforeEach(() => {
    db = createTestDb();
    npcRepo = new NpcRepository(db);
    worldRepo = new WorldRepository(db);
    playerRepo = new PlayerRepository(db);

    // Create game, world, player, npc
    createGame(db, gameId);
    createWorld(db, gameId);
    createPlayer(db, gameId, 'village');
    createNpc(db, gameId, npcId, 'village');

    // Default mock: a simple dialogue response
    mockEngine = mockNpcEngine([
      { type: 'chunk', content: 'Hello traveller, what brings you here?' },
      { type: 'done', turn: -1, tokenEstimate: 50 },
    ]);

    service = new NpcService(
      db,
      npcRepo,
      mockEngine as unknown as import('../llm/npc-engine').NpcEngine,
      worldRepo,
      playerRepo,
      new GameEventsRepository(db),
      new NarrativeService(mockConfigService()),
      mockLlmClient(),
    );
  });

  afterEach(() => {
    db.close();
  });

  // ── talkStream ─────────────────────────────────────────────

  describe('talkStream', () => {
    it('should stream NPC dialogue and persist memories', async () => {
      const generator = service.talkStream(gameId, npcId, '你好');
      const collected: string[] = [];
      for await (const chunk of generator) {
        collected.push(chunk);
      }

      // Verify events were streamed
      expect(collected.length).toBeGreaterThanOrEqual(2);
      expect(JSON.parse(collected[0])).toMatchObject({ type: 'chunk' });
      expect(JSON.parse(collected[collected.length - 1])).toMatchObject({ type: 'done' });

      // Verify engine was called with correct args
      expect(mockEngine.generate).toHaveBeenCalledTimes(1);
      expect(mockEngine.generate).toHaveBeenCalledWith(
        gameId,
        expect.objectContaining({ id: npcId }),
        '你好',
        'TestPlayer',
        expect.any(Array),
      );

      // Verify memories were persisted to DB
      const memories = npcRepo.getMemories(npcId);
      expect(memories.length).toBeGreaterThanOrEqual(2);
      // Player's message stored as role||content format
      expect(memories.some(m => m.includes('user||你好'))).toBe(true);
      // NPC response stored as role||content format
      expect(memories.some(m => m.includes('assistant||Hello traveller'))).toBe(true);
    });

    it('should fail when NPC is in different region', async () => {
      // Move player to forest while NPC stays in village
      const playerRepoLocal = new PlayerRepository(db);
      playerRepoLocal.upsert(gameId, {
        name: 'TestPlayer',
        location: 'forest',
        inventory: [],
        reputation: {},
        quests: [],
      });

      const generator = service.talkStream(gameId, npcId, '你好');

      await expect(async () => {
        for await (const _ of generator) {
          // consume — will throw on first next()
        }
      }).rejects.toThrow(BadRequestException);

      // Verify no memories were written
      const memories = npcRepo.getMemories(npcId);
      expect(memories).toHaveLength(0);
    });

    it('should fail when NPC does not exist', async () => {
      const generator = service.talkStream(gameId, 'nonexistent-npc', '你好');

      await expect(async () => {
        for await (const _ of generator) {
          // consume
        }
      }).rejects.toThrow(NotFoundException);
    });

    it('should lock NPC during active conversation and reject concurrent calls', async () => {
      // Create an engine mock that yields slowly (deferred generator)
      // so the lock stays active while the second call arrives.
      const slowEngine = {
        generate: vi.fn().mockImplementation(
          async function* (): AsyncGenerator<NpcStreamEvent> {
            yield { type: 'chunk', content: 'Starting...' };
            // Yield a never-resolving promise to keep generator alive
            await new Promise(() => { /* never resolves */ });
          },
        ),
        generateWithTools: vi.fn(),
      };

      const slowService = new NpcService(
        db,
        npcRepo,
        slowEngine as unknown as import('../llm/npc-engine').NpcEngine,
        worldRepo,
        playerRepo,
        new GameEventsRepository(db),
        new NarrativeService(mockConfigService()),
        mockLlmClient(),
      );

      // Start first conversation (don't await — it will hang)
      const gen1 = slowService.talkStream(gameId, npcId, 'Hello');
      // Start consuming to trigger lock acquisition
      const iter1 = gen1[Symbol.asyncIterator]();
      await iter1.next(); // This triggers the lock

      // Second call on same NPC should throw ConflictException immediately
      await expect(
        slowService.talkStream(gameId, npcId, 'Hello again').next(),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── getMemories ──────────────────────────────────────────

  describe('getMemories', () => {
    it('should return structured memories via getMemories', async () => {
      // Insert memories directly
      npcRepo.addMemory(npcId, 'user||First message', 0, 3, 'dialogue');
      npcRepo.addMemory(npcId, 'assistant||First response', 0, 3, 'dialogue');
      npcRepo.addMemory(npcId, 'user||Second message', 0, 4, 'dialogue');

      const memories = service.getMemories(npcId);
      expect(memories).toHaveLength(3);
      // Each memory should have the right shape
      for (const mem of memories) {
        expect(mem).toHaveProperty('content');
        expect(mem).toHaveProperty('importance');
        expect(mem).toHaveProperty('type');
        // Content should NOT contain the role|| prefix
        expect(mem.content).not.toMatch(/^(user|assistant)\|\|/);
      }
    });

    it('should throw NotFoundException for non-existent NPC', () => {
      expect(() => service.getMemories('nonexistent')).toThrow(NotFoundException);
    });
  });

  // ── NPC memories ──────────────────────────────────────────

  describe('npc memories', () => {
    it('should store and retrieve NPC memories with importance', () => {
      npcRepo.addMemory(npcId, 'The hero arrived in the village', 0, 3, 'observation');

      // getMemories on service strips role|| prefix and returns structured objects
      const memories = service.getMemories(npcId);
      const matching = memories.filter(m => m.content === 'The hero arrived in the village');
      expect(matching).toHaveLength(1);
      expect(matching[0].importance).toBe(3);
      expect(matching[0].type).toBe('observation');
    });

    it('should return empty array for NPC with no memories', () => {
      const memories = service.getMemories(npcId);
      expect(memories).toEqual([]);
    });
  });
});
