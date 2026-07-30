# RFC-016: 地域移动系统 — 设计文档

> **状态**: 设计完成（八轮 grill-me 31/31 决策闭合）
> **优先级**: P1
> **创建**: 2026-07-30

---

## 1. Grill-me 决策表（两轮共 8 项）

| 轮次 | Q# | 决策点 | 结论 |
|------|-----|--------|------|
| R1 | Q1 | Tool call 实现 | **Anthropic 原生 tool_use API** |
| R1 | Q2 | Service 分层 | **WorldService(数据) + GMEngine(通用分发)** |
| R1 | Q3 | 前端展示 | **SSE 插入 tool_call 事件 + 前端 toast** |
| R1 | Q4 | 点击移动 UX | **即时反馈 + 系统消息** |
| R1 | Q5 | Tool 架构 | **通用 ToolRegistry**，本次只实现 moveTo |
| R2 | Q1 | API 兼容性 | **已确认：DeepSeek 原生支持 tool_use**（stop_reason: tool_use, content: thinking+tool_use） |
| R2 | Q2 | Tool call 循环 | **实时 SSE 推送每轮 tool call** |
| R2 | Q3 | SSE 格式 | **四种事件：chunk / tool_call / tool_result / done** |
| R3 | Q1 | 状态更新 | **返回完整 GameState + store 整体替换** — 区域/NPC/连接区域原子更新 |
| R3 | Q2 | tool_result 分层 | **双层：LLM 只收简短文本，SSE 发给前端完整 gameState** |
| R3 | Q3 | NPC 联动 | **靠 context provider** — 不显式注入 NPC 列表到 tool_result |
| R3 | Q4 | 共享方法 | **单一 GameService.moveToRegion()** — 点击和 tool_use 共用 |
| R4 | Q1 | 错误处理 | **直接报错** — failed tool_result，LLM 看到失败，前端 toast error |
| R4 | Q2 | Prompt 改造 | **纯 API tools 参数** — 不改 system prompt 模板 |
| R4 | Q3 | Toast 管理 | **useGameAction 管理 toolToast → GameScreen 渲染** |
| R4 | Q4 | 点击叙事 | **模板叙事 + 环境描述** — 不调 LLM |
| R5 | Q1 | 可移动区域上下文 | **WorldStateModule 新增 connectedRegions** — prompt 渲染"可前往:…" |
| R5 | Q2 | NPC 上下文联动 | **区分标记但不筛选** — "当前位置NPC" vs "其他区域NPC" |
| R5 | Q3 | NPC 工具权限 | **NPC 不给 tool，但 ToolRegistry 预留接口** — 后续版本 NPC 可移动 |
| R5 | Q4 | Tool 注册注入 | **NestJS DI — LlmModule 统一注册** — GMEngine 注入 ToolRegistry |
| R6 | Q1 | 移动历史存储 | **新增 TravelHistoryModule** — 注入 agent 上下文 |
| R6 | Q2 | 移动历史数据源 | **新建 travel_log 表 + migration** — 结构化存储 {from, to, turn} |
| R7 | Q1 | 并发防护 | **DB 串行 + 前端 isLoading 禁用** |
| R7 | Q2 | travel_log schema | **7 字段** — id, game_id, from/to_region, turn, trigger, created_at |
| R7 | Q3 | Tool loop 上限 | **无限轮** — LLM 自己决定何时停止（end_turn） |
| R7 | Q4 | Turn 管理 | **move 内部增 turn，done 返回最终值** |
| R7 | Q5 | 实现边界 | **moveTo 完整实现 + talkTo/observe 预留空壳** |
| R8 | Q1 | Tool schema | **target: string** — 不枚举值，靠 WorldStateModule 上下文提供候选 |
| R8 | Q2 | 历史渲染 | **简洁列表 + 最近 5 条** — "石辉村→低语森林(第3回合,点击)" |
| R8 | Q3 | 循环安全 | **自然停止 + 连续失败 ≤3 次** — 超限强制 end_turn |
| R8 | Q4 | 叙事分流 | **统一走 generateWithTools()** — 所有 action/stream 都传 tools |

