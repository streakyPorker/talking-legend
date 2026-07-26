import { describe, it, expect } from 'vitest';
import {
  RegionConfigSchema,
  NpcConfigSchema,
  WorldMetaSchema,
  WorldConfigSchema,
  validateWorldConfig,
  type WorldConfig,
} from './world-config.schema';

function makeValidConfig(): WorldConfig {
  return {
    id: 'demo-world',
    name: 'Demo World',
    description: 'A demo world',
    startingRegion: 'village',
    regions: [
      {
        id: 'village',
        name: 'Village',
        description: 'A quiet village',
        connectedRegions: ['forest'],
      },
      {
        id: 'forest',
        name: 'Forest',
        description: 'A dense forest',
        connectedRegions: ['village'],
      },
    ],
    npcs: [
      {
        key: 'elder',
        name: 'Village Elder',
        role: 'leader',
        personality: 'wise',
        initialMood: 'calm',
        location: 'village',
      },
    ],
  };
}

describe('WorldConfigSchema + validateWorldConfig — valid config', () => {
  it('parses a complete valid config and yields no validation errors', () => {
    const config = makeValidConfig();
    const parsed = WorldConfigSchema.parse(config);
    expect(parsed).toEqual(config);
    expect(validateWorldConfig(parsed, 'demo-world')).toEqual([]);
  });
});

describe('validateWorldConfig — dirName mismatch', () => {
  it('reports an error when config.id does not equal dirName', () => {
    const config = makeValidConfig();
    const errors = validateWorldConfig(config, 'other-dir');
    expect(errors.some((e) => e.includes('does not match directory name'))).toBe(true);
  });
});

describe('validateWorldConfig — startingRegion dangling', () => {
  it('reports an error when startingRegion is not a known region id', () => {
    const config = makeValidConfig();
    config.startingRegion = 'nowhere';
    const errors = validateWorldConfig(config, 'demo-world');
    expect(errors.some((e) => e.includes('startingRegion') && e.includes('nowhere'))).toBe(true);
  });
});

describe('validateWorldConfig — connectedRegions dangling', () => {
  it('reports an error when a connectedRegion target does not exist', () => {
    const config = makeValidConfig();
    config.regions[0].connectedRegions = ['atlantis'];
    const errors = validateWorldConfig(config, 'demo-world');
    expect(
      errors.some((e) => e.includes('connectedRegion') && e.includes('atlantis')),
    ).toBe(true);
  });
});

describe('validateWorldConfig — npc.location dangling', () => {
  it('reports an error when an npc location does not exist', () => {
    const config = makeValidConfig();
    config.npcs[0].location = 'moon';
    const errors = validateWorldConfig(config, 'demo-world');
    expect(errors.some((e) => e.includes('npc') && e.includes('moon'))).toBe(true);
  });
});

describe('validateWorldConfig — connectedRegions self-reference', () => {
  it('reports an error when a region lists itself in connectedRegions', () => {
    const config = makeValidConfig();
    config.regions[0].connectedRegions = ['village', 'forest'];
    const errors = validateWorldConfig(config, 'demo-world');
    expect(
      errors.some(
        (e) => e.includes('lists itself in connectedRegions') && e.includes('village'),
      ),
    ).toBe(true);
  });
});

describe('validateWorldConfig — empty npcs is valid', () => {
  it('returns no errors when regions are valid and npcs is empty', () => {
    const config = makeValidConfig();
    config.npcs = [];
    expect(validateWorldConfig(config, 'demo-world')).toEqual([]);
  });
});

describe('validateWorldConfig — empty regions with non-empty npcs', () => {
  it('reports both startingRegion dangling and every npc.location dangling', () => {
    const config = makeValidConfig();
    config.regions = [];
    const errors = validateWorldConfig(config, 'demo-world');
    expect(errors.some((e) => e.includes('startingRegion'))).toBe(true);
    expect(errors.some((e) => e.includes('npc') && e.includes('village'))).toBe(true);
  });
});

