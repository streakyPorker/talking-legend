/**
 * RFC-004: NPC 对话 — 模板参数 Schema。
 * 每个字段对应 templates/npc/dialogue/ 下 .md 文件中的 {{placeholder}}。
 *
 * 新版模板（RFC-011）使用 handlbars 语法 + 新增字段。
 */

export const NPC_DIALOGUE_SYSTEM_PARAMS = {
  npcName:           { type: 'string' as const, required: true,  source: 'npc_persona' },
  npcRole:           { type: 'string' as const, required: true,  source: 'npc_persona' },
  npcLocation:       { type: 'string' as const, required: true,  source: 'npc_persona' },
  npcPersonality:    { type: 'string' as const, required: true,  source: 'npc_persona' },
  npcMood:           { type: 'string' as const, required: true,  source: 'npc_persona' },
  npcHint:           { type: 'string' as const, required: false, source: 'npc_persona' },
  nearbyNpcs:        { type: 'string' as const, required: false, source: 'world_state' },
  timeOfDay:         { type: 'string' as const, required: true,  source: 'world_state' },
  weather:           { type: 'string' as const, required: true,  source: 'world_state' },
  regionDescription: { type: 'string' as const, required: false, source: 'world_state' },
  activeEvents:      { type: 'string' as const, required: false, source: 'active_events' },
  narrativeHistory:  { type: 'string' as const, required: false, source: 'narrative_history' },
  playerName:        { type: 'string' as const, required: true,  source: 'player_state' },
  inventory:         { type: 'string' as const, required: false, source: 'player_state' },
  npcMemories:       { type: 'string' as const, required: false, source: 'npc_memory' },
};

export const NPC_DIALOGUE_USER_PARAMS = {
  playerName:    { type: 'string' as const, required: true,  source: 'player_state' },
  playerMessage: { type: 'string' as const, required: true,  source: 'user_input' },
};
