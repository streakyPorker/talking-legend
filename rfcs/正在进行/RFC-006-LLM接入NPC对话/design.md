# RFC-006: LLM 接入 — NPC 对话 — 设计文档

> **状态**: 设计中（v2 — 两轮 Sonnet 审查加固）
> **优先级**: P1
> **创建**: 2026-07-29
> **依赖**: RFC-002（npc+npc_memories表）、RFC-003（NPC配置）、RFC-004（NpcContextBuilder+NpcPersonaModule+NpcMemoryModule）、RFC-005（LLMClient.stream+ContextProvider+NarrativeService）

## 变更记录

| 版本 | 变更 |
|------|------|
| v1 | 初始设计 |
| v2 | 两轮 Sonnet 审查：统一渲染策略(ContextBuilder)、新增对话历史、记忆同步兜底、轻量情绪更新、NpcEngine 降级 |

## 设计决策

| # | 决策 | 结论 |
|---|------|------|
| D1 | 模型 | **Sonnet**（claude-sonnet-4-6），temperature=0.9，token 预算 50K |
| D2 | 流式 | **SSE**，复用 RFC-005 的 `LLMClient.stream()` |
| D3 | 路由 | **新端点** `POST /api/game/:gameId/npc/:npcId/talk/stream` |
| D4 | System prompt | **NpcContextBuilder 模块管线**（npc_persona强制 + npc_memory + world_state + narrative_history + player_state） |
| D5 | User prompt | **对话历史 + 当前消息**（最近的 N 轮 user/assistant 交替） |
| D6 | 记忆写入 | **同步写入原文兜底** + 异步 Sonnet 分级（失败不丢） |
| D7 | 情绪更新 | **轻量同步更新**：Sonnet 对话中推断情绪 → 写入 `npcs.current_mood` |
| D8 | 区域限制 | 仅同区域 NPC 可对话 |
| D9 | Turn | **不 bump turn**（NPC 对话不推进回合） |
| D10 | 降级 | LLM 不可用 → `fallbackDialogue(npcName)` + warn 日志 |
| D11 | 并发 | NPC 对话独立不互斥；同一 NPC 同时只能一个对话（内存锁） |

## 架构

```
POST /api/game/:gameId/npc/:npcId/talk/stream
         │
         ▼
  NpcController.talkStream()
         │
         ▼
  NpcService.talkStream(gameId, npcId, playerMessage)
         │   ① 锁同一 NPC 并发
         │
    ┌────┴────┐
    │ Phase 1 │  读 DB（不 bump turn）
    │         │   npc = npcRepo.findById(npcId)               → 验证存在+同区域
    │         │   world/player/storyline repos                → 世界快照
    │         │   history = 从内存 Map 取最近 N 轮 (≤10轮)     → 对话上下文
    └────┬────┘
         │
    ┌────┴────┐
    │ Phase 2 │  NpcEngine.generate(gameId, npc, playerMessage, history)
    │ 事务外   │    │
    │         │    ├─ ContextProvider.buildNpcContext(gameId, npcId, 50K)
    │         │    │   读取 DB → 创建5个模块实例 → setData() → NpcContextBuilder.build()
    │         │    │   npm_persona(强制) + npc_memory + world_state + narrative_history + player_state
    │         │    │
    │         │    ├─ 组装 user prompt（对话历史 + 当前消息）
    │         │    │
    │         │    ├─ LLMClient.stream({ systemPrompt, userPrompt, temperature: 0.9, model: sonnet })
    │         │    │
    │         │    └─ 后处理（同步）:
    │         │       ① llmLogRepo.insert({ callType: 'npc_dialogue', ... })
    │         │       ② 记忆: npcRepo.addMemory(npcId, playerMessage) // 同步兜底
    │         │       ③ 情绪: 解析 LLM 回复中的 [mood: xxx] 标记 → npcRepo.update(npcId, mood)
    │         │       ④ 更新内存中的对话历史 Map
    └────┬────┘
         ▼
  SSE Response: chunk → done
```

## 1. NpcEngine（新增 `backend/src/llm/npc-engine.ts`）