describe('validateWorldConfig — empty connectedRegions is valid', () => {
  it('returns no errors for a dead-end region with connectedRegions: []', () => {
    const config = makeValidConfig();
    config.regions[1].connectedRegions = [];
    expect(validateWorldConfig(config, 'demo-world')).toEqual([]);
  });
});

describe('validateWorldConfig — duplicate region id', () => {
  it('reports an error when two regions share the same id', () => {
    const config = makeValidConfig();
    config.regions.push({
      id: 'village',
      name: 'Another Village',
      description: 'duplicate id',
      connectedRegions: [],
    });
    const errors = validateWorldConfig(config, 'demo-world');
    expect(errors.some((e) => e.includes('duplicate region id') && e.includes('village'))).toBe(
      true,
    );
  });
});

describe('validateWorldConfig — duplicate npc key', () => {
  it('reports an error when two npcs share the same key', () => {
    const config = makeValidConfig();
    config.npcs.push({
      key: 'elder',
      name: 'Another Elder',
      role: 'leader',
      personality: 'stern',
      initialMood: 'calm',
      location: 'village',
    });
    const errors = validateWorldConfig(config, 'demo-world');
    expect(errors.some((e) => e.includes('duplicate npc key') && e.includes('elder'))).toBe(true);
  });
});

describe('validateWorldConfig — collects all errors', () => {
  it('returns multiple errors when multiple rules are violated', () => {
    const config = makeValidConfig();
    config.startingRegion = 'nowhere';
    config.npcs[0].location = 'moon';
    const errors = validateWorldConfig(config, 'wrong-dir');
    // dirName mismatch + startingRegion + npc.location = at least 3
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('WorldMetaSchema', () => {
  it('accepts meta without regions/npcs', () => {
    const meta = {
      id: 'demo-world',
      name: 'Demo World',
      description: 'A demo world',
      startingRegion: 'village',
    };
    const parsed = WorldMetaSchema.parse(meta);
    expect(parsed.regions).toBeUndefined();
    expect(parsed.npcs).toBeUndefined();
  });

  it('accepts meta with inline regions/npcs', () => {
    const meta = {
      id: 'demo-world',
      name: 'Demo World',
      description: 'A demo world',
      startingRegion: 'village',
      regions: [
        {
          id: 'village',
          name: 'Village',
          description: 'A quiet village',
          connectedRegions: [],
        },
      ],
      npcs: [
        {
          key: 'elder',
          name: 'Village Elder',
          role: 'leader',
          personality: 'wise',
          initialMood: 'calm',
          location: 'village',
        },
      ],
    };
    const parsed = WorldMetaSchema.parse(meta);
    expect(parsed.regions).toHaveLength(1);
    expect(parsed.npcs).toHaveLength(1);
  });
});

describe('schema-level string constraints', () => {
  it('rejects empty-string name on RegionConfigSchema', () => {
    expect(() =>
      RegionConfigSchema.parse({
        id: 'village',
        name: '',
        description: 'desc',
        connectedRegions: [],
      }),
    ).toThrow();
  });

  it('rejects empty-string name on NpcConfigSchema', () => {
    expect(() =>
      NpcConfigSchema.parse({
        key: 'elder',
        name: '',
        role: 'leader',
        personality: 'wise',
        initialMood: 'calm',
        location: 'village',
      }),
    ).toThrow();
  });

  it('rejects empty-string name on WorldMetaSchema', () => {
    expect(() =>
      WorldMetaSchema.parse({
        id: 'demo-world',
        name: '',
        description: 'desc',
        startingRegion: 'village',
      }),
    ).toThrow();
  });

  it('rejects empty-string name on WorldConfigSchema', () => {
    expect(() =>
      WorldConfigSchema.parse({
        id: 'demo-world',
        name: '',
        description: 'desc',
        startingRegion: 'village',
        regions: [],
        npcs: [],
      }),
    ).toThrow();
  });
});
