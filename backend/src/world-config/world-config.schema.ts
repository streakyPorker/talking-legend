import { z } from 'zod';

export const RegionConfigSchema = z.object({
  id: z.string().min(1, 'region id is required'),
  name: z.string().min(1, 'region name is required'),
  description: z.string().min(1, 'region description is required'),
  connectedRegions: z.array(z.string().min(1, 'connected region id is required')),
});

export const NpcConfigSchema = z.object({
  key: z.string().min(1, 'npc key is required'),
  name: z.string().min(1, 'npc name is required'),
  role: z.string().min(1, 'npc role is required'),
  personality: z.string().min(1, 'npc personality is required'),
  initialMood: z.string().min(1, 'npc initialMood is required'),
  location: z.string().min(1, 'npc location is required'),
});

export const WorldMetaSchema = z.object({
  id: z.string().min(1, 'world id is required'),
  name: z.string().min(1, 'world name is required'),
  description: z.string().min(1, 'world description is required'),
  startingRegion: z.string().min(1, 'startingRegion is required'),
  regions: z.array(RegionConfigSchema).optional(),
  npcs: z.array(NpcConfigSchema).optional(),
});

export const WorldConfigSchema = z.object({
  id: z.string().min(1, 'world id is required'),
  name: z.string().min(1, 'world name is required'),
  description: z.string().min(1, 'world description is required'),
  startingRegion: z.string().min(1, 'startingRegion is required'),
  regions: z.array(RegionConfigSchema),
  npcs: z.array(NpcConfigSchema),
});

export type RegionConfig = z.infer<typeof RegionConfigSchema>;
export type NpcConfig = z.infer<typeof NpcConfigSchema>;
export type WorldMeta = z.infer<typeof WorldMetaSchema>;
export type WorldConfig = z.infer<typeof WorldConfigSchema>;

/**
 * Validate cross-reference rules on an ASSEMBLED world config.
 * Returns an array of human-readable error strings (empty array = valid).
 * Collects ALL errors rather than stopping at the first.
 */
export function validateWorldConfig(config: WorldConfig, dirName: string): string[] {
  const errors: string[] = [];

  if (config.id !== dirName) {
    errors.push(
      `world id "${config.id}" does not match directory name "${dirName}" (anti-misplacement)`,
    );
  }

  const regionIds = config.regions.map((r) => r.id);
  const regionIdSet = new Set(regionIds);

  const seenRegionIds = new Set<string>();
  const dupRegionIds = new Set<string>();
  for (const id of regionIds) {
    if (seenRegionIds.has(id)) {
      dupRegionIds.add(id);
    }
    seenRegionIds.add(id);
  }
  for (const id of dupRegionIds) {
    errors.push(`duplicate region id "${id}"`);
  }

  if (!regionIdSet.has(config.startingRegion)) {
    errors.push(
      `startingRegion "${config.startingRegion}" does not exist in regions`,
    );
  }

  for (const region of config.regions) {
    for (const target of region.connectedRegions) {
      if (!regionIdSet.has(target)) {
        errors.push(
          `region "${region.id}" has connectedRegion "${target}" that does not exist in regions`,
        );
      }
    }
  }

  const npcKeys = config.npcs.map((n) => n.key);
  const seenNpcKeys = new Set<string>();
  const dupNpcKeys = new Set<string>();
  for (const key of npcKeys) {
    if (seenNpcKeys.has(key)) {
      dupNpcKeys.add(key);
    }
    seenNpcKeys.add(key);
  }
  for (const key of dupNpcKeys) {
    errors.push(`duplicate npc key "${key}"`);
  }

  for (const npc of config.npcs) {
    if (!regionIdSet.has(npc.location)) {
      errors.push(
        `npc "${npc.key}" has location "${npc.location}" that does not exist in regions`,
      );
    }
  }

  return errors;
}