```typescript
@Injectable()
export class NpcEngine {
  constructor(
    private readonly llmClient: LLMClient,
    private readonly contextProvider: ContextProvider,
    @Inject(LlmLogRepository) private readonly llmLogRepo: LlmLogRepository,
    @Inject(NpcRepository) private readonly npcRepo: NpcRepository,
  ) {}

  async *generate(
    gameId: string, npc: NPCState, playerMessage: string,
    playerName: string, history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): AsyncIterable<GMStreamEvent> {
    const startTime = Date.now();

    // 1. ContextBuilder 模块管线 → system prompt
    let ctx: AssembledContext;
    try {
      ctx = await this.contextProvider.buildNpcContext(gameId, npc.id, 50_000);
    } catch {
      const fallback = this.fallbackDialogue(npc.name);
      yield { type: 'chunk', content: fallback };
      yield { type: 'done', turn: -1, tokenEstimate: 0 };
      return;
    }

    // 2. User prompt = 对话历史 + 当前消息
    const userPrompt = [
      ...history.map((h) => `${h.role === 'user' ? playerName : npc.name}：${h.content}`),
      `${playerName}：${playerMessage}`,
    ].join('\n');

    // 3. 流式 LLM（Sonnet, temperature 0.9）
    let fullText = '';
    try {
      for await (const event of this.llmClient.stream({
        systemPrompt: ctx.systemPrompt,
        userPrompt,
        maxTokens: 1024,
        temperature: 0.9,
      })) {
        if (event.type === 'chunk') { fullText += event.content; yield { type: 'chunk', content: event.content }; }
      }
    } catch {
      const fallback = this.fallbackDialogue(npc.name);
      fullText = fallback;
      yield { type: 'chunk', content: fallback };
    }

    // 4. 后处理（同步，try/catch 静默）
    const latencyMs = Date.now() - startTime;
    try { this.llmLogRepo.insert({ gameId, callType: 'npc_dialogue', model: this.llmClient.sonnetModel, promptTokens: ctx.tokenEstimate, completionTokens: Math.ceil(fullText.length / 2), latencyMs, costUsd: 0 }); } catch {}
    try { this.npcRepo.addMemory(npc.id, playerMessage, 0); } catch {}  // 同步兜底
    try { this.updateMood(npc, fullText); } catch {}

    yield { type: 'done', turn: -1, tokenEstimate: ctx.tokenEstimate };
  }

  /** 降级对话 */
  private fallbackDialogue(npcName: string): string {
    return `${npcName}沉默了片刻，似乎陷入了沉思。`;
  }

  /** 从 LLM 回复中提取 [mood: xxx] 标记并更新 NPC 情绪 */
  private updateMood(npc: NPCState, response: string): void {
    const match = response.match(/\[mood:\s*(\S+)\]/);
    if (match) {
      this.npcRepo.update(npc.id, { currentMood: match[1] });
    }
  }
}
```

**记忆判定策略**：
- **同步兜底**：每次对话结束必定调用 `npcRepo.addMemory(npcId, playerMessage, 0)` 写入原文（turn=0 表示 NPC 对话不计回合）
- **异步分级**：后续 RFC-007 接入后用 Haiku 对 `npc_memories` 表中未分级的记忆做批量分级（important/normal/trivial）。RFC-006 先全量写 normal
- **addMemory 签名**：`npcRepo.addMemory(npcId, content, turn)` — 需要在 NpcRepository 中新增此方法

## 2. ContextProvider 扩展（`buildNpcContext`）

在 `context-provider.ts` 中新增方法：

```typescript
async buildNpcContext(gameId: string, npcId: string, budget: number): Promise<AssembledContext> {
  const world = this.worldRepo.findByGameId(gameId);
  const npc = this.npcRepo.findById(npcId);
  if (!npc) throw new NotFoundException(`NPC not found: ${npcId}`);

  const player = this.playerRepo.findByGameId(gameId);
  const storyline = this.storylineRepo.findByGameId(gameId);
  const worldCfg = this.worldConfig.getWorld(world?.name ?? '');
  const narrativeText = this.narrativeService.getRecentHistory(gameId);

  // 读取 NPC 记忆（转为 ClassifiedMemory[]）
  const rawMemories = this.npcRepo.getMemories(npcId);  // string[]
  const classified: ClassifiedMemory[] = rawMemories.map((content, i) => ({
    id: i, npcId, content, turn: 0, tier: 'normal' as const, createdAt: '',
  }));

  const modules = new Map<string, ContextModule>();

  // npc_persona（强制）
  const persona = new NpcPersonaModule();
  persona.setData({ npcName: npc.name, npcRole: npc.role, npcLocation: npc.location, npcPersonality: npc.personality, npcMood: npc.currentMood });
  modules.set('npc_persona', persona);

  // npc_memory（非强制）
  const memModule = new NpcMemoryModule();
  memModule.setData({ memories: classified });
  modules.set('npc_memory', memModule);

  // world_state（强制）
  const worldModule = new WorldStateModule();
  worldModule.setData({ timeOfDay: world?.timeOfDay ?? '清晨', weather: world?.weather ?? '晴朗', currentRegion: world?.currentRegion ?? '未知', currentRegionName: worldCfg?.regions?.find(r => r.id === world?.currentRegion)?.name ?? '', worldDescription: worldCfg?.description ?? '', regions: (world?.regions ?? []).map(r => { const c = worldCfg?.regions?.find(x => x.id === r.id); return { id: r.id, name: c?.name ?? r.name, description: c?.description ?? r.description }; }), npcs: (this.npcRepo.findByGameId(gameId) ?? []).map(n => ({ name: n.name, role: n.role, personality: n.personality, location: n.location, mood: n.currentMood })) });
  modules.set('world_state', worldModule);

  // narrative_history（非强制）
  const histModule = new NarrativeHistoryModule();
  histModule.setData({ history: narrativeText ? parseNarrativeHistory(narrativeText) : undefined });
  modules.set('narrative_history', histModule);

  // player_state（非强制）
  const playerModule = new PlayerStateModule();
  playerModule.setData({ playerName: player?.name ?? '未知', playerLocation: player?.location ?? '未知', inventory: player?.inventory ?? [], reputation: player?.reputation ?? {}, quests: player?.quests ?? [] });
  modules.set('player_state', playerModule);

  const builder = new NpcContextBuilder(modules);
  return builder.build(gameId, budget);
}
```

