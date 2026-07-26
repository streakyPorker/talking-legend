/**
 * RFC-004: GM 叙事 — 模板参数 Schema。
 * 每个字段对应 templates/gm/narrative/ 下 .md 文件中的 {{placeholder}}。
 */

export const GM_NARRATIVE_SYSTEM_PARAMS = {
  worldDescription: { type: 'string' as const, required: true,  source: 'world_state' },
  timeOfDay:        { type: 'string' as const, required: true,  source: 'world_state' },
  weather:          { type: 'string' as const, required: true,  source: 'world_state' },
  currentRegion:    { type: 'string' as const, required: true,  source: 'world_state' },
  regionsSummary:   { type: 'string' as const, required: false, source: 'world_state' },
  activeEvents:     { type: 'string' as const, required: false, source: 'active_events' },
  narrativeHistory: { type: 'string' as const, required: false, source: 'narrative_history' },
  playerName:       { type: 'string' as const, required: true,  source: 'player_state' },
  playerLocation:   { type: 'string' as const, required: true,  source: 'player_state' },
  inventory:        { type: 'string' as const, required: false, source: 'player_state' },
  scenarioHint:     { type: 'string' as const, required: false, source: 'scenario_hint' },
};

export const GM_NARRATIVE_USER_PARAMS = {
  playerAction: { type: 'string' as const, required: true,  source: 'user_input' },
  target:       { type: 'string' as const, required: false, source: 'user_input' },
};
