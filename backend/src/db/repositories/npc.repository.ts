import { Injectable, Inject } from '@nestjs/common';
import type Database from 'better-sqlite3';
import type { NPCState } from '@talking-legend/shared';
import { DB_INSTANCE } from '../tokens';
import type { NpcRow, NpcMemoryRow } from '../rows';

/**
 * Repository for the `npcs` table + associated `npc_memories` table.
 *
 * NPCState.memoryOfPlayer is stored in the normalized npc_memories table
 * and loaded eagerly when querying NPCs.
 *
 * Statements are prepared lazily at call time so they survive a
 * DbConnectionManager.reset() connection swap.
 */
@Injectable()
export class NpcRepository {
  constructor(@Inject(DB_INSTANCE) private readonly db: Database.Database) {}

  findByGameId(gameId: string): NPCState[] {
    const rows = this.db
      .prepare('SELECT * FROM npcs WHERE game_id = ? ORDER BY created_at ASC')
      .all(gameId) as NpcRow[];
    return rows.map((r) => this.rowToDomain(r));
  }

  findById(id: string): NPCState | undefined {
    const row = this.db
      .prepare('SELECT * FROM npcs WHERE id = ?')
      .get(id) as NpcRow | undefined;
    return row ? this.rowToDomain(row) : undefined;
  }

  create(gameId: string, npc: NPCState): void {
    this.db
      .prepare(`
        INSERT INTO npcs (id, game_id, name, role, personality, current_mood, location, is_alive)
        VALUES (@id, @game_id, @name, @role, @personality, @current_mood, @location, @is_alive)
      `)
      .run({
        id: npc.id,
        game_id: gameId,
        name: npc.name,
        role: npc.role,
        personality: npc.personality,
        current_mood: npc.currentMood,
        location: npc.location,
        is_alive: npc.isAlive ? 1 : 0,
      });
    // Insert initial memories if any
    for (const memory of npc.memoryOfPlayer) {
      this.db
        .prepare(
          'INSERT INTO npc_memories (npc_id, content, turn, importance, type) VALUES (@npc_id, @content, @turn, @importance, @type)',
        )
        .run({ npc_id: npc.id, content: memory, turn: 0, importance: 1, type: 'dialogue' });
    }
  }

  update(id: string, patch: Partial<NPCState>): void {
    this.db
      .prepare(`
        UPDATE npcs SET
          current_mood = COALESCE(@current_mood, current_mood),
          location     = COALESCE(@location, location),
          is_alive     = COALESCE(@is_alive, is_alive),
          updated_at   = datetime('now')
        WHERE id = @id
      `)
      .run({
        id,
        current_mood: patch.currentMood ?? null,
        location: patch.location ?? null,
        is_alive: patch.isAlive !== undefined ? (patch.isAlive ? 1 : 0) : null,
      });
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM npc_memories WHERE npc_id = ?').run(id);
    this.db.prepare('DELETE FROM npcs WHERE id = ?').run(id);
  }

  deleteByGameId(gameId: string): void {
    // CASCADE handles npc_memories
    this.db.prepare('DELETE FROM npcs WHERE game_id = ?').run(gameId);
  }

  // ── Memory management ──────────────────────────────────

  getMemories(npcId: string): string[] {
    const rows = this.db
      .prepare('SELECT content FROM npc_memories WHERE npc_id = ? ORDER BY turn ASC')
      .all(npcId) as Pick<NpcMemoryRow, 'content'>[];
    return rows.map((r) => r.content);
  }

  addMemory(npcId: string, content: string, turn: number, importance = 1, type = 'dialogue'): void {
    this.db
      .prepare(
        'INSERT INTO npc_memories (npc_id, content, turn, importance, type) VALUES (@npc_id, @content, @turn, @importance, @type)',
      )
      .run({ npc_id: npcId, content, turn, importance, type });
  }

  // ── Private mapping ────────────────────────────────────

  private rowToDomain(row: NpcRow): NPCState {
    const memories = this.getMemories(row.id);
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      personality: row.personality,
      currentMood: row.current_mood,
      location: row.location,
      memoryOfPlayer: memories,
      isAlive: row.is_alive === 1,
    };
  }
}
