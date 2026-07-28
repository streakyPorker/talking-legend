# RFC-005: LLM 接入 — GM 引擎与 SSE — 执行记录

> **状态**: 已完成
> **开始**: 2026-07-29
> **结束**: 2026-07-29
> **设计**: design.md v3（两轮独立审查 + 保留 ContextBuilder 框架）

## 执行计划

| 任务 | 内容 | 依赖 | 状态 |
|------|------|------|------|
| US-001 | LLMClient 重构：@Injectable() + stream() + 移除 getLLMClient() | — | ✅ |
| US-002 | PromptModule + user.md 模板修复 | — | ✅ |
| US-003 | NarrativeService：叙事文件读写包装 | — | ✅ |
| US-004 | ContextProvider：数据注入层 + 8 单元测试 | US-003 | ✅ |
| US-005 | GMEngine：叙事生成服务 + 10 单元测试 | US-001, US-002, US-004 | ✅ |
| US-006 | GameModule + GameService + GameController + GameSchema 集成 | US-001, US-003, US-005 | ✅ |
| US-007 | 完工验证 | 全部 | ✅ |

## 交付物

### 新增文件 (6)

```
backend/src/
  prompts/prompt.module.ts           # TemplateEngine 工厂 provider
  llm/gm-engine.ts                   # GM 叙事生成（类型化事件 + 降级 + 日志）
  llm/gm-engine.spec.ts              # 10 单元测试
  game/narrative.service.ts          # 叙事文件读写包装（per-game 隔离）
  game/context-provider.ts           # ContextModule 数据注入层（DB→module→ContextBuilder）
  game/context-provider.spec.ts      # 8 单元测试
```

### 修改文件 (8)

```
backend/src/
  llm/client.ts                      # 重构：@Injectable() + ConfigService DI + stream()(6种SSE事件) + 删除 getLLMClient()
  llm/llm.module.ts                  # 注册 LLMClient + GMEngine, imports [ConfigModule, PromptModule, forwardRef(GameModule)]
  prompts/templates/gm/narrative/
    user.md                          # 修复 {{#target}} 语法 → {{target}}
  game/game.module.ts                # imports [LlmModule(forwardRef), PromptModule], providers [NarrativeService, ContextProvider]
  game/game.service.ts               # performActionStream() + 并发锁 + StorylineRepository + GMEngine 注入
  game/game.controller.ts            # POST /api/game/:id/action/stream SSE 端点
  game/game.schema.ts                # 无需修改（target 已存在）
  __tests__/game-service.test.ts     # 同步更新构造函数参数
```

### 测试

| 文件 | 测试数 | 类型 |
|------|--------|------|
| `context-provider.spec.ts` | 8 | 单元 |
| `gm-engine.spec.ts` | 10 | 单元 |
| 存量测试（14 backend + 1 frontend） | 148 | 全部通过 |
| **合计** | **166** | 全部通过 |

## 验证证据（RFC 完工铁律）

### 1. Typecheck

```
npm run typecheck
  @talking-legend/shared   → tsc --noEmit ✓
  @talking-legend/backend  → tsc --noEmit ✓
  @talking-legend/frontend → tsc --noEmit ✓
```

### 2. 构建

```
npm run build -w shared && npm run build -w backend
  shared: tsc ✓
  backend: Successfully compiled: 85 files with swc (274.08ms)
```

### 3. 测试

```
npm test
  15 test files passed (14 backend + 1 frontend)
  166 tests passed, zero failures
```

### 4. 启动日志

```
[migrate] v1 (initial_schema) applied.
[Nest] ConfigService: Settings loaded from ~/.claude/settings.json
[Nest] PromptModule dependencies initialized                          ← 新模块
[Nest] LlmModule dependencies initialized
[Nest] GameModule dependencies initialized
[Nest] RoutesResolver GameController {/api/game}:
  Mapped {/api/game, POST} route
  Mapped {/api/game/:id/action, POST} route
  Mapped {/api/game/:id/action/stream, POST} route                   ← 新 SSE 路由 ✅
[Nest] WorldConfigService: Loaded world "aethelgard" (4 regions, 2 npcs)
Talking Legend backend running on http://localhost:3001
```

### 5. API 验证

**创建游戏:**
```bash
$ curl -X POST http://localhost:3001/api/game \
  -H "Content-Type: application/json" \
  -d '{"playerName":"TestHero","scenario":"aethelgard"}'
{"success":true,"data":{"gameId":"d0e22a3f-...","initialState":{...}}}
```

**SSE 流式端点（真实 LLM 叙事）:**
```bash
$ curl -N -X POST http://localhost:3001/api/game/{id}/action/stream \
  -H "Content-Type: application/json" \
  -d '{"action":"explore the forest","target":"ancient tree"}'

data: {"type":"chunk","content":"*"}       ← 字符级流式输出
data: {"type":"chunk","content":"你"}
data: {"type":"chunk","content":"踏"}
data: {"type":"chunk","content":"出"}
data: {"type":"chunk","content":"村庄"}
...
data: {"type":"chunk","content":"晨光穿过稀疏的树冠..."}  ← 中文奇幻叙事
data: {"type":"chunk","content":"枝干上缀"}
...
```

**无效请求:**
```bash
$ curl -X POST http://localhost:3001/api/game/{id}/action/stream \
  -H "Content-Type: application/json" -d '{}'
{"success":false,"error":"Bad Request Exception"}  ← 结构化错误 ✅
```

**JSON 端点不变:**
```bash
$ curl -X POST http://localhost:3001/api/game/{id}/action \
  -H "Content-Type: application/json" \
  -d '{"gameId":"...","action":"look"}'
{"success":true,"data":{"narrative":"You look. The world shifts..."}}  ← 占位叙事保留 ✅
```

## RFC 完工铁律检查清单

| # | 检查项 | 结果 |
|---|--------|------|
| 1 | `npm run dev` 成功启动，路由映射全部打印 | ✅ 7 条路由（含新 SSE 路由） |
| 2 | `curl` 调用核心 API 返回有效响应（200/201） | ✅ 创建游戏 + SSE 流式 + 健康检查 |
| 3 | 非法请求返回结构化错误 | ✅ 空 body → `"error":"Bad Request Exception"` |
| 4 | execution.md 粘贴启动日志 + API 响应作为证据 | ✅（本节） |

## 架构决策（实现中做出的）

| # | 决策 | 说明 |
|---|------|------|
| 1 | forwardRef 打破循环 | `GMEngine`(llm/) 依赖 `ContextProvider`(game/)，`GameService`(game/) 依赖 `GMEngine`(llm/)。双方 `@Module()` 使用 `forwardRef(() => ...)` |
| 2 | GMEngine 注入 ContextProvider 而非 BaseContextBuilder | NestJS DI 无法解析抽象类；改为注入具体服务 |
| 3 | PromptModule templatesDir 指向源码 | SWC 不复制 .md，用 `process.cwd()/src/prompts/templates/` |
