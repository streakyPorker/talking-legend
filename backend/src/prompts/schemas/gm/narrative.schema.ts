/**
 * RFC-004: GM 叙事 — 模板参数 Schema。
 * 每个字段对应 templates/gm/narrative/ 下 .md 文件中的 {{placeholder}}。
 */

export const GM_NARRATIVE_USER_PARAMS = {
  playerAction: { type: 'string' as const, required: true,  source: 'user_input' },
  target:       { type: 'string' as const, required: false, source: 'user_input' },
};
