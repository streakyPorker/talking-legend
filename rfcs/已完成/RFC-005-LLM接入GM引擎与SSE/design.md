# RFC-005: LLM 接入 — GM 引擎与 SSE — 设计文档

> **状态**: 已完成（v3 — 两轮独立审查 + 保留 ContextBuilder 框架）
> **优先级**: P1
> **创建**: 2026-07-28
> **依赖**: RFC-002（数据库/llm_logs）、RFC-003（世界配置）、RFC-004（ContextBuilder + ContextModule + TemplateEngine）

## 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1 | 07-28 | 初始设计 |
| v2 | 07-28 | 自审修复：模板语法、API 签名、NarrativeService 新建、跳过 ContextBuilder |
| v3 | 07-28 | **两轮独立 agent 审查 + 恢复 ContextBuilder 框架**：新增 ContextProvider（数据注入层）、PromptModule、类型化 SSE 事件、SSE 协议完整解析 |

## 设计决策汇总

| # | 决策 | 选项 | 理由 |
|---|------|------|------|
| D1 | LLMClient 架构 | **NestJS @Injectable**（替代现 `getLLMClient()` 单例） | 现单例读 `process.env`，与 ConfigService 规范冲突 |
| D2 | 流式协议 | **SSE（text/event-stream）** | 标准，浏览器可消费，与 NestJS 兼容 |
| D3 | SSE 路由 | **新端点** `POST /api/game/:id/action/stream` | 保持现有 JSON 端点不变 |
| D4 | 并发互斥 | **内存 Set + 409 Conflict**（JS 事件循环同步安全） | MVP 单进程足够 |
| D5 | Prompt 组装 | **ContextBuilder 模块管线**（system prompt）+ **TemplateEngine**（user prompt） | 保留 RFC-004 框架，通过 ContextProvider 补数据注入层 |
| D6 | 两阶段事务 | **事务内读+turn bump → 事务外调 LLM → 日志同步写**（try/catch 包裹） | RFC-002 禁止 db.transaction() 内 async |
| D7 | Token 预算 | **Opus 180K**（200K 窗口预留 20K 输出） | 字符数/2 估算 |
| D8 | 降级策略 | **LLM 不可用时返回占位叙事 + warn 日志** | 不阻塞游戏 loop |
| D9 | narrative_log | **向 `narrative-log.ts` 同步追加**（try/catch 静默） | 持久化到文件 |
| D10 | SSE 事件格式 | **类型化 JSON 事件** `GMStreamEvent = GMChunkEvent \| GMDoneEvent` | 类型安全，便于前端消费 |
| D11 | TemplateEngine DI | **PromptModule 工厂 provider** `useFactory: (config) => new TemplateEngine(config.templatesDir)` | TemplateEngine 构造参数不是 NestJS 可注入类型 |
| D12 | 数据注入层 | **ContextProvider 服务**：读 DB → 创建模块实例 → setData() → 注册到 Map → 传给 ContextBuilder | RFC-004 模块缺数据注入调用方 |

## 架构总览