### 1.2 R6 移动历史上下文

```
travel_log 表:
  id, game_id, from_region, to_region, turn, trigger('click'|'dialogue'), created_at

TravelHistoryModule (非强制):
  gather() → 读取最近 N 条移动记录
  render() → "移动记录: 石辉村→低语森林(第3回合), 低语森林→镜湖(第5回合)"

ContextProvider GM 上下文新增:
  modules: [..., { name: 'travel_history', mandatory: false }]
```

### 1.1 R3 联动机制

```
moveToRegion() 执行:
  1. 校验连通性
  2. 写DB: world.currentRegion = target, game.turn++
  3. 重新读取完整 GameState（world.regions + npcs + player 全部刷新）
  4. 返回 { gameState, message, turn }

点击移动:  Controller → moveToRegion() → { gameState } → 前端 setGameState()
对话移动:  tool_use → moveToRegion() → LLM收message + SSE发{gameState}

前端联动:
  setGameState(gameState) 整体替换
  → ConnectedRegions 自动显示新区域的可前往区域
  → NearbyNpcs 自动显示新区域的NPC
  → RegionInfo 自动显示新区域描述
  → GameStatusBar 自动更新区域名
```

---

## 2. 架构总览

### 2.1 双通道流程

```
点击"低语森林"                      输入"去森林看看"
      │                                    │
      ▼                                    ▼
POST /api/game/:id/move          POST /api/game/:id/action/stream
      │                                    │
      ▼                                    ▼
GameController.move()             GameService.performActionStream()
  → GameService.moveToRegion()      → GMEngine.generateWithTools()
       │                                  │
       ▼                                  ▼
  WorldService.updateLocation()    LLMClient.stream({ tools: [...] })
  (校验连通性 → 写DB → turn++)          │
       │                           LLM returns tool_use(moveTo)
       ▼                                  │
  返回 { narrative, turn }          ToolRegistry.execute("moveTo")
       │                             → GameService.moveToRegion()
       ▼                                  │
  前端: toast + store更新           tool_result 注入 prompt
                                         │
                                    LLM 继续叙事
                                         │
                                    SSE: tool_call → tool_result → chunk... → done
```

### 2.2 SSE 流格式（R2-Q3）

```
data: {"type":"chunk","content":"让我想想…"}
data: {"type":"tool_call","name":"moveTo","args":{"target":"forest"}}
data: {"type":"tool_result","success":true,"message":"已到达低语森林"}
data: {"type":"chunk","content":"你沿着长满青苔的石板路…"}
data: {"type":"done","turn":1}
```

前端处理：`tool_call` → toast "正在前往低语森林…" → `tool_result` → updateStore + toast 消失 → `chunk` → 正常叙事

---

## 3. Backend 设计

### 3.1 LLMClient 扩展 — 支持 tools

```typescript
// LLMCallOptions 新增
interface LLMCallOptions {
  // ...existing
  tools?: AnthropicTool[];  // { name, description, input_schema }[]
}

// StreamChunk 新增
type StreamChunk =
  | { type: 'chunk'; content: string }
  | { type: 'tool_use'; name: string; id: string; input: Record<string, unknown> }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'stream_end' };
```

### 3.2 ToolRegistry

```typescript
// backend/src/llm/tool-registry.ts
@Injectable()
class ToolRegistry {
  private tools = new Map<string, GameTool>();

  register(tool: GameTool): void;
  getToolsForLLM(): AnthropicTool[];
  execute(name: string, gameId: string, args: Record<string, unknown>): Promise<ToolResult>;
}
```

### 3.3 GameTool 接口

```typescript
interface GameTool {
  name: string;
  description: string;
  input_schema: object;
  execute: (gameId: string, args: Record<string, unknown>) => Promise<ToolResult>;
}

interface ToolResult {
  success: boolean;
  message: string;          // 简短文本，tool_result SSE 传给前端 + 注入 prompt
  stateChanges?: Record<string, unknown>;  // { newRegion, turn, ... }
}
```

