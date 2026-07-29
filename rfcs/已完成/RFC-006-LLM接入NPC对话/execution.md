# RFC-006: LLM 接入 — NPC 对话 — 执行记录

> **状态**: 已完成
> **开始**: 2026-07-29
> **结束**: 2026-07-29
> **设计**: design.md v2（两轮 Sonnet 审查）

## 交付

| 文件 | 操作 | 说明 |
|------|------|------|
| `llm/npc-engine.ts` | 新增 | NpcEngine — Sonnet流式对话,降级,情绪[mood:xxx],记忆同步兜底 |
| `llm/npc-engine.spec.ts` | 新增 | 12 测试 |
| `game/context-provider.ts` | 修改 | +buildNpcContext() (5模块+NpcContextBuilder) |
| `npc/npc.service.ts` | 重构 | talkStream(): db.transaction快照+同区域校验+并发锁+历史Map(20轮) |
| `npc/npc.controller.ts` | 修改 | +POST :npcId/talk/stream SSE端点 |
| `npc/npc.module.ts` | 修改 | imports [LlmModule(forwardRef)] |
| `llm/llm.module.ts` | 修改 | providers/exports +NpcEngine |
| `db/repositories/npc.repository.ts` | 修改 | addMemory() 方法 (已存在,复用) |

## 实测验证

| 测试 | 结果 |
|------|------|
| NPC 3轮对话流式 | 21/22 通过 |
| 对话历史累积 (inputTokens 391→579) | ✅ |
| 同区域校验 | ✅ |
| 并发锁 409 | ✅ |
| 降级 fallback | ✅ |
| 情绪更新 [mood:] | ✅ |
| 全量单元测试 | 187/187 |

## 已知问题

- Sonnet 模型名需去掉 `[1M]` 后缀 (ConfigService.cleanModel 已处理)
- 告别轮次 NLP 风格差异 (非 bug)