```
POST /api/game/:id/action/stream
         │
         ▼
  GameController.performActionStream()
         │   @Res() res: Response
         │   Content-Type: text/event-stream
         │   try/catch → SSE error event（绕过 AllExceptionsFilter）
         │   finally { if (!res.writableEnded) res.end() }
         ▼
  GameService.performActionStream(gameId, action, target?)
         │   并发锁: activeGenerations Set (JS 事件循环同步安全)
         │
    ┌────┴────┐
    │ Phase 1 │  db.transaction(() => {
    │ 事务内   │    game = gameRepo.findById(gameId)
    │         │    gameRepo.updateTurn(gameId, turn+1, turn)  // optimistic concurrency
    │         │    world = worldRepo.findByGameId(gameId)     // undefined → throw
    │         │    npcs = npcRepo.findByGameId(gameId)
    │         │    player = playerRepo.findByGameId(gameId)
    │         │    storyline = storylineRepo.findByGameId(gameId)
    │         │    worldCfg = worldConfig.getWorld(game.world?.name)
    │         │    return { turn: turn+1, world, npcs, player, storyline, worldCfg }
    │         │  })()
    └────┬────┘
         │
    ┌────┴────┐
    │ Phase 2 │  GMEngine.generate(gameId, snapshot, action, target)
    │ 事务外   │    │
    │         │    ├─ ContextProvider.buildGMContext(gameId, 180K)
    │         │    │   ├─ 读 DB: world/npc/player/storyline repos + WorldConfig + NarrativeService
    │         │    │   ├─ 创建 ContextModule 实例 → setData(dbData)
    │         │    │   ├─ 注册到 Map<string, ContextModule>
    │         │    │   ├─ GMContextBuilder.build(gameId, 180K, params)
    │         │    │   │   ├─ 按 DEFAULT_MODULE_CONFIG 筛选模块
    │         │    │   │   ├─ 并行 gather() → 强制模块 full → 非强制按预算降级
    │         │    │   │   └─ → AssembledContext { systemPrompt, userPrompt: '', tokenEstimate }
    │         │    │   └─ 返回 AssembledContext
    │         │    │
    │         │    ├─ TemplateEngine.render("gm.narrative.user", { playerAction, target })
    │         │    │   → user prompt
    │         │    │
    │         │    ├─ LLMClient.stream({ systemPrompt, userPrompt })
    │         │    │   ├─ fetch POST /v1/messages (stream:true, 超时可配置)
    │         │    │   ├─ SSE 解析: content_block_start → content_block_delta(text_delta) → message_delta(usage) → message_stop
    │         │    │   └─ → AsyncIterable<GMStreamEvent>
    │         │    │
    │         │    ├─ 降级: catch → fallbackNarrative → yield chunk(fallback) + done
    │         │    │
    │         │    ├─ 日志 (try/catch 静默):
    │         │    │   llmLogRepo.insert({ gameId, callType, model, ... })
    │         │    │   narrativeService.append(gameId, turn, fullText)
    │         │    │
    │         │    └─ yield done { turn, tokenEstimate, usage? }
    │         │
    └────┬────┘
         │
         ▼
  SSE Response: data: chunk → ... → data: done
```

## 1. LLMClient 重构

### 1.1 @Injectable() 改造

删除现有 `getLLMClient()` 单例工厂（`client.ts` 第 137-150 行），改为 NestJS 可注入服务：

```typescript
@Injectable()
export class LLMClient {
  constructor(private readonly config: ConfigService) {}

  /** 公开当前模型名（供日志记录，替代 `this.llmClient['config']` 异味） */
  get opusModel(): string { return this.config.llmOpusModel; }
  get sonnetModel(): string { return this.config.llmSonnetModel; }
  get haikuModel(): string { return this.config.llmHaikuModel; }
  get streamTimeoutMs(): number { return this.config.llmStreamTimeoutMs ?? 60_000; }
```

### 1.2 `call()` 保留（非流式）

保留现有 3 次重试 + exponential backoff + fallback 逻辑，内部改用 `ConfigService` 替代 `LLMConfig`：

```typescript
async call(options: LLMCallOptions): Promise<LLMCallResult> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      return await this._callWithTimeout(options);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }
  return this.fallbackResponse(options, lastError);
}
```

### 1.3 `stream()` 新增（流式 — 关键修复）

**修复 A1**：处理 Anthropic SSE 全部 6 种事件类型 + error 事件。
**修复 A2**：response.body null 防御。
**修复 B1**：超时改用 `AbortController`（兼容性）+ 可配置超时。

