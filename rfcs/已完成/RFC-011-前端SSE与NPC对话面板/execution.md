# RFC-011 Execution: NPC 对话面板

> **开始**: 2026-07-31
> **完成**: 2026-07-31

## 任务清单

### 后端
- [x] v4 migration: npc_memories 扩展(importance, type) + game_events 表
- [x] NPC prompt 模板 `templates/npc/dialogue/system.md`
- [x] NpcEngine.generateWithTools() 框架（tool_use 循环 + 新 SSE 协议）
- [x] NpcService: Map→DB 记忆持久化
- [x] NPC summary 端点（haiku 异步摘要 → game_events + narrative_history）
- [x] NPC memories 端点 (GET :npcId/memories)
- [x] GameEventsRepository 新建
- [x] npc.repository.ts 扩展（importance/type 字段）

### 前端
- [x] `services/api.ts`: talkToNpcStream() + getNpcMemories() + submitNpcSummary()
- [x] `hooks/useNpcDialogue.ts`: SSE 流式 hook（dialogue_chunk/mood_change/done/error）
- [x] `components/game/NpcDialogueDrawer.tsx`: 抽屉+气泡+输入栏+记忆展开
- [x] `components/game/NearbyNpcs.tsx`: NPC 项加 onClick
- [x] `components/game/RegionSidebar.tsx`: onNpcClick prop 传递
- [x] `components/game/GameScreen.tsx`: 集成 NpcDialogueDrawer

### 验收
- [x] typecheck 零错误
- [x] build 成功
- [x] 247/247 测试通过
- [ ] Playwright 手动体验验证（待重拉测试）

## 实现总结

### 后端 (7 文件)
- `db/migrate.ts` v4: npc_memories + game_events
- `db/repositories/game-events.repository.ts`: CRUD
- `db/repositories/npc.repository.ts`: addMemory 扩展
- `db/rows.ts`: NpcMemoryRow + GameEventRow
- `llm/npc-engine.ts`: generateWithTools() + NpcDialogueChunkEvent + NpcMoodChangeEvent
- `prompts/templates/npc/dialogue/system.md`: 完整 NPC prompt 模板
- `npc/npc.service.ts`: Map→DB 记忆持久化 + getMemories() + generateSummary()
- `npc/npc.controller.ts`: GET memories + POST summary

### 前端 (6 文件)
- `services/api.ts`: talkToNpcStream + NpcMemory 类型 + getNpcMemories + submitNpcSummary
- `hooks/useNpcDialogue.ts`: SSE 流式解析（dialogue_chunk/mood_change/done/error）
- `NpcDialogueDrawer.tsx`: 右侧滑入 380px 抽屉，NPC 状态头 + 记忆折叠 + 聊天气泡 + TagRenderer + 输入栏
- `NearbyNpcs.tsx`: onClick + hover 提示
- `RegionSidebar.tsx`: onNpcClick prop
- `GameScreen.tsx`: selectedNpc state + NpcDialogueDrawer 集成
