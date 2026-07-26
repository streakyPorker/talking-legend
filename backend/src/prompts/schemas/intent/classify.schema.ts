/**
 * RFC-004: 意图分类 — 模板参数 Schema。
 * 每个字段对应 templates/intent/classify/ 下 .md 文件中的 {{placeholder}}。
 */

export const INTENT_CLASSIFY_SYSTEM_PARAMS = {
  sceneName:    { type: 'string' as const, required: true,  source: 'world_state' },
  intentLabels: { type: 'string' as const, required: true,  source: 'intent_input' },
  npcNames:     { type: 'string' as const, required: false, source: 'world_state' },
};

export const INTENT_CLASSIFY_USER_PARAMS = {
  playerInput: { type: 'string' as const, required: true, source: 'intent_input' },
};
