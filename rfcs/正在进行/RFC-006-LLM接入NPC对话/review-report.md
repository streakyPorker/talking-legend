# RFC-006 设计审查报告

审查日期：2026-07-29 | 审查人：后端架构审查员（Sonnet 模型级）

---

## 🔴 严重问题

### R1. buildNpcContext() 不存在 — 设计依赖的函数未实现

**文件**: `design.md` L41 / `backend/src/game/context-provider.ts`
**描述**: design.md 的 NpcEngine 伪码在第 41 行调用了 `this.contextProvider.buildNpcContext(gameId, npc.id, 50_000)`，但我 `grep` 了整个 `backend/src/` 目录，`buildNpcContext` 方法并不存在。`context-provider.ts` 只实现了 `buildGMContext()`。这是**缺失的核心依赖**——没有这个方法，NpcEngine 无法获取上下文。

**建议**: 在 `context-provider.ts` 中新增 `buildNpcContext(gameId, npcId, budget)` 方法。需要：
- 读取 DB 获取该 NPC 的完整信息（已通过 NpcRepository 有 `findById`、`getMemories`）
- 实例化 `NpcPersonaModule` + `NpcMemoryModule` + `WorldStateModule` + `PlayerStateModule` + `NarrativeHistoryModule` + `ActiveEventsModule`
- 将 NPC 专属数据注入 NpcPersonaModule（如 `npcName`/`npcRole`/`npcLocation`/`npcPersonality`/`npcMood`）和 NpcMemoryModule（memories）
- 使用 `NpcContextBuilder` 组装

---

### R2. NpcContextBuilder 的 module-config 配置有误 — 缺少 npc_persona 数据注入管线

**文件**: `backend/src/context/module-config.ts` L20-L28
**描述**: `npc_dialogue` 的 module-config 包含了 `world_state`（强制）和 `npc_persona`（强制）等模块。但 `world_state` 模块的 `renderFull()`（`world-state.module.ts` L20-L50）不知道当前正在与哪个 NPC 对话——**它会把所有 NPC 都写进 context**，而不是仅聚焦于当前对话的 NPC。这意味着 `currentRegion` 和 `regionDescription` 可以拿到，但 `timeOfDay`/`weather`/`recentEvents` 等字段需要通过 `buildNpcContext` 中的 setData 正确注入。

**更关键的是**: `NpcMemoryModule` 使用 `BaseContextModule` 的默认 `gather()` 实现（`base.module.ts` L21-L28），它只是将 `this.data` 直接返回。NPC 记忆数据**不会自动从 DB 加载**——必须在 `buildNpcContext` 中手动调用 `this.npcRepo.getMemories(npcId)` 并将结果 `setData` 注入到 `NpcMemoryModule` 实例。设计文档和伪码都没提这件事。

**建议**:
- `buildNpcContext` 必须显式注入 `NpcMemoryModule` 的 `memories` 数据（调用 `npcRepo.getMemories(npcId)`）
- `WorldStateModule` 目前会把所有 NPC 倒进 context——对于 NPC 对话，可以不加 NPC 列表（或者仅列出当前区域的 NPC），但现有 `buildGMContext` 是注入全部 NPC 的，`buildNpcContext` 复用同一 module 实例时需要裁剪
- 考虑是否要为 npc_dialogue 独立裁剪 `WorldStateModule` 的 NPC 输出量

---

### R3. NPCDialogueResponse / shared 层设计冲突 — 设计文档使用流式 SSE，但 shared/types 定义的是同步接口

**文件**: `shared/src/index.ts` L53-L58
**描述**: `NPCDialogueResponse` 目前定义为同步 RPC 风格接口：`{ npcId, message, moodChange, memoryUpdate }`。但 RFC-006 设计决定走 SSE 流式响应。这两个契约不一致。前端要消费 `{ type: 'chunk', content: string } | { type: 'done', ... }` 事件流，而非一次性的 JSON 对象。

**建议**:
- 废弃或重命名 `shared` 中的 `NPCDialogueResponse`（或标记它为历史遗留）
- 在 `backend/src/llm/npc-engine.ts` 中定义 NPC 的流事件类型（类似 GMEngine 的 `GMStreamEvent`）：
  ```typescript
  export interface NPCChunkEvent { type: 'chunk'; content: string }
  export interface NPCDoneEvent { type: 'done'; tokenEstimate: number; inputTokens?: number; outputTokens?: number }
  export type NPCStreamEvent = NPCChunkEvent | NPCDoneEvent;
  ```
