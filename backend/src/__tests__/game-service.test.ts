import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../db/test-utils';
import { GameService } from '../game/game.service';
import { GameRepository } from '../db/repositories/game.repository';
import { WorldRepository } from '../db/repositories/world.repository';
import { NpcRepository } from '../db/repositories/npc.repository';
import { PlayerRepository } from '../db/repositories/player.repository';
import { StorylineRepository } from '../db/repositories/storyline.repository';
import { TravelLogRepository } from '../db/repositories/travel-log.repository';
import { WorldConfigService } from '../world-config/world-config.service';
import type { ConfigService } from '../config/config.service';

// ---------- fixture builders ----------

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

interface FixtureRegion {
  id: string;
  name: string;
  description: string;
  connectedRegions: string[];
}

interface FixtureNpc {
  key: string;
  name: string;
  role: string;
  personality: string;
  initialMood: string;
  location: string;
}

function writeWorld(
  root: string,
  id: string,
  opts: {
    name: string;
    description: string;
    startingRegion: string;
    regions: FixtureRegion[];
    npcs: FixtureNpc[];
  },
): void {
  writeJson(path.join(root, id, 'world.json'), {
    id,
    name: opts.name,
    description: opts.description,
    startingRegion: opts.startingRegion,
  });
  for (const region of opts.regions) {
    writeJson(path.join(root, id, 'regions', `${region.id}.json`), region);
  }
  for (const npc of opts.npcs) {
    writeJson(path.join(root, id, 'npcs', `${npc.key}.json`), npc);
  }
}

// Copy canonical aethelgard config from worlds/aethelgard/ so the integration
// test stays in sync with the real content.  Uses fs.cpSync (Node 16.7+).
function writeAethelgard(root: string): void {
  const src = path.resolve(__dirname, '..', '..', '..', 'worlds', 'aethelgard');
  fs.cpSync(src, path.join(root, 'aethelgard'), { recursive: true });
}

function writeSecondWorld(root: string): void {
  writeWorld(root, 'b-world', {
    name: 'B World',
    description: 'A second world for scenario selection.',
    startingRegion: 'hub',
    regions: [
      { id: 'hub', name: 'Hub', description: 'Central hub.', connectedRegions: [] },
    ],
    npcs: [
      { key: 'guide', name: 'Guide', role: 'Greeter', personality: 'Cheerful.', initialMood: 'happy', location: 'hub' },
    ],
  });
}

// ---------- suite ----------

describe('GameService', () => {
  let db: Database.Database;
  let tmpRoot: string;
  let worldConfig: WorldConfigService;
  let service: GameService;

  function buildService(): void {
    worldConfig = new WorldConfigService({ worldsDir: tmpRoot } as ConfigService);
    worldConfig.loadFromDir(tmpRoot);
    const storylineRepo = new StorylineRepository(db);
    // Mock GMEngine — the integration test does not exercise LLM generation
    const mockGmEngine = {
      generate: async function* () {
        yield { type: 'chunk', content: 'Mock narrative' };
        yield { type: 'done', turn: 1, tokenEstimate: 0 };
      },
    } as unknown as import('../llm/gm-engine').GMEngine;
    service = new GameService(
      db,
      new GameRepository(db),
      new WorldRepository(db),
      new NpcRepository(db),
      new PlayerRepository(db),
      storylineRepo,
      worldConfig,
      mockGmEngine,
      {} as never,  // WorldService mock
      new TravelLogRepository(db),
    );
  }

  beforeEach(() => {
    db = createTestDb();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'game-service-test-'));
    writeAethelgard(tmpRoot);
    buildService();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('createGame', () => {
    it('should create a new game with valid input', async () => {
      const result = await service.createGame({ playerName: 'TestHero' });

      expect(result.gameId).toBeDefined();
      expect(result.gameId).toMatch(/^[a-f0-9-]{36}$/);
      expect(result.initialState.player.name).toBe('TestHero');
      expect(result.initialState.world.name).toBe('艾瑟尔加德');
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
      expect(world!.name).toBe('艾瑟尔加德');

      const npcs = npcRepo.findByGameId(gameId);
      expect(npcs).toHaveLength(2);
    });

    it('DB rows match returned state (regression)', async () => {
      const result = await service.createGame({ playerName: 'Regression' });
      const { gameId, initialState } = result;

      const worldRepo = new WorldRepository(db);
      const npcRepo = new NpcRepository(db);
      const playerRepo = new PlayerRepository(db);

      expect(worldRepo.findByGameId(gameId)).toEqual(initialState.world);
      expect(npcRepo.findByGameId(gameId)).toEqual(initialState.npcs);
      expect(playerRepo.findByGameId(gameId)).toEqual(initialState.player);
    });

    it('seeds NPC instances with uuid ids and no leaked config keys', async () => {
      const result = await service.createGame({ playerName: 'KeyCheck' });
      const { gameId, initialState } = result;

      for (const npc of initialState.npcs) {
        expect(npc.id).toMatch(/^[a-f0-9-]{36}$/);
        // config `key` must not appear anywhere on the NPC instance
        expect(Object.keys(npc)).not.toContain('key');
        expect(JSON.stringify(npc)).not.toContain('elder-marin');
        expect(JSON.stringify(npc)).not.toContain('ranger-kael');
      }

      // And not in the persisted DB rows either
      const npcRepo = new NpcRepository(db);
      const rows = npcRepo.findByGameId(gameId);
      for (const row of rows) {
        expect(Object.keys(row)).not.toContain('key');
        expect(JSON.stringify(row)).not.toContain('elder-marin');
        expect(JSON.stringify(row)).not.toContain('ranger-kael');
      }
    });

    it('uses the specified world when scenario is provided', async () => {
      writeSecondWorld(tmpRoot);
      buildService();

      const result = await service.createGame({
        playerName: 'ScenarioHero',
        scenario: 'b-world',
      });

      expect(result.initialState.world.name).toBe('B World');
      expect(result.initialState.player.location).toBe('hub');
      expect(result.initialState.world.currentRegion).toBe('hub');
      expect(result.initialState.npcs).toHaveLength(1);
      expect(result.initialState.npcs[0].name).toBe('Guide');
      expect(result.initialState.npcs[0].currentMood).toBe('happy');
    });

    it('throws BadRequestException for unknown scenario, listing available ids', async () => {
      writeSecondWorld(tmpRoot);
      buildService();

      await expect(
        service.createGame({ playerName: 'X', scenario: 'nope' }),
      ).rejects.toThrow(/Unknown scenario: nope\. Available: aethelgard, b-world/);
    });

    it('throws BadRequestException when no world configs are available', async () => {
      fs.rmSync(path.join(tmpRoot, 'aethelgard'), { recursive: true, force: true });
      buildService();

      await expect(
        service.createGame({ playerName: 'X' }),
      ).rejects.toThrow('No world configs available');
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
