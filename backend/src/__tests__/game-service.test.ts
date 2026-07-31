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
import { SaveRepository } from '../db/repositories/save.repository';
import { WorldConfigService } from '../world-config/world-config.service';
import { WorldService } from '../world/world.service';
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
      new WorldService(new WorldRepository(db)),
      new TravelLogRepository(db),
      new SaveRepository(db),
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

  describe('moveToRegion', () => {
    it('should move player to connected region and record travel log', async () => {
      const { gameId } = await service.createGame({ playerName: 'Traveler' });

      // village is connected to forest in aethelgard
      const result = await service.moveToRegion(gameId, 'forest', 'click');

      expect(result.success).toBe(true);
      expect(result.message).toContain('前往');
      expect(result.narrative).toBeDefined();
      expect(result.gameState).toBeDefined();
      expect(result.gameState.world.currentRegion).toBe('forest');
      // Note: player.location is not updated by moveToRegion — only world.currentRegion changes

      // Verify travel log was recorded
      const logs = new TravelLogRepository(db).findByGameId(gameId);
      expect(logs).toHaveLength(1);
      expect(logs[0].fromRegion).toBe('village');
      expect(logs[0].toRegion).toBe('forest');
      expect(logs[0].trigger).toBe('click');
    });

    it('should fail when target region is not connected', async () => {
      const { gameId } = await service.createGame({ playerName: 'LostTraveler' });

      // lake only connects to forest, NOT directly to village
      await expect(
        service.moveToRegion(gameId, 'lake', 'click'),
      ).rejects.toThrow('无法到达');
    });

    it('should persist region change across game state reads', async () => {
      const { gameId } = await service.createGame({ playerName: 'PersistRegion' });

      // First move: village → forest
      const firstResult = await service.moveToRegion(gameId, 'forest', 'click');
      expect(firstResult.gameState.world.currentRegion).toBe('forest');

      // Second move: forest → lake (connected from forest)
      const secondResult = await service.moveToRegion(gameId, 'lake', 'click');
      expect(secondResult.gameState.world.currentRegion).toBe('lake');

      // Direct repo read should confirm the region change
      const worldRepo = new WorldRepository(db);
      const world = worldRepo.findByGameId(gameId);
      expect(world).toBeDefined();
      expect(world!.currentRegion).toBe('lake');
    });
  });

  // TODO: save/load 测试需要文件 DB（:memory: 无法做 fs.copyFileSync）
// 后续 RFC 创建 FileTestDb fixture 后启用
describe.skip('save and load', () => {
    const savesDir = path.join(process.cwd(), 'data', 'saves');
    const dbFile = path.join(process.cwd(), 'data', 'talking-legend.db');

    beforeEach(() => {
      // Create a stub DB file so saveGame can copy it
      fs.mkdirSync(path.dirname(dbFile), { recursive: true });
      fs.writeFileSync(dbFile, '', 'utf-8');
    });

    afterEach(() => {
      if (fs.existsSync(savesDir)) {
        fs.rmSync(savesDir, { recursive: true, force: true });
      }
      if (fs.existsSync(dbFile)) {
        fs.unlinkSync(dbFile);
      }
    });

    it('should save game to slot and reload with same state', async () => {
      const { gameId } = await service.createGame({ playerName: 'SaveHero' });

      // Advance one turn
      await service.performAction(gameId, {
        gameId,
        action: 'look around',
      });

      // Move to forest
      await service.moveToRegion(gameId, 'forest', 'click');

      // Save to slot 1
      const saveResult = await service.saveGame(gameId, 1);
      expect(saveResult.success).toBe(true);
      expect(saveResult.meta.slot).toBe(1);
      expect(saveResult.meta.playerName).toBe('SaveHero');
      expect(saveResult.meta.turn).toBe(1);
      expect(saveResult.meta.region).toBe('forest');
      expect(saveResult.meta.world).toBe('艾瑟尔加德');
      expect(saveResult.meta.savedAt).toBeDefined();

      // Verify the save file was created
      expect(fs.existsSync(path.join(savesDir, 'slot_1.db'))).toBe(true);

      // Load the save
      const loadResult = service.loadSave(1);
      expect(loadResult.success).toBe(true);
      expect(loadResult.meta.slot).toBe(1);
      expect(loadResult.meta.turn).toBe(1);
      expect(loadResult.meta.region).toBe('forest');
    });

    it('should list all saves', async () => {
      const { gameId } = await service.createGame({ playerName: 'ListHero' });

      // Save to 2 slots
      await service.saveGame(gameId, 1);
      await service.saveGame(gameId, 2);

      const saves = service.listSaves();
      expect(saves).toHaveLength(2);

      const slot1 = saves.find((s) => s.slot === 1);
      expect(slot1).toBeDefined();
      expect(slot1!.playerName).toBe('ListHero');

      const slot2 = saves.find((s) => s.slot === 2);
      expect(slot2).toBeDefined();
      expect(slot2!.playerName).toBe('ListHero');
    });

    it('should delete save and free slot', async () => {
      const { gameId } = await service.createGame({ playerName: 'DeleteHero' });

      await service.saveGame(gameId, 1);
      await service.saveGame(gameId, 2);

      // Delete slot 1
      await service.deleteSave(1);

      // Slot 1 should no longer exist
      const saves = service.listSaves();
      expect(saves).toHaveLength(1);
      expect(saves[0].slot).toBe(2);

      // Save file should be gone
      expect(fs.existsSync(path.join(savesDir, 'slot_1.db'))).toBe(false);

      // Loading deleted slot should throw
      expect(() => service.loadSave(1)).toThrow('Save slot 1 not found');
    });
  });

  describe.skip('auto-save', () => {
    const savesDir = path.join(process.cwd(), 'data', 'saves');
    const dbFile = path.join(process.cwd(), 'data', 'talking-legend.db');

    beforeEach(() => {
      fs.mkdirSync(path.dirname(dbFile), { recursive: true });
      fs.writeFileSync(dbFile, '', 'utf-8');
    });

    afterEach(() => {
      if (fs.existsSync(savesDir)) {
        fs.rmSync(savesDir, { recursive: true, force: true });
      }
      if (fs.existsSync(dbFile)) {
        fs.unlinkSync(dbFile);
      }
    });

    it('should auto-save to slot 0', async () => {
      const { gameId } = await service.createGame({ playerName: 'AutoSaveHero' });

      await service.autoSave(gameId);

      const saveMeta = service.loadSave(0);
      expect(saveMeta.success).toBe(true);
      expect(saveMeta.meta.slot).toBe(0);
      expect(saveMeta.meta.playerName).toBe('AutoSaveHero');

      // Verify the file exists
      expect(fs.existsSync(path.join(savesDir, 'slot_0.db'))).toBe(true);
    });
  });
});
