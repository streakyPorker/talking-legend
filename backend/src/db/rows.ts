/**
 * Row types for SQLite tables.
 *
 * Each interface maps directly to a SQLite table's column types (string | number | null).
 * JSON columns are stored as `string` (raw TEXT) — parsing/serialization happens in Repository
 * methods, not in the public API.
 *
 * @see RFC-002 "Row 类型定义" section for design rationale.
 */

// ── games ────────────────────────────────────────────────

export interface GameRow {
  id: string;
  player_name: string;
  turn: number;
  phase: string;
  created_at: string;
  updated_at: string;
}

// ── worlds ───────────────────────────────────────────────

export interface WorldRow {
  game_id: string;
  name: string;
  description: string;
  current_region: string;
  time_of_day: string;
  weather: string;
  regions: string;          // JSON: Region[]
  global_events: string;    // JSON: string[]
  created_at: string;
  updated_at: string;
}

// ── npcs ─────────────────────────────────────────────────

export interface NpcRow {
  id: string;
  game_id: string;
  name: string;
  role: string;
  personality: string;
  current_mood: string;
  location: string;
  is_alive: number;         // SQLite boolean → 0|1
  created_at: string;
  updated_at: string;
}

// ── npc_memories ─────────────────────────────────────────

export interface NpcMemoryRow {
  id: number;               // AUTOINCREMENT
  npc_id: string;
  content: string;
  turn: number;
  importance: number;       // 1-5, RFC-011
  type: string;             // RFC-011: 'dialogue' | 'summary' | 'event'
  created_at: string;
}

// ── players ──────────────────────────────────────────────

export interface PlayerRow {
  game_id: string;
  name: string;
  location: string;
  inventory: string;        // JSON: string[]
  reputation: string;       // JSON: Record<string, number>
  created_at: string;
  updated_at: string;
}

// ── player_quests ────────────────────────────────────────

export interface PlayerQuestRow {
  id: string;
  game_id: string;
  title: string;
  description: string;
  status: string;           // 'active' | 'completed' | 'failed'
  progress: number;
  created_at: string;
  updated_at: string;
}

// ── storylines ───────────────────────────────────────────

export interface StorylineRow {
  game_id: string;
  current_stage: string;
  stage_data: string;       // JSON: Record<string, unknown>
  completed_stages: string; // JSON: string[]
  active_events: string;    // JSON: string[]
  created_at: string;
  updated_at: string;
}

// ── llm_logs ─────────────────────────────────────────────

export interface LlmLogRow {
  id: number;               // AUTOINCREMENT
  game_id: string;
  call_type: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  cost_usd: number;
  created_at: string;
}

// ── game_events (RFC-011) ─────────────────────────────────

export interface GameEventRow {
  id: number;
  game_id: string;
  type: string;
  location: string;
  actors: string;           // JSON: string[]
  summary: string;
  importance: number;
  turn: number;
  created_at: string;
}