- 如果前端 `NPCDialogueRequest` 仍被使用(`shared L47-L51`)，需确认是否与新路由 `POST /api/game/:gameId/npc/:npcId/talk/stream` 兼容。当前 `NPCDialogueRequest` 包含 `gameState`（全量），但新路由只需要 `playerMessage`。

---

### R4. 模版参数校验断言 — render() 要求的 11 个字段在 buildNpcContext 中能否全部提供存疑

**文件**: `design.md` L69-L75 / `backend/src/prompts/schemas/npc/dialogue.schema.ts`
**描述**: `NPC_DIALOGUE_SYSTEM_PARAMS` 定义了 11 个模板参数，其中 7 个 required：
  - `npcName`, `npcRole`, `npcLocation`, `npcPersonality`, `npcMood` → 来自 npc_persona，可提供
  - `currentRegion`, `timeOfDay`, `weather` → 来自 world_state，可提供
  - `regionDescription` (required: false)、`npcMemories` (required: false)、`recentEvents` (required: false) → 可选

  但 design.md 中的伪码（L69）直接使用了 `npc.memoryOfPlayer.join('；')`，这假定 NpcEngine 接收的 `npc: NPCState` 参数包含了 `memoryOfPlayer: string[]`。这是对的——`NpcRepository.rowToDomain()` 会加载。但设计文档把 memory 放到了 render 层，而 `ContextProvider.buildNpcContext` 如果走 `NpcMemoryModule` 管线，数据和 render 是分离的。**这里存在两层渲染的浪费：** ContextBuilder 的 `NpcMemoryModule.renderFull()` 已经渲染了一段记忆文本，但 design.md 的 NpcEngine 又从 `npc.memoryOfPlayer` 手动拼接了一遍传给 TemplateEngine。

**建议**: 在 `buildNpcContext` 中确定渲染策略，避免**冗余渲染**：
  - 方案 A：全部走 ContextBuilder 管线，TemplateEngine 只渲染 user prompt。ContextBuilder 的 systemPrompt 已包含记忆信息。
  - 方案 B：跳过 ContextBuilder，手动用 setData 注入后只拿 raw data 然后用 TemplateEngine 渲染。
  当前 design.md **混用了 A 和 B**——需要统一。

---

### R5. 同步日志中的 turn 参数 — 设计说「不 bump turn」但 LLM 日志没有 turn

**文件**: `design.md` L90-L92

**描述**: design.md 的伪码中包含：
```
this.llmLogRepo.insert({ gameId, callType: 'npc_dialogue', model: this.llmClient.sonnetModel, ... });
```
但 `llm_logs` 表结构（`rows.ts` LlmLogRow）没有 `turn` 字段。这**不是问题本身**。问题是：NPC 对话是唯一标记为"不 bump turn"的操作。如果 `npc_memories` 插入时也用 `turn: 0` 或 `turn: currentTurn`，当 GM 驱动游戏推进到下一轮后，这些记忆没有正确的 turn 标记，`MemoryFilter.filterForContext` 按 turn 排序的逻辑会**混杂 NPC 对话记忆与 GM 叙事记忆**。而 NPC 对话记忆到底应该标记为哪一轮？这是设计未澄清的。

**建议**:
- 在 NpcEngine 开始生成时获取当前游戏的 turn（不 bump），以当前 turn 为记忆打标
- 或者在 `npc_memories` 中引入 `source` 字段（`gm_narrative` / `npc_dialogue`），让 MemoryFilter 可以区分来源

---

## 🟡 中等问题

### Y1. NpcEngine 的构造依赖链不完整

**文件**: `design.md` L59-L63
**描述**: NpcEngine 的 TypeScript 类型和构造签名未在 design.md 中明确列出，但从伪码可以推导出它需要注入：`ContextProvider`, `TemplateEngine`, `LLMClient`, `LlmLogRepository`。对比 GMEngine 的构造（`gm-engine.ts` L27-L33），GMEngine 还有 `NarrativeService`。NpcEngine 不需要 `NarrativeService`（已明确不 bump turn），但设计文档未列出完整注入列表。

**建议**: 在设计文档中显式列出 NpcEngine 的所有依赖注入，并与 GMEngine 做代码复用分析。至少可以提取一个 `BaseLLMEngine` 抽象类（共享 LLMClient、TemplateEngine、LlmLogRepository）。

---

### Y2. 记忆判定的异步写入 — fire-and-forget 的异常处理缺失

**文件**: `design.md` L91-L92 / L102-L113
**描述**: design.md 说「记忆判定异步（fire-and-forget）」和「失败不影响对话」。但如果 memory 写入抛异常，NpcEngine 的回调链会崩溃吗？在 TypeScript 中，unhandled promise rejection 会丢失异常。这里需要：`void doAsync().catch(err => console.error(...))`。

