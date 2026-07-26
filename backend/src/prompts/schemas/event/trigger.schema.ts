/**
 * RFC-004: 事件触发 — 模板参数 Schema。
 * 每个字段对应 templates/event/trigger/ 下 .md 文件中的 {{placeholder}}。
 */

export const EVENT_TRIGGER_SYSTEM_PARAMS = {
  timeOfDay:       { type: 'string' as const, required: true,  source: 'world_state' },
  weather:         { type: 'string' as const, required: true,  source: 'world_state' },
  currentRegion:   { type: 'string' as const, required: true,  source: 'world_state' },
  activeEvents:    { type: 'string' as const, required: true,  source: 'active_events' },
  recentNarrative: { type: 'string' as const, required: true,  source: 'narrative_history' },
};

export const EVENT_TRIGGER_USER_PARAMS = {
  turnNumber:       { type: 'string' as const, required: true,  source: 'caller' },
  narrativeContent: { type: 'string' as const, required: true,  source: 'caller' },
};