### 3.4 GMEngine.generateWithTools()

```
generateWithTools(gameId, action, target, turn):
  1. contextProvider.buildGMContext()
  2. templateEngine.render() userPrompt
  3. 构建 messages = [{ role:'user', content: userPrompt }]
  4. loop (max 3 rounds):
     a. llmClient.stream({ messages, tools, systemPrompt })
     b. for each event:
        - chunk → yield { type:'chunk', content }
        - tool_use(id, name, input) → yield { type:'tool_call', name, args }
           → result = toolRegistry.execute(name, gameId, input)
           → yield { type:'tool_result', ...result }
           → push tool_use + tool_result to messages
        - stream_end → break loop if no tool_use
     c. if no tool_use in this round: break
  5. yield { type:'done', turn }
```

### 3.5 点击移动端点

```typescript
// POST /api/game/:id/move
// Body (zod): { targetRegion: z.string() }
// Response: MoveResult { narrative: string, newRegion: string, turn: number }

// GameService
async moveToRegion(gameId: string, targetRegion: string): Promise<MoveResult> {
  // 1. 读取当前 world state
  // 2. 校验 targetRegion 在 currentRegion.connectedRegions 中
  // 3. worldRepository.update() currentRegion
  // 4. gameRepository.updateTurn()
  // 5. 生成简单移动叙事 "你离开石辉村，前往低语森林…"
  // 6. 返回 MoveResult
}
```

---

## 4. Frontend 设计

### 4.1 ConnectedRegions — 可点击移动

```tsx
// 每个区域项改为按钮
<li key={r.id}>
  <button
    onClick={() => handleMove(r.id)}
    className="btn btn-ghost btn-xs"
    disabled={isMoving}
  >
    {regionCN(r.id)}
  </button>
</li>
```

### 4.2 useGameAction — 处理 tool_call 事件

```typescript
// SSE 解析新增事件类型
if (data.type === 'tool_call') {
  // Toast: "正在前往{regionCN(args.target)}…"
  addToast(`正在前往${regionCN(data.args.target)}…`, 'info');
} else if (data.type === 'tool_result') {
  if (data.success) {
    // 更新 store
    updateRegion(data.stateChanges.newRegion);
    updateTurn(data.stateChanges.turn);
  }
  dismissToast();
  // 叙事区追加系统消息
  appendToolResult(data.message);
} else if (data.type === 'chunk') { ... }
else if (data.type === 'done') { ... }
```

### 4.3 gameStore — 新增

```typescript
addToolResult: (message: string) => void;  // 叙事区追加工具结果
```

---

## 5. 文件变更清单

### Wave 1: Backend 基础（3 文件）
| 文件 | 操作 |
|------|------|
| `backend/src/llm/tool.interface.ts` | **新建** |
| `backend/src/llm/tool-registry.ts` | **新建** |
| `backend/src/world/world.service.ts` | **修改** +moveToRegion() |

### Wave 2: Backend 集成（4 文件）
| 文件 | 操作 |
|------|------|
| `backend/src/llm/client.ts` | **修改** 支持 tools 参数 + tool_use 事件 |
| `backend/src/llm/gm-engine.ts` | **修改** 新增 generateWithTools() |
| `backend/src/game/game.controller.ts` | **修改** 新增 POST /:id/move |
| `backend/src/game/game.service.ts` | **修改** 新增 moveToRegion() |

### Wave 3: Frontend（5 文件）
| 文件 | 操作 |
|------|------|
| `frontend/src/components/game/ConnectedRegions.tsx` | **改写** 可点击 |
| `frontend/src/hooks/useGameAction.ts` | **修改** 处理 tool_call/result |
| `frontend/src/stores/gameStore.ts` | **修改** addToolResult |
| `frontend/src/services/api.ts` | **修改** 新增 moveToRegion() |
| `shared/src/index.ts` | **修改** 新增类型 |