**建议**: 在 design.md 中明确异步写入的异常处理模式，例如：
```typescript
this.maybeStoreMemory(npcResponse, gameId, npc, playerMessage, turn)
  .catch(err => this.logger.warn(`Memory persistence failed: ${err.message}`));
```
并考虑使用 NestJS `@Logger` 注入而非 console.error。

---

### Y3. talkStream 的路由设计与现有 @Post(':npcId/talk') 冲突

**文件**: `backend/src/npc/npc.controller.ts` L10-L12
**描述**: 现有 controller 定义了 `POST :npcId/talk`，返回同步 JSON。RFC-006 计划新增 `POST :npcId/talk/stream`。这两个路由不会冲突（路径不同），但：
  1. 旧路由需要保留还是替换？如果保留，需要标记为 deprecated
  2. `talk/stream` 返回 `text/event-stream`，现有 controller 基类（`@Controller('game/:gameId/npc')`）未设置 SSE 响应类型的逻辑

**建议**:
- 旧路由 `talk` 可暂时保留作为占位符，但添加 `@deprecated` JSDoc 注释
- 新路由 `talkStream` 需要手动设置 SSE headers（`res.setHeader('Content-Type', 'text/event-stream')`），参考 `game.controller.ts` 中 `performActionStream` 的实现模式

---

### Y4. 未处理 SSE 连接断开场景

**文件**: `design.md`（全文）
**描述**: 设计文档描述了 SSE 流，但未提及客户端断连的处理。如果用户关闭浏览器窗口、刷新页面、或网络中断：
  1. NpcEngine 的 AsyncGenerator 会继续运行到完成（浪费 LLM tokens）
  2. 记忆判定仍然会触发并写入 DB
  3. 没有 abort 信号传递给 LLMClient

GMEngine（`gm-engine.ts`）也没有处理这个问题，但作为 RFC-006 的设计审查，应该指出这个可改进点。

**建议**: 
- NestJS 可以通过 `@Res() res: Response` 注入并监听 `req.on('close', ...)` 来触发 abort
- 传递 AbortSignal 给 LLMClient.stream()
- 在 design.md 中记录为一个后续优化点（或标明 MVP 阶段不做）

---

### Y5. NpcModule 的模块注册缺失

**文件**: `backend/src/npc/npc.module.ts` L1-L10
**描述**: 当前 `NpcModule` 只有 `NpcModule { controllers: [NpcController], providers: [NpcService] }`。要实现 RFC-006，至少需要：
  - `imports: [LlmModule]` — 因为 NpcService 需要注入 NpcEngine（或者 NpcService 通过 LlmModule 拿到 NpcEngine/LlmClient）
  - `imports: [GameModule]` — 因为 NpcEngine 需要 ContextProvider（当前在 GameModule 中导出）
  - `providers: [NpcEngine]` — 如果 NpcEngine 不在 LlmModule 中注册的话

但问题来了：LlmModule 已经 `forwardRef(() => GameModule)`，GameModule 已 `forwardRef(() => LlmModule)`。把 NpcModule 再拉进来，会形成 **LlmModule ↔ GameModule ↔ NpcModule 双向引用链**。

**建议**: 
- **最佳方案**：NpcEngine 放在 LlmModule 中注册（与 GMEngine 同级），NpcModule 仅 imports LlmModule
- LlmModule 当前 `providers: [LLMClient, GMEngine]` → 改为 `providers: [LLMClient, GMEngine, NpcEngine]`, `exports: [LLMClient, GMEngine, NpcEngine]`
- NpcModule 不再需要直接 imports GameModule

---

### Y6. Token 预算 50K 对 Sonnet 的合理性需要评估

**文件**: `design.md` D1
**描述**: 设计决策 D1 声明 NPC 对话使用 50K token 预算。对比：
  - GM 叙事（Opus）使用 180K-200K 预算（`context-provider.ts` L46: `buildGMContext(gameId, 180_000)` + GMEngine 设 maxTokens=8192）
  - NPC 对话的 context 包含世界状态 + NPC 人设 + 记忆 + 叙事历史 + 玩家状态，估计至少 2K-5K tokens
  - Sonnet 4-6 的上下文窗口是 200K tokens

