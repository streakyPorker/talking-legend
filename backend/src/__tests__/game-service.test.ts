import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../db/test-utils';
import { DbConnectionManager, boundDatabaseProxy } from '../db/db-connection-manager';
import { GameService } from '../game/game.service';
import { GameRepository } from '../db/repositories/game.repository';
import { WorldRepository } from '../db/repositories/world.repository';
import { NpcRepository } from '../db/repositories/npc.repository';
import { PlayerRepository } from '../db/repositories/player.repository';
import { StorylineRepository } from '../db/repositories/storyline.repository';
import { TravelLogRepository } from '../db/repositories/travel-log.repository';
import { SaveRepository } from '../db/repositories/save.repository';
import { NarrativeService } from '../game/narrative.service';
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
  let manager: DbConnectionManager;
  let narrativeService: NarrativeService;

  function buildService(
    dbInstance: Database.Database,
    dbManager: DbConnectionManager,
    worldsRoot = tmpRoot,
    narrativeDataDir = tmpRoot,
  ): GameService {
    worldConfig = new WorldConfigService({ worldsDir: worldsRoot } as ConfigService);
    worldConfig.loadFromDir(worldsRoot);
    const storylineRepo = new StorylineRepository(dbInstance);
    // Mock GMEngine — the integration test does not exercise LLM generation
    const mockGmEngine = {
      generate: async function* () {
        yield { type: 'chunk', content: 'Mock narrative' };
        yield { type: 'done', turn: 1, tokenEstimate: 0 };
      },
      generateWithTools: async function* () {
        yield { type: 'chunk', content: 'Mock narrative' };
        yield { type: 'done', turn: 1, tokenEstimate: 0 };
      },
    } as unknown as import('../llm/gm-engine').GMEngine;
    narrativeService = new NarrativeService({ gameDataDir: narrativeDataDir } as ConfigService);
    return new GameService(
      dbInstance,
      dbManager,
      new GameRepository(dbInstance),
      new WorldRepository(dbInstance),
      new NpcRepository(dbInstance),
      new PlayerRepository(dbInstance),
      storylineRepo,
      worldConfig,
      mockGmEngine,
      new WorldService(new WorldRepository(dbInstance)),
      new TravelLogRepository(dbInstance),
      new SaveRepository(dbInstance),
      narrativeService,
    );
  }

  beforeEach(() => {
    // In-memory DB for the non-persist suite; the manager just holds a
    // production-path witness so the service constructor is well-formed.
    db = createTestDb();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'game-service-test-'));
    writeAethelgard(tmpRoot);
    manager = new DbConnectionManager(path.join(tmpRoot, 'main.db'));
    service = buildService(db, manager);
  });

  afterEach(() => {
    manager.onModuleDestroy();
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
      service = buildService(db, manager);

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
      service = buildService(db, manager);

      await expect(
        service.createGame({ playerName: 'X', scenario: 'nope' }),
      ).rejects.toThrow(/Unknown scenario: nope\. Available: aethelgard, b-world/);
    });

    it('throws BadRequestException when no world configs are available', async () => {
      fs.rmSync(path.join(tmpRoot, 'aethelgard'), { recursive: true, force: true });
      service = buildService(db, manager);

      await expect(
        service.createGame({ playerName: 'X' }),
      ).rejects.toThrow('No world configs available');
    });
  });

  describe('performActionStream', () => {
    it('should emit chunks and done events', async () => {
      const { gameId } = await service.createGame({ playerName: 'TestHero' });

      const chunks: string[] = [];
      for await (const chunk of service.performActionStream(gameId, 'explore', 'forest')) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some((c) => c.includes('Mock narrative'))).toBe(true);
      expect(chunks.some((c) => JSON.parse(c).type === 'done')).toBe(true);
    });

    it('should throw for unknown game ID', async () => {
      await expect(async () => {
        const gen = service.performActionStream('non-existent-id', 'look around');
        for await (const _ of gen) {
          /* drain */
        }
      }).rejects.toThrow('Game not found');
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
      // RFC-016: player.location is synced to the world region on move
      expect(result.gameState.player.location).toBe('forest');

      // Verify travel log was recorded
      const logs = new TravelLogRepository(db).findByGameId(gameId);
      expect(logs).toHaveLength(1);
      expect(logs[0].fromRegion).toBe('village');
      expect(logs[0].toRegion).toBe('forest');
      expect(logs[0].trigger).toBe('click');
      expect(logs[0].turn).toBe(1);
    });

    it('click move consumes exactly one turn', async () => {
      const { gameId } = await service.createGame({ playerName: 'TurnCost' });
      expect(service.getGameState(gameId).turn).toBe(0);

      await service.moveToRegion(gameId, 'forest', 'click');
      expect(service.getGameState(gameId).turn).toBe(1);

      await service.moveToRegion(gameId, 'lake', 'click');
      expect(service.getGameState(gameId).turn).toBe(2);
    });

    it('dialogue move (GM tool) does NOT bump the turn', async () => {
      const { gameId } = await service.createGame({ playerName: 'DialogueMove' });
      expect(service.getGameState(gameId).turn).toBe(0);

      await service.moveToRegion(gameId, 'forest', 'dialogue', false);
      expect(service.getGameState(gameId).turn).toBe(0);
      expect(service.getGameState(gameId).world.currentRegion).toBe('forest');

      // travel_log records trigger=dialogue
      const logs = new TravelLogRepository(db).findByGameId(gameId);
      expect(logs).toHaveLength(1);
      expect(logs[0].trigger).toBe('dialogue');
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

  describe('save and load (real file DB)', () => {
    let saveService: GameService;
    let saveManager: DbConnectionManager;
    let saveAccessor: Database.Database;
    let saveDb: Database.Database;
    let realTmpRoot: string;
    // The service hardcodes process.cwd()/data/saves + data/games for FS
    // snapshot/narrative paths — keep those isolated and clean up after.
    const savesDir = path.join(process.cwd(), 'data', 'saves');
    const gamesDir = path.join(process.cwd(), 'data', 'games');

    beforeEach(() => {
      realTmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'game-service-file-'));
      writeAethelgard(realTmpRoot);
      // Remove any leftover prod data dirs from prior runs.
      if (fs.existsSync(savesDir)) fs.rmSync(savesDir, { recursive: true, force: true });
      if (fs.existsSync(gamesDir)) fs.rmSync(gamesDir, { recursive: true, force: true });
      // Real file DB (not :memory:) so VACUUM INTO + reset(copyFileSync) work.
      saveManager = new DbConnectionManager(path.join(realTmpRoot, 'main.db'));
      saveDb = saveManager.db;
      // Repos + GameService share a live-forwarding accessor so a load reset
      // (which swaps the underlying connection) is transparent to them.
      saveAccessor = boundDatabaseProxy(saveManager);
      // Narrative dir must be data/games so saveGame/load align with the
      // hardcoded process.cwd()/data path contract.
      saveService = buildService(saveAccessor, saveManager, realTmpRoot, gamesDir);
    });

    afterEach(() => {
      saveManager.onModuleDestroy();
      saveDb.close();
      fs.rmSync(realTmpRoot, { recursive: true, force: true });
      if (fs.existsSync(savesDir)) fs.rmSync(savesDir, { recursive: true, force: true });
      if (fs.existsSync(gamesDir)) fs.rmSync(gamesDir, { recursive: true, force: true });
    });

    it('saveGame creates a VACUUM INTO snapshot with latest turn/region + narrative', async () => {
      const { gameId } = await saveService.createGame({ playerName: 'SaveHero' });

      // Advance: click move bumps to turn 1 + region forest
      await saveService.moveToRegion(gameId, 'forest', 'click');
      expect(saveService.getGameState(gameId).turn).toBe(1);

      // Append narrative via NarrativeService (as GM would)
      narrativeService.append(gameId, 1, '旅程开始');

      const saveResult = await saveService.saveGame(gameId, 1);
      expect(saveResult.success).toBe(true);
      expect(saveResult.meta.slot).toBe(1);
      expect(saveResult.meta.playerName).toBe('SaveHero');
      expect(saveResult.meta.turn).toBe(1);
      expect(saveResult.meta.region).toBe('forest');
      expect(saveResult.meta.world).toBe('艾瑟尔加德');
      expect(saveResult.meta.savedAt).toBeDefined();

      // Snapshot DB file exists and is openable + contains latest state
      const snapshotPath = path.join(savesDir, 'slot_1.db');
      expect(fs.existsSync(snapshotPath)).toBe(true);
      const snapshotDb = new (require('better-sqlite3') as typeof import('better-sqlite3'))(
        snapshotPath,
        { readonly: true },
      );
      const gameRow = snapshotDb
        .prepare('SELECT turn, phase FROM games WHERE id = ?')
        .get(gameId) as { turn: number; phase: string };
      expect(gameRow.turn).toBe(1);
      const worldRow = snapshotDb
        .prepare('SELECT current_region FROM worlds WHERE game_id = ?')
        .get(gameId) as { current_region: string };
      expect(worldRow.current_region).toBe('forest');
      snapshotDb.close();

      // narrative snapshot exists
      expect(fs.existsSync(path.join(savesDir, 'slot_1.narrative.log'))).toBe(true);
    });

    it('rejects invalid slots', async () => {
      await saveService.createGame({ playerName: 'Hero' });
      await expect(saveService.saveGame('any', -1)).rejects.toThrow('0-99');
      await expect(saveService.saveGame('any', 100)).rejects.toThrow('0-99');
      await expect(saveService.saveGame('any', 1.5)).rejects.toThrow('0-99');
    });

    it('load resets the connection to the saved snapshot state', async () => {
      const { gameId } = await saveService.createGame({ playerName: 'LoadHero' });
      await saveService.moveToRegion(gameId, 'forest', 'click');
      const saved = await saveService.saveGame(gameId, 1);

      // Mutate the live DB away from the snapshot (click move → lake, turn 2)
      await saveService.moveToRegion(gameId, 'lake', 'click');
      expect(saveService.getGameState(gameId).turn).toBe(2);
      expect(saveService.getGameState(gameId).world.currentRegion).toBe('lake');

      // Load slot 1 → should return to saved turn 1 / region forest
      const loadResult = saveService.loadSave(1);
      expect(loadResult.success).toBe(true);
      expect(loadResult.gameId).toBe(gameId);

      // The live connection (same manager.db handle) now reads the snapshot
      expect(saveService.getGameState(gameId).turn).toBe(1);
      expect(saveService.getGameState(gameId).world.currentRegion).toBe('forest');
      expect(saved.meta.gameId).toBe(gameId);
    });

    it('load restores narrative.log from the slot snapshot', async () => {
      const { gameId } = await saveService.createGame({ playerName: 'NarrHero' });
      narrativeService.append(gameId, 1, '第一轮叙事');
      await saveService.saveGame(gameId, 1);

      // Remove the live narrative (simulate drift), then load restores it
      const liveNarr = path.join(gamesDir, gameId, 'narrative.log');
      fs.rmSync(gamesDir, { recursive: true, force: true });
      expect(fs.existsSync(liveNarr)).toBe(false);

      saveService.loadSave(1);
      expect(fs.existsSync(liveNarr)).toBe(true);
      expect(fs.readFileSync(liveNarr, 'utf-8')).toContain('第一轮叙事');
    });

    it('should list all saves', async () => {
      const { gameId } = await saveService.createGame({ playerName: 'ListHero' });

      // Save to 2 slots
      await saveService.saveGame(gameId, 1);
      await saveService.saveGame(gameId, 2);

      const saves = saveService.listSaves();
      expect(saves).toHaveLength(2);

      const slot1 = saves.find((s) => s.slot === 1);
      expect(slot1).toBeDefined();
      expect(slot1!.playerName).toBe('ListHero');

      const slot2 = saves.find((s) => s.slot === 2);
      expect(slot2).toBeDefined();
      expect(slot2!.playerName).toBe('ListHero');
    });

    it('should delete save and free slot (removes files)', async () => {
      const { gameId } = await saveService.createGame({ playerName: 'DeleteHero' });

      await saveService.saveGame(gameId, 1);
      await saveService.saveGame(gameId, 2);

      // Delete slot 1
      await saveService.deleteSave(1);

      // Slot 1 should no longer exist
      const saves = saveService.listSaves();
      expect(saves).toHaveLength(1);
      expect(saves[0].slot).toBe(2);

      // Save files should be gone
      expect(fs.existsSync(path.join(savesDir, 'slot_1.db'))).toBe(false);
      expect(fs.existsSync(path.join(savesDir, 'slot_1.narrative.log'))).toBe(false);

      // Loading deleted slot should throw
      expect(() => saveService.loadSave(1)).toThrow('Save slot 1 not found');
    });
  });
});
