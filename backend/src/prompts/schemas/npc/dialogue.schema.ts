/**
 * RFC-004: NPC 对话 — 模板参数 Schema。
 * 每个字段对应 templates/npc/dialogue/ 下 .md 文件中的 {{placeholder}}。
 */

export const NPC_DIALOGUE_SYSTEM_PARAMS = {
  npcName:           { type: 'string' as const, required: true,  source: 'npc_persona' },
  npcRole:           { type: 'string' as const, required: true,  source: 'npc_persona' },
  npcLocation:       { type: 'string' as const, required: true,  source: 'npc_persona' },
  npcPersonality:    { type: 'string' as const, required: true,  source: 'npc_persona' },
  npcMood:           { type: 'string' as const, required: true,  source: 'npc_persona' },
  npcMemories:       { type: 'string' as const, required: false, source: 'npc_memory' },
  currentRegion:     { type: 'string' as const, required: true,  source: 'world_state' },
  regionDescription: { type: 'string' as const, required: false, source: 'world_state' },
  timeOfDay:         { type: 'string' as const, required: true,  source: 'world_state' },
  weather:           { type: 'string' as const, required: true,  source: 'world_state' },
  recentEvents:      { type: 'string' as const, required: false, source: 'narrative_history' },
};

export const NPC_DIALOGUE_USER_PARAMS = {
  playerName:    { type: 'string' as const, required: true,  source: 'player_state' },
  playerMessage: { type: 'string' as const, required: true,  source: 'user_input' },
};
