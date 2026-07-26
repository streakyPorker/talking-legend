import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorldConfigService } from './world-config.service';
import type { ConfigService } from '../config/config.service';
import type { NpcConfig, RegionConfig } from './world-config.schema';

// ---------- fixture builders ----------

function makeRegion(id: string, connected: string[] = []): RegionConfig {
  return {
    id,
    name: `Region ${id}`,
    description: `Description of ${id}`,
    connectedRegions: connected,
  };
}

function makeNpc(key: string, location: string): NpcConfig {
  return {
    key,
    name: `NPC ${key}`,
    role: 'villager',
    personality: 'friendly',
    initialMood: 'calm',
    location,
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function writeRaw(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

// Build the canonical "demo-world" in INLINE form (everything in world.json).
function inlineWorld(): {
  id: string;
  name: string;
  description: string;
  startingRegion: string;
  regions: RegionConfig[];
  npcs: NpcConfig[];
} {
  return {
    id: 'demo-world',
    name: 'Demo World',
    description: 'A demo world',
    startingRegion: 'village',
    regions: [makeRegion('village', ['forest']), makeRegion('forest', ['village'])],
    npcs: [makeNpc('elder', 'village')],
  };
}

// ---------- fake ConfigService ----------

function fakeConfig(worldsDir: string): ConfigService {
  // Only worldsDir is read by WorldConfigService.
  return { worldsDir } as ConfigService;
}

// ---------- test suite ----------

describe('WorldConfigService', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'world-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function makeService(): WorldConfigService {
    return new WorldConfigService(fakeConfig(tmpRoot));
  }

  describe('inline form', () => {
    it('loads a world defined entirely inside world.json', () => {
      writeJson(path.join(tmpRoot, 'demo-world', 'world.json'), inlineWorld());

      const svc = makeService();
      svc.loadFromDir(tmpRoot);

      const world = svc.getWorld('demo-world');
      expect(world).toBeDefined();
      expect(world!.id).toBe('demo-world');
      expect(world!.regions).toHaveLength(2);
      expect(world!.npcs).toHaveLength(1);
    });
  });

  describe('split form', () => {
    it('loads a world split across regions/ and npcs/ directories', () => {
      const inline = inlineWorld();
      writeJson(path.join(tmpRoot, 'demo-world', 'world.json'), {
        id: inline.id,
        name: inline.name,
        description: inline.description,
        startingRegion: inline.startingRegion,
      });
      writeJson(
        path.join(tmpRoot, 'demo-world', 'regions', 'village.json'),
        inline.regions[0],
      );
      writeJson(
        path.join(tmpRoot, 'demo-world', 'regions', 'forest.json'),
        inline.regions[1],
      );
      writeJson(path.join(tmpRoot, 'demo-world', 'npcs', 'elder.json'), inline.npcs[0]);

      const svc = makeService();
      svc.loadFromDir(tmpRoot);

      const world = svc.getWorld('demo-world');
      expect(world).toBeDefined();
      // Deep-equal modulo ordering: sort both by id/key before comparing.
      const keyOf = (x: { id?: string; key?: string }): string => x.id ?? x.key ?? '';
      const sortBy = <T extends { id?: string; key?: string }>(arr: T[]): T[] =>
        [...arr].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
      expect(sortBy(world!.regions)).toEqual(sortBy(inline.regions));
      expect(sortBy(world!.npcs)).toEqual(sortBy(inline.npcs));
      expect(world!.id).toBe(inline.id);
      expect(world!.name).toBe(inline.name);
      expect(world!.description).toBe(inline.description);
      expect(world!.startingRegion).toBe(inline.startingRegion);
    });
  });

  describe('mixed form', () => {
    it('merges inline regions with npcs/ directory', () => {
      const inline = inlineWorld();
      writeJson(path.join(tmpRoot, 'demo-world', 'world.json'), {
        id: inline.id,
        name: inline.name,
        description: inline.description,
        startingRegion: inline.startingRegion,
        regions: inline.regions,
        // npcs NOT inline — comes from npcs/ dir
      });
      writeJson(path.join(tmpRoot, 'demo-world', 'npcs', 'elder.json'), inline.npcs[0]);

      const svc = makeService();
      svc.loadFromDir(tmpRoot);

      const world = svc.getWorld('demo-world');
      expect(world).toBeDefined();
      expect(world!.regions).toHaveLength(2);
      expect(world!.npcs).toHaveLength(1);
      expect(world!.npcs[0].key).toBe('elder');
    });

    it('merges regions.json single-file with inline npcs', () => {
      const inline = inlineWorld();
      writeJson(path.join(tmpRoot, 'demo-world', 'world.json'), {
        id: inline.id,
        name: inline.name,
        description: inline.description,
        startingRegion: inline.startingRegion,
        npcs: inline.npcs,
      });
      writeJson(path.join(tmpRoot, 'demo-world', 'regions.json'), inline.regions);

      const svc = makeService();
      svc.loadFromDir(tmpRoot);

      const world = svc.getWorld('demo-world');
      expect(world).toBeDefined();
      expect(world!.regions).toHaveLength(2);
      expect(world!.npcs).toHaveLength(1);
    });
  });

  describe('per-file error tolerance', () => {
    it('skips a corrupt regions/bad.json but still loads other regions', () => {
      const inline = inlineWorld();
      writeJson(path.join(tmpRoot, 'demo-world', 'world.json'), {
        id: inline.id,
        name: inline.name,
        description: inline.description,
        startingRegion: inline.startingRegion,
        npcs: inline.npcs,
      });
      writeJson(
        path.join(tmpRoot, 'demo-world', 'regions', 'village.json'),
        inline.regions[0],
      );
      writeJson(
        path.join(tmpRoot, 'demo-world', 'regions', 'forest.json'),
        inline.regions[1],
      );
      writeRaw(
        path.join(tmpRoot, 'demo-world', 'regions', 'bad.json'),
        '{ this is not json',
      );

      const svc = makeService();
      svc.loadFromDir(tmpRoot);

      const world = svc.getWorld('demo-world');
      expect(world).toBeDefined();
      expect(world!.regions).toHaveLength(2);
    });

    it('skips a schema-invalid regions/x.json but still loads other regions', () => {
      const inline = inlineWorld();
      writeJson(path.join(tmpRoot, 'demo-world', 'world.json'), {
        id: inline.id,
        name: inline.name,
        description: inline.description,
        startingRegion: inline.startingRegion,
        npcs: inline.npcs,
      });
      writeJson(
        path.join(tmpRoot, 'demo-world', 'regions', 'village.json'),
        inline.regions[0],
      );
      writeJson(
        path.join(tmpRoot, 'demo-world', 'regions', 'forest.json'),
        inline.regions[1],
      );
      writeJson(path.join(tmpRoot, 'demo-world', 'regions', 'broken.json'), {
        id: '', // empty id fails schema
        name: 'Broken',
        description: 'broken',
        connectedRegions: [],
      });

      const svc = makeService();
      svc.loadFromDir(tmpRoot);

      const world = svc.getWorld('demo-world');
      expect(world).toBeDefined();
      expect(world!.regions).toHaveLength(2);
    });

    it('skips a corrupt regions.json single-file but still loads inline npcs', () => {
      const inline = inlineWorld();
      writeJson(path.join(tmpRoot, 'demo-world', 'world.json'), {
        id: inline.id,
        name: inline.name,
        description: inline.description,
        startingRegion: 'village',
        regions: inline.regions, // inline regions still valid
        npcs: inline.npcs,
      });
      writeRaw(path.join(tmpRoot, 'demo-world', 'regions.json'), '[ not json');

      const svc = makeService();
      svc.loadFromDir(tmpRoot);

      const world = svc.getWorld('demo-world');
      expect(world).toBeDefined();
      expect(world!.regions).toHaveLength(2); // inline only
    });
  });

  describe('world-level error tolerance', () => {
    it('skips a world with corrupt world.json but still loads other worlds', () => {
      writeJson(path.join(tmpRoot, 'good-world', 'world.json'), {
        id: 'good-world',
        name: 'Good',
        description: 'good',
        startingRegion: 'village',
        regions: [makeRegion('village')],
        npcs: [],
      });
      writeRaw(path.join(tmpRoot, 'bad-world', 'world.json'), '{ not json');

      const svc = makeService();
      svc.loadFromDir(tmpRoot);

      expect(svc.getWorld('good-world')).toBeDefined();
      expect(svc.getWorld('bad-world')).toBeUndefined();
      expect(svc.listWorlds()).toHaveLength(1);
    });

    it('skips a world with dangling connectedRegions reference', () => {
      writeJson(path.join(tmpRoot, 'demo-world', 'world.json'), {
        id: 'demo-world',
        name: 'Demo',
        description: 'demo',
        startingRegion: 'village',
        regions: [makeRegion('village', ['atlantis'])],
        npcs: [],
      });

      const svc = makeService();
      svc.loadFromDir(tmpRoot);

      expect(svc.getWorld('demo-world')).toBeUndefined();
      expect(svc.listWorlds()).toHaveLength(0);
    });

    it('skips a world with duplicate region id across inline + dir sources', () => {
      const inline = inlineWorld();
      writeJson(path.join(tmpRoot, 'demo-world', 'world.json'), {
        id: inline.id,
        name: inline.name,
        description: inline.description,
        startingRegion: inline.startingRegion,
        regions: [inline.regions[0]], // village inline
        npcs: inline.npcs,
      });
      // Same village id also provided as a dir file → duplicate
      writeJson(
        path.join(tmpRoot, 'demo-world', 'regions', 'village.json'),
        inline.regions[0],
      );
      writeJson(
        path.join(tmpRoot, 'demo-world', 'regions', 'forest.json'),
        inline.regions[1],
      );

      const svc = makeService();
      svc.loadFromDir(tmpRoot);

      expect(svc.getWorld('demo-world')).toBeUndefined();
    });

    it('skips a world whose id does not match the directory name', () => {
      writeJson(path.join(tmpRoot, 'dir-name', 'world.json'), {
        id: 'different-id',
        name: 'Mismatch',
        description: 'id mismatch',
        startingRegion: 'village',
        regions: [makeRegion('village')],
        npcs: [],
      });

      const svc = makeService();
      svc.loadFromDir(tmpRoot);

      expect(svc.getWorld('different-id')).toBeUndefined();
      expect(svc.listWorlds()).toHaveLength(0);
    });
  });

  describe('missing/empty worldsDir', () => {
    it('does not throw when worldsDir does not exist', () => {
      const svc = new WorldConfigService(
        fakeConfig(path.join(tmpRoot, 'does-not-exist')),
      );
      expect(() => svc.onModuleInit()).not.toThrow();
      expect(svc.getDefaultWorld()).toBeUndefined();
      expect(svc.listWorlds()).toEqual([]);
    });

    it('does not throw when worldsDir contains zero valid worlds', () => {
      // tmpRoot is empty
      const svc = makeService();
      expect(() => svc.loadFromDir(tmpRoot)).not.toThrow();
      expect(svc.getDefaultWorld()).toBeUndefined();
      expect(svc.listWorlds()).toEqual([]);
    });
  });

  describe('getDefaultWorld', () => {
    it('returns the single world when exactly one is registered', () => {
      writeJson(path.join(tmpRoot, 'only-world', 'world.json'), {
        id: 'only-world',
        name: 'Only',
        description: 'only',
        startingRegion: 'village',
        regions: [makeRegion('village')],
        npcs: [],
      });

      const svc = makeService();
      svc.loadFromDir(tmpRoot);

      expect(svc.getDefaultWorld()!.id).toBe('only-world');
    });

    it('returns the lexicographically smallest id when multiple worlds exist', () => {
      writeJson(path.join(tmpRoot, 'zebra', 'world.json'), {
        id: 'zebra',
        name: 'Zebra',
        description: 'z',
        startingRegion: 'village',
        regions: [makeRegion('village')],
        npcs: [],
      });
      writeJson(path.join(tmpRoot, 'alpha', 'world.json'), {
        id: 'alpha',
        name: 'Alpha',
        description: 'a',
        startingRegion: 'village',
        regions: [makeRegion('village')],
        npcs: [],
      });
      writeJson(path.join(tmpRoot, 'beta', 'world.json'), {
        id: 'beta',
        name: 'Beta',
        description: 'b',
        startingRegion: 'village',
        regions: [makeRegion('village')],
        npcs: [],
      });

      const svc = makeService();
      svc.loadFromDir(tmpRoot);

      expect(svc.getDefaultWorld()!.id).toBe('alpha');
    });
  });

  describe('getWorld / listWorlds', () => {
    it('returns undefined for unknown id and lists all loaded worlds', () => {
      writeJson(path.join(tmpRoot, 'world-a', 'world.json'), {
        id: 'world-a',
        name: 'World A',
        description: 'a',
        startingRegion: 'village',
        regions: [makeRegion('village')],
        npcs: [],
      });
      writeJson(path.join(tmpRoot, 'world-b', 'world.json'), {
        id: 'world-b',
        name: 'World B',
        description: 'b',
        startingRegion: 'village',
        regions: [makeRegion('village')],
        npcs: [],
      });

      const svc = makeService();
      svc.loadFromDir(tmpRoot);

      expect(svc.getWorld('nope')).toBeUndefined();
      const list = svc.listWorlds();
      expect(list).toHaveLength(2);
      expect(list.map((w) => w.id).sort()).toEqual(['world-a', 'world-b']);
      expect(list.find((w) => w.id === 'world-a')!.name).toBe('World A');
    });
  });

  describe('loadFromDir re-entry', () => {
    it('clears the registry on each call', () => {
      writeJson(path.join(tmpRoot, 'world-a', 'world.json'), {
        id: 'world-a',
        name: 'World A',
        description: 'a',
        startingRegion: 'village',
        regions: [makeRegion('village')],
        npcs: [],
      });

      const svc = makeService();
      svc.loadFromDir(tmpRoot);
      expect(svc.listWorlds()).toHaveLength(1);

      // Remove the world and reload — registry should be empty.
      fs.rmSync(path.join(tmpRoot, 'world-a'), { recursive: true, force: true });
      svc.loadFromDir(tmpRoot);
      expect(svc.listWorlds()).toHaveLength(0);
    });
  });
});
