import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../config/config.service';
import {
  NpcConfigSchema,
  RegionConfigSchema,
  WorldConfigSchema,
  WorldMetaSchema,
  validateWorldConfig,
  type NpcConfig,
  type RegionConfig,
  type WorldConfig,
  type WorldMeta,
} from './world-config.schema';

@Injectable()
export class WorldConfigService implements OnModuleInit {
  private readonly logger = new Logger(WorldConfigService.name);
  private registry = new Map<string, WorldConfig>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.loadFromDir(this.config.worldsDir);
  }

  /**
   * Re-scan the given directory and atomically swap the registry. Public so
   * tests can point the loader at tmp fixtures without bootstrapping Nest.
   * Never throws — every failure mode is logged and skipped. Build-then-swap:
   * the existing registry is only replaced after the new scan completes, so
   * a mid-scan IO failure cannot leave the service in a half-cleared state.
   */
  loadFromDir(dir: string): void {
    const next = new Map<string, WorldConfig>();

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      this.logger.warn(
        `worldsDir "${dir}" does not exist or is unreadable — starting with empty registry`,
      );
      this.registry = next;
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const worldDir = path.join(dir, entry.name);
      const config = this.assembleWorld(worldDir, entry.name);
      if (config) {
        next.set(config.id, config);
        this.logger.log(
          `Loaded world "${config.id}" (${config.regions.length} regions, ${config.npcs.length} npcs)`,
        );
      }
    }

    if (next.size === 0) {
      this.logger.warn(
        `No valid world configs found in "${dir}" — running in skeleton mode`,
      );
    }

    this.registry = next;
  }

  getWorld(id: string): WorldConfig | undefined {
    return this.registry.get(id);
  }

  listWorlds(): Array<{ id: string; name: string }> {
    return Array.from(this.registry.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, w]) => ({ id, name: w.name }));
  }

  getDefaultWorld(): WorldConfig | undefined {
    if (this.registry.size === 0) return undefined;
    if (this.registry.size === 1) {
      return this.registry.values().next().value;
    }
    const ids = Array.from(this.registry.keys()).sort();
    return this.registry.get(ids[0]);
  }

  /**
   * Assemble one world from its directory. Returns undefined on any
   * world-fatal error (corrupt world.json, schema-invalid meta, or
   * cross-reference validation failure). Per-file errors inside
   * regions/npcs sources are logged and skipped without failing the world.
   */
  private assembleWorld(worldDir: string, dirName: string): WorldConfig | undefined {
    const meta = this.readWorldMeta(worldDir, dirName);
    if (!meta) return undefined;

    const regions = this.collectSection<RegionConfig>(
      worldDir,
      dirName,
      'regions',
      meta.regions,
      RegionConfigSchema,
    );
    const npcs = this.collectSection<NpcConfig>(
      worldDir,
      dirName,
      'npcs',
      meta.npcs,
      NpcConfigSchema,
    );

    const assembled = {
      id: meta.id,
      name: meta.name,
      description: meta.description,
      startingRegion: meta.startingRegion,
      regions,
      npcs,
    };

    const parsed = WorldConfigSchema.safeParse(assembled);
    if (!parsed.success) {
      this.logger.error(
        `World "${dirName}" failed WorldConfigSchema parse: ${parsed.error.message} — skipping world`,
      );
      return undefined;
    }

    const errors = validateWorldConfig(parsed.data, dirName);
    if (errors.length > 0) {
      for (const err of errors) {
        this.logger.error(`World "${dirName}" invalid: ${err}`);
      }
      return undefined;
    }

    return parsed.data;
  }

  private readWorldMeta(worldDir: string, dirName: string): WorldMeta | undefined {
    const metaPath = path.join(worldDir, 'world.json');
    let raw: string;
    try {
      raw = fs.readFileSync(metaPath, 'utf-8');
    } catch {
      this.logger.error(
        `World "${dirName}": missing or unreadable world.json — skipping world`,
      );
      return undefined;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      this.logger.error(
        `World "${dirName}": world.json is not valid JSON (${(err as Error).message}) — skipping world`,
      );
      return undefined;
    }

    const parsed = WorldMetaSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.error(
        `World "${dirName}": world.json failed WorldMetaSchema (${parsed.error.message}) — skipping world`,
      );
      return undefined;
    }
    return parsed.data;
  }

  /**
   * Merge the three sources for one section (regions|npcs), in order:
   *   a. inline array from world.json meta
   *   b. <section>.json single file containing an array
   *   c. <section>/ directory of *.json files, one object per file
   * Per-file errors are logged and skipped without failing the world.
   *
   * Error-tolerance policy differs by source, intentionally:
   *   - <section>.json is ALL-OR-NOTHING: one bad element skips the whole file.
   *     Rationale: the file is a single authorial unit; partial acceptance
   *     would silently drop content the author expected to be atomic.
   *   - <section>/ directory is PER-FILE tolerant: each file is an independent
   *     unit, so one corrupt file does not poison its siblings.
   */
  private collectSection<T>(
    worldDir: string,
    dirName: string,
    section: 'regions' | 'npcs',
    inline: T[] | undefined,
    itemSchema: typeof RegionConfigSchema | typeof NpcConfigSchema,
  ): T[] {
    const out: T[] = [];
    if (inline) out.push(...inline);

    // (b) <section>.json — single file containing an array (all-or-nothing)
    const arrayFile = path.join(worldDir, `${section}.json`);
    let arrayRaw: string | undefined;
    try {
      arrayRaw = fs.readFileSync(arrayFile, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.error(
          `World "${dirName}": cannot read ${section}.json (${(err as Error).message}) — skipping this file`,
        );
      }
      // ENOENT → file absent, silently skip (this source is optional)
    }
    if (arrayRaw !== undefined) {
      let json: unknown;
      try {
        json = JSON.parse(arrayRaw);
      } catch (err) {
        this.logger.error(
          `World "${dirName}": ${section}.json is not valid JSON (${(err as Error).message}) — skipping this file`,
        );
        json = undefined;
      }
      if (json !== undefined) {
        if (!Array.isArray(json)) {
          this.logger.error(
            `World "${dirName}": ${section}.json is not an array — skipping this file`,
          );
        } else {
          let fileFailed = false;
          const items: T[] = [];
          for (const item of json) {
            const parsed = itemSchema.safeParse(item);
            if (!parsed.success) {
              this.logger.error(
                `World "${dirName}": ${section}.json element failed schema (${parsed.error.message}) — skipping this file`,
              );
              fileFailed = true;
              break;
            }
            items.push(parsed.data as T);
          }
          if (!fileFailed) out.push(...items);
        }
      }
    }

    // (c) <section>/ directory of *.json files — one object per file (per-file tolerant)
    const sectionDir = path.join(worldDir, section);
    let files: string[] = [];
    try {
      files = fs
        .readdirSync(sectionDir)
        .filter((f) => f.endsWith('.json'))
        .sort();
    } catch {
      // Missing dir / not a dir / unreadable → silently skip (this source is optional)
      files = [];
    }
    for (const file of files) {
      const filePath = path.join(sectionDir, file);
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        this.logger.error(
          `World "${dirName}": cannot read ${section}/${file} (${(err as Error).message}) — skipping this file`,
        );
        continue;
      }
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch (err) {
        this.logger.error(
          `World "${dirName}": ${section}/${file} is not valid JSON (${(err as Error).message}) — skipping this file`,
        );
        continue;
      }
      const parsed = itemSchema.safeParse(json);
      if (!parsed.success) {
        this.logger.error(
          `World "${dirName}": ${section}/${file} failed schema (${parsed.error.message}) — skipping this file`,
        );
        continue;
      }
      out.push(parsed.data as T);
    }

    return out;
  }
}