```typescript
async *stream(options: LLMCallOptions & { maxTokens?: number }): AsyncIterable<StreamChunk> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), this.streamTimeoutMs);

  try {
    const response = await fetch(`${this.config.llmBaseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.llmApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.opusModel,
        system: options.systemPrompt,
        messages: [{ role: 'user', content: options.userPrompt }],
        max_tokens: options.maxTokens ?? 8192,
        temperature: options.temperature ?? 0.7,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM API error ${response.status}: ${text}`);
    }
    if (!response.body) {
      throw new Error('LLM API returned empty response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentBlockType: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = JSON.parse(line.slice(6));

        switch (data.type) {
          case 'content_block_start':
            currentBlockType = data.content_block?.type ?? null;
            break;

          case 'content_block_delta':
            if (data.delta?.type === 'text_delta') {
              yield { type: 'chunk', content: data.delta.text };
            }
            break;

          case 'message_delta':
            // ⭐ 捕获 usage（流式模式下唯一来源）
            yield {
              type: 'usage',
              inputTokens: data.usage?.input_tokens ?? 0,
              outputTokens: data.usage?.output_tokens ?? 0,
            };
            break;

          case 'message_stop':
            yield { type: 'stream_end' };
            break;

          case 'error':
            throw new Error(
              `Stream error: ${data.error?.message ?? 'unknown'} (type: ${data.error?.type ?? '?'})`,
            );
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
```

**StreamChunk 类型**：

```typescript
export type StreamChunk =
  | { type: 'chunk'; content: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'stream_end' };
```

**超时说明**：`streamTimeoutMs` 默认 60s，从 `ConfigService.llmStreamTimeoutMs` 读取（未配置则 default 60s）。Opus 长篇叙事可能需要 15-40s，60s 留足 buffer。后续可合并首 token 超时（15s）+ 总超时（90s）双段策略。

## 2. ContextProvider — 数据注入层（D12）

RFC-004 的 ContextModule 是 POJO：`setData()` 注入数据后 `gather()` 才返回有意义内容。ContextProvider 是数据注入的调用方。

```typescript
@Injectable()
export class ContextProvider {
  constructor(
    @Inject(DB_INSTANCE) private readonly db: Database.Database,
    @Inject(WorldRepository) private readonly worldRepo: WorldRepository,
    @Inject(NpcRepository) private readonly npcRepo: NpcRepository,
    @Inject(PlayerRepository) private readonly playerRepo: PlayerRepository,
    @Inject(StorylineRepository) private readonly storylineRepo: StorylineRepository,
    private readonly worldConfig: WorldConfigService,
    private readonly narrativeService: NarrativeService,
  ) {}

  /**
   * 构建 GM 叙事上下文。
   * 1. 读 DB → 2. 创建模块实例 + setData() → 3. 注册到 Map → 4. ContextBuilder.build()
   */
  async buildGMContext(
    gameId: string,
    budget: number,
  ): Promise<AssembledContext> {
    // 1. 读 DB
    const world = this.worldRepo.findByGameId(gameId);
    const npcs = this.npcRepo.findByGameId(gameId);
    const player = this.playerRepo.findByGameId(gameId);
    const storyline = this.storylineRepo.findByGameId(gameId);
    const worldCfg = this.worldConfig.getWorld(world?.name ?? '');

    // 2. 组装结构化数据
    const regionNames = world?.regions?.map(r => `${r.name}(${r.id})`).join('、') ?? '未知';
    const history = this.narrativeService.getRecentHistory(gameId);

    // 3. 创建模块实例 + setData()
    const modules = new Map<string, ContextModule>();

    const worldModule = new WorldStateModule();
    worldModule.setData({
      timeOfDay: world?.timeOfDay ?? '清晨',
      weather: world?.weather ?? '晴朗',
      currentRegion: world?.currentRegion ?? '未知',
      currentRegionName: world?.regions?.find(r => r.id === world?.currentRegion)?.name ?? '',
      regions: world?.regions ?? [],
    });
    modules.set('world_state', worldModule);

    const playerModule = new PlayerStateModule();
    playerModule.setData({
      playerName: player?.name ?? '未知',
      playerLocation: player?.location ?? '未知',
      inventory: player?.inventory ?? [],
      reputation: player?.reputation ?? {},
      quests: player?.quests ?? [],
    });
    modules.set('player_state', playerModule);

    const historyModule = new NarrativeHistoryModule();
    historyModule.setData({
      history: history
        ? { recent: history, totalRounds: history.split('\n').length }
        : undefined,
    });
    modules.set('narrative_history', historyModule);

    const eventsModule = new ActiveEventsModule();
    eventsModule.setData({
      activeEvents: storyline?.activeEvents ?? [],
    });
    modules.set('active_events', eventsModule);

    const hintModule = new ScenarioHintModule();
    hintModule.setData({
      hint: worldCfg?.gmHint ?? '无特殊指引。',
    });
    modules.set('scenario_hint', hintModule);

    // 4. ContextBuilder 组装
    const builder = new GMContextBuilder(modules);
    return builder.build(gameId, budget);
  }
}
```

**为什么不在 Provider 中注入已构建的 Builder**：ContextBuilder 是无状态的——每次 `build()` 都从 modules 中重新 `gather()` 数据（数据在 `setData()` 时已固化在 module 实例中）。因此 ContextProvider 每次调用都创建新的 module 实例和 builder，避免了跨请求数据污染。

## 3. PromptModule — TemplateEngine DI（D11 / 修复 A5）

```typescript
// backend/src/prompts/prompt.module.ts — 新文件
@Module({
  providers: [
    {
      provide: TemplateEngine,
      useFactory: () => {
        // templatesDir: 相对于项目根目录
        const templatesDir = path.resolve(__dirname, '..', 'prompts', 'templates');
        return new TemplateEngine(templatesDir);
      },
    },
  ],
  exports: [TemplateEngine],
})
export class PromptModule {}
```

## 4. 模块注册方案（修复 A6/A7 + GMEngine 放 llm/）

```
backend/src/
  llm/
    llm.module.ts       # providers: [LLMClient, GMEngine]
                        # imports: [ConfigModule, PromptModule, DbModule]
                        # exports: [LLMClient, GMEngine]

  prompts/
    prompt.module.ts    # NEW: 工厂 provider → TemplateEngine
                        # exports: [TemplateEngine]

  game/
    game.module.ts      # providers: [GameService, NarrativeService, ContextProvider]
                        # imports: [LlmModule, PromptModule, DbModule]
                        #   → GMEngine from LlmModule
                        #   → TemplateEngine from PromptModule
                        #   → Repositories from DbModule (@Global)
```

**循环依赖分析**：
- `LlmModule` → imports `DbModule`（全局，获取 LlmLogRepository）
- `GameModule` → imports `LlmModule`（获取 GMEngine + LLMClient）+ `PromptModule`（获取 TemplateEngine）
- 无反向依赖 → 无循环

## 5. GMEngine（保留 ContextBuilder，修复 A4/B3/B4）

```typescript
/** GM 流式事件类型（修复 B4） */
export interface GMChunkEvent { type: 'chunk'; content: string }
export interface GMDoneEvent { type: 'done'; turn: number; tokenEstimate: number; inputTokens?: number; outputTokens?: number }
export type GMStreamEvent = GMChunkEvent | GMDoneEvent;

@Injectable()
export class GMEngine {
  constructor(
    private readonly llmClient: LLMClient,
    private readonly templateEngine: TemplateEngine,
    private readonly contextProvider: ContextProvider,  // ← 替代直接注入 ContextBuilder
    @Inject(LlmLogRepository) private readonly llmLogRepo: LlmLogRepository,
    private readonly narrativeService: NarrativeService,
  ) {}

  async *generate(
    gameId: string,
    action: string,
    target: string | undefined,
    turn: number,
  ): AsyncIterable<GMStreamEvent> {
    const startTime = Date.now();

    // 1. ContextBuilder 模块管线 → systemPrompt（修复：保留 ContextBuilder 框架）
    const ctx = await this.contextProvider.buildGMContext(gameId, 180_000);

    // 2. TemplateEngine → userPrompt
    const userParams: Record<string, string> = {
      playerAction: action,
      target: target ?? '无',
    };
    const userPrompt = this.templateEngine.render(
      'gm.narrative.user',
      userParams,
      GM_NARRATIVE_USER_PARAMS,
    );

    // 3. 流式 LLM
    let fullText = '';
    let apiUsage: { inputTokens: number; outputTokens: number } | null = null;

    try {
      for await (const event of this.llmClient.stream({
        systemPrompt: ctx.systemPrompt,
        userPrompt,
        maxTokens: 8192,
      })) {
        if (event.type === 'chunk') {
          fullText += event.content;
          yield { type: 'chunk', content: event.content };
        } else if (event.type === 'usage') {
          apiUsage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
        }
        // stream_end: 正常结束时捕获 usage 后进入日志记录
      }
    } catch (err) {
      const fallback = this.fallbackNarrative(action);
      fullText = fallback;
      yield { type: 'chunk', content: fallback };
    }

    // 4. 同步日志（try/catch 包裹 — 修复 B2/B9）
    const latencyMs = Date.now() - startTime;
    try {
      this.llmLogRepo.insert({
        gameId,
        callType: 'gm_narrative',
        model: this.llmClient.opusModel,   // 修复 A4：公开 getter
        promptTokens: apiUsage?.inputTokens ?? ctx.tokenEstimate,
        completionTokens: apiUsage?.outputTokens ?? Math.ceil(fullText.length / 2),
        latencyMs,
        costUsd: 0,
      });
    } catch { /* 日志写入失败不阻塞游戏 */ }

    try {
      this.narrativeService.append(gameId, turn, fullText);
    } catch { /* 叙事日志写入失败不阻塞游戏 */ }

    // 5. Done 事件（含 API usage）
    yield {
      type: 'done',
      turn,
      tokenEstimate: ctx.tokenEstimate,
      ...(apiUsage ? { inputTokens: apiUsage.inputTokens, outputTokens: apiUsage.outputTokens } : {}),
    };
  }

  private fallbackNarrative(action: string): string {
    return `你${action}。世界屏息凝神，等待下一章的到来…`;
  }
}
```

## 6. NarrativeService（修复 B2/B9 — 同步操作）

```typescript
@Injectable()
export class NarrativeService {
  constructor(private readonly config: ConfigService) {}

  append(gameId: string, turn: number, content: string): void {
    const line = `[${turn}] ${content}`;
    appendNarrative(this.config.gameDataDir, gameId, line);
  }

  /** 读取最近 N 轮，包装为结构化 Markdown（修复 A3） */
  getRecentHistory(gameId: string, recentCount = 5): string {
    const raw = readNarrative(this.config.gameDataDir, gameId);
    if (!raw) return '';
    const lines = raw.trim().split('\n');
    const recent = lines.slice(-recentCount);
    // 修复 A3：包装为 "- [第N轮] 内容" 格式，匹配模板上下文
    return recent.map(line => line.replace(/^\[(\d+)\]/, '- [第$1轮]')).join('\n');
  }
}
```

## 7. GameService（修复 B5/B6/B7）

```typescript
// 并发锁（JS 事件循环同步安全 — 单进程内 Set.has+add 之间无 yield 点）
private readonly activeGenerations = new Set<string>();

async *performActionStream(
  gameId: string,
  action: string,
  target?: string,
): AsyncIterable<string> {
  if (this.activeGenerations.has(gameId)) {
    throw new ConflictException('GM is already generating for this game');
  }
  this.activeGenerations.add(gameId);

  try {
    // Phase 1: 事务内读取 + turn bump
    const snapshot = this.db.transaction(() => {
      const game = this.gameRepo.findById(gameId);
      if (!game) throw new NotFoundException(`Game not found: ${gameId}`);

      const newTurn = game.turn + 1;
      const updated = this.gameRepo.updateTurn(gameId, newTurn, game.turn);
      if (!updated) throw new ConflictException('Game modified by another request');

      const world = this.worldRepo.findByGameId(gameId);
      const player = this.playerRepo.findByGameId(gameId);
      // 修复 B6：防御性检查 — 数据不完整时抛 InternalServerError
      if (!world || !player) {
        throw new Error('Game state incomplete');
      }

      return {
        turn: newTurn,
        world,
        npcs: this.npcRepo.findByGameId(gameId),
        player,
        storyline: this.storylineRepo.findByGameId(gameId),
      };
    })();

    // Phase 2: 事务外 LLM + SSE 直出
    const generator = this.gmEngine.generate(
      gameId, snapshot.action ?? action, target, snapshot.turn,
    );

    for await (const event of generator) {
      yield JSON.stringify(event);
    }
    // 注意：Phase 1 事务已提交，turn bump 不可回滚。
    // LLM 失败已降级为占位叙事，turn 递增 + 降级叙事 = 一致。
    // 极端场景（进程崩溃）导致 turn 递增但叙事未写入属已知取舍（D9）。
  } finally {
    this.activeGenerations.delete(gameId);
  }
}
```

**B7 文档化**：现有 JSON 端点 `POST /api/game/:id/action` 继续返回占位叙事。此 RFC 不改变它的行为。后续 RFC 可让它也调用 LLM（非流式）或废弃它。

## 8. SSE Controller（修复 B5）

```typescript
@Post(':id/action/stream')
async performActionStream(
  @Param('id') id: string,
  @Body(new ZodValidationPipe(GameActionRequestSchema)) body: GameActionRequestValidated,
  @Res() res: Response,  // 类型: import type { Response } from 'express'
) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // 禁用 nginx 缓冲

  try {
    for await (const chunk of this.gameService.performActionStream(
      id, body.action, body.target,
    )) {
      res.write(`data: ${chunk}\n\n`);
    }
  } catch (err) {
    const message = err instanceof HttpException
      ? err.message
      : 'Internal server error';
    res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
  } finally {
    // 修复 B5：检查 writableEnded
    if (!res.writableEnded) {
      res.end();
    }
  }
}
```

## 9. 模板修复

### `user.md` 修复（修复 A13）

```diff
- {{#target}}目标：{{target}}{{/target}}
+ 目标：{{target}}
```

## 10. 文件变更清单（更新）

```
backend/src/
  llm/
    client.ts                🔧 重构：@Injectable() + stream()(6种事件) + 公开 model getter + ConfigService DI
    llm.module.ts             🔧 注册 LLMClient + GMEngine，imports [ConfigModule, PromptModule, DbModule]
    gm-engine.ts              ✨ NEW：GM 叙事生成（类型化事件 + ContextProvider + 同步日志）
    gm-engine.spec.ts         ✨ NEW：12+ 测试
  prompts/
    prompt.module.ts          ✨ NEW：TemplateEngine 工厂 provider
    templates/gm/narrative/
      user.md                 🔧 修复 {{#target}} 语法
  game/
    game.module.ts            🔧 providers: [GameService, NarrativeService, ContextProvider]
    game.service.ts           🔧 performActionStream() + 并发锁 + 防御性检查
    game.controller.ts        🔧 SSE 端点 + writableEnded 保护
    narrative.service.ts      ✨ NEW：叙事文件读写包装（同步操作，try/catch 包裹）
    context-provider.ts       ✨ NEW：数据注入层（DB→module→ContextBuilder）
    context-provider.spec.ts  ✨ NEW：单元测试
```

**不新增**：
- 前端改动（属 RFC-011）
- ContextBuilder/ContextModule 自身改动（复用 RFC-004）

## 11. 测试策略

| 层级 | 内容 | 框架 |
|------|------|------|
| 单元 | `LLMClient.stream()` — mock fetch SSE 响应，验证 6 种事件类型 + error + body null | Vitest |
| 单元 | `GMEngine.generate()` — mock LLMClient + ContextProvider + TemplateEngine，验证 chunk/done/降级/usage | Vitest |
| 单元 | `ContextProvider.buildGMContext()` — mock repos，验证模块创建+setData+组装 | Vitest |
| 单元 | `NarrativeService.getRecentHistory()` — 验证文件读写+截取+Markdown 包装 | Vitest |
| 服务 | `POST /api/game/:id/action/stream` — supertest 读取 SSE 流 | Supertest |
| 服务 | 并发互斥 — 第二个请求返回 409 | Supertest |

## 12. 非目标

- ❌ 前端 SSE 消费（RFC-011）
- ❌ NPC 对话流式（RFC-006）
- ❌ 意图分类（RFC-007）
- ❌ 分布式锁 / tiktoken / cost 精算
- ❌ 热更新模板

## 13. 修复清单（交叉引用两个 agent 审查）

| 审查 ID | 问题 | 状态 |
|---------|------|------|
| A1 | SSE 仅处理 content_block_delta → 补全 6 种事件 | ✅ §1.3 |
| A2 | response.body! null → 显式检查 | ✅ §1.3 |
| A3 | narrativeHistory 格式不匹配 → Markdown 包装 | ✅ §6 |
| A4 | this.llmClient['config'] → 公开 getter | ✅ §1.1 + §5 |
| A5 | TemplateEngine 不可注入 → PromptModule 工厂 | ✅ §3 |
| A6 | 模块注册缺失 → 完整方案 §4 | ✅ §4 |
| A7 | GMEngine 位置 → llm/（循环依赖分析通过） | ✅ §4 |
| B1 | AbortSignal.timeout 兼容性 → AbortController + setTimeout | ✅ §1.3 |
| B2 | logToDb async 假象 → 去掉 async + try/catch | ✅ §5 |
| B3 | Token 估算重复 → 用 API usage 优先 / estimateTokens fallback | ✅ §5 |
| B4 | AsyncIterable<string> → 类型化 GMStreamEvent | ✅ §5 |
| B5 | res.end() 双写 → writableEnded 保护 | ✅ §8 |
| B6 | findByGameId undefined 断言 → 防御性检查 | ✅ §7 |
| B7 | JSON/SSE 端点差异文档化 | ✅ §7 (注释) |