**对比 buildGMContext**：差异在于多了 `npc_persona`（强制）+ `npc_memory` 模块，少了 `active_events` + `scenario_hint`。

## 3. 对话历史管理（NpcService 内存 Map）

```typescript
// NpcService 内部 — 可配置参数
private readonly MAX_HISTORY: number;
constructor() { this.MAX_HISTORY = Number(process.env.NPC_HISTORY_ROUNDS) || 20; }

private conversationHistory = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();
```

每次对话后将本轮问答追加到 Map，超过 `MAX_HISTORY` 轮时移除最早记录。默认 20 轮（约 4-8K tokens），可通过 `NPC_HISTORY_ROUNDS` 环境变量调节。

**不需要持久化**：对话历史是运行时上下文，重启后从 narrative log 和 npc_memories 恢复即可。

## 4. NPC 情绪更新

LLM system prompt 末尾加入指令：
```
在回复的最后一行，用 [mood: 情绪词] 标记你当前的情绪。
情绪可选：平静/愤怒/悲伤/疑惑/喜悦/警觉/慈祥/冷漠/好奇
```

NpcEngine 解析回复中的 `[mood: xxx]`，调用 `npcRepo.update(npcId, { currentMood })` 同步更新 DB。下次对话时 NpcPersonaModule 使用最新情绪。

## 5. 模块注册

```
LlmModule: providers: [LLMClient, GMEngine, NpcEngine]  ← NpcEngine 与 GMEngine 同级
           exports: [LLMClient, GMEngine, NpcEngine]
           imports: [ConfigModule, PromptModule]

NpcModule: controllers: [NpcController]
           providers: [NpcService]
           imports: [LlmModule]  ← 获取 NpcEngine
           exports: [NpcService]
```

**无循环依赖**：NpcModule → LlmModule → ConfigModule/PromptModule/DbModule，单向。

## 6. 文件变更

```
backend/src/
  llm/
    npc-engine.ts              ✨ NEW：NPC 对话引擎（含降级+情绪+memory）
    npc-engine.spec.ts         ✨ NEW：8+ 单元测试
    llm.module.ts               🔧 providers 加 NpcEngine
  game/
    context-provider.ts         🔧 新增 buildNpcContext() 方法
  npc/
    npc.service.ts              🔧 talkStream() + 对话历史 Map + 并发锁
    npc.controller.ts           🔧 talkStream SSE 端点
    npc.module.ts               🔧 imports [LlmModule]
  db/repositories/
    npc.repository.ts           🔧 新增 addMemory(npcId, content, turn) 方法
```

## 7. 非目标

- ❌ NPC 记忆异步分级（RFC-007 接入 Haiku 后）
- ❌ 多 NPC 社交感知
- ❌ 前端 NPC 对话面板（RFC-011）
- ❌ 对话历史持久化

## 8. 审查修复清单

| 审查 ID | 问题 | 修复 |
|---------|------|------|
| R1 | buildNpcContext() 不存在 | ✅ §2 新增 ContextProvider.buildNpcContext() |
| R2 | NPC 记忆不自动加载 | ✅ buildNpcContext 中 npcRepo.getMemories() → ClassifiedMemory[] → setData |
| R3/R4 | 双轨渲染冲突 | ✅ 统一走 ContextBuilder 管线，user prompt 仅拼对话历史 |
| R5 | 记忆 turn 标记 | ✅ addMemory(npcId, content, 0) — turn=0 表示 NPC 对话 |
| #2 | 对话历史缺失 | ✅ §3 NpcService 内存 Map，最多 10 轮 |
| #4 | 记忆判定无同步保障 | ✅ D6 同步写入原文兜底 |
| #8 | NPC 情绪不更新 | ✅ §4 轻量 [mood: xxx] 标记解析 + npcRepo.update |
| #10 | NpcEngine 无降级 | ✅ §1 fallbackDialogue() |
| #1 | 记忆类型不匹配 | ✅ buildNpcContext 中 string[] → ClassifiedMemory[] 转换 |
| #9 | NPC 不感知其他 NPC | ✅ world_state 含 npcs 列表（已有） |
| #11 | temperature 未指定 | ✅ D1 temperature=0.9 |