50K 的限制对 NPC 对话**可能过于宽松**。NPC 对话不需要全量世界描述和全量 NPC 列表（Y2 已提及）。实际需要的大概是 5K-10K（NPC 人设 ~0.5K + 记忆 ~2K + 世界状态精简 ~1K + 叙事历史 ~2K + 玩家状态 ~0.5K）。50K 预算几乎没有降级触发点，使得 `compact`/`minimal` 粒度的降级逻辑永远不会被执行。

**建议**: 将 budget 从 50K 改为 **20K** 更合理——这仍然远超过实际需要，但为极端情况(大量记忆)留出余量。或者保留 50K 但注明是基于"未来扩展"考虑。

---

## 🟢 轻微问题

### G1. SSE 事件类型命名不一致

**文件**: `design.md` L63
**描述**: `NpcEngine.generate()` 的返回类型写为 `AsyncIterable<GMStreamEvent>`。应对 NPC 对话定义独立的事件类型（`NPCStreamEvent`），避免类型混淆。虽然 contents 一致（都是 chunk + done），但 callType 不同，日志和序列化时会混淆。

**建议**: 定义 `NPCStreamEvent` 类型，与 `GMStreamEvent` 结构相同但名称不同。也可以考虑在 shared layer 定义泛型 `StreamEvent<T extends 'chunk' | 'done'> = ...`。

---

### G2. 记忆分级机制与 MemoryFilter 不兼容

**文件**: `design.md` L103-L113 / `backend/src/context/memory-filter.ts`
**描述**: MemoryFilter 期望 `ClassifiedMemory[]` 结构（含 `tier: 'important' | 'normal' | 'trivial'`），但 RFC-006 的记忆判定（Sonnet 判断）写入时没有 tier 信息。`NpcMemoryModule.renderFull()` 在 setData 时如果注入的是 `string[]`（来自 `npcRepo.getMemories()`），`MemoryFilter.filterForContext` 会对每个分类调用 `heuristicClassify()` 来做分级——这会绕过 Sonnet 的判断。当前内存中的 memory 字段是一个 string 数组，不含 tier 信息。

**建议**:
- 更简单：gather 阶段用当前 heuristic 逻辑做分级，或
- 修改 `npcRepo.getMemories()` 返回 `ClassifiedMemory[]`（加 tier 字段）
- 或增加 `npc_memories` 表的 `tier` 列（默认 `'normal'`）

**这是个小问题**，因为 heuristic 的 fallback 已有。但如果后续用 Sonnet 判断记忆，需要确保 DB schema 能存储 tier。

---

### G3. `talkToNpcSchema` 缺少 maxLength 限制

**文件**: `backend/src/npc/npc.schema.ts`
**描述**: `talkToNpcSchema` 只对 `message` 做了 `z.string().min(1)`，没有 maxLength。用户可能发送极长消息，浪费 token（尤其是 Sonnet 输出 token）或导致 memory 过大。

**建议**: 添加 `z.string().min(1).max(2000)`（或与前端输入框字数限制一致）。

---

### G4. NpcEngine 没有 fallback 降级实现

**文件**: `design.md`（全文）
**描述**: GMEngine 有 `fallbackNarrative()`（`gm-engine.ts` L121-L123），当 LLM 调用失败时返回占位符文本。NpcEngine 的设计中没有降级处理。如果 Sonnet 调用失败，NpcEngine 应该返回一个 fallback 消息（如「XXX 沉默不语」），而不是抛出未处理异常导致 500 错误。

**建议**: 增加 `fallbackDialogue()` 私有方法，在 LLM 流出错时 yield 一个简单的 NPC 回应。

---

### G5. NpcEngine 伪码中 `playerName` 参数来源不明确

**文件**: `design.md` L62
**描述**: NpcEngine.generate 的签名中 `playerName: string` 作为参数传入，但上游 NpcController/NpcService 从哪里获取 playerName？当前 controller schema 中 talkToNpcBody 只包含 `message`。playerName 需要从 DB 的 players 表读取。

**建议**: 在 NpcService.talkStream 中调用 `this.playerRepo.findByGameId(gameId)` 获取 playerName，或 ContextProvider 在 buildNpcContext 时注入 player_state 数据，NpcEngine 从中提取。

---

## 总结

| 严重度 | 数量 | 编号 |
|--------|------|------|
| 🔴 严重 | 5 | R1-R5 |
| 🟡 中等 | 6 | Y1-Y6 |
| 🟢 轻微 | 5 | G1-G5 |

**核心阻断项**: R1（buildNpcContext 不存在）和 R2（NPC 记忆数据不会自动从 DB 加载到 context 管线）是最关键的实现前置条件。在 design.md 中澄清 R4（模板渲染策略）后再动手编码，可以避免大量返工。
