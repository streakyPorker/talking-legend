# RFC-004: 上下文管理与 Prompt 设计 — 设计文档

> **状态**: 已完成
> **优先级**: P1
> **创建**: 2026-07-26
> **依赖**: RFC-002（数据库）、RFC-003（世界配置）

## 设计决策汇总

| # | 决策 | 选项 |
|---|------|------|
| D1 | 范围边界 | **纯契约/设计层** — 定义 interface + 模板结构 + 管线骨架，不写 LLM 调用代码 |
| D2 | 上下文组装模型 | **按场景拆分 ContextBuilder**（B）— GM/NPC对话/意图分类/事件触发各一个 Builder |
| D3 | 模块组合方式 | **可插拔 ContextModule** — 状态/记忆/事件等独立模块，Builder 按配置组装 |
| D4 | 模块组合配置 | **硬编码默认值**，后续前端配置页面属新 RFC |
| D5 | Prompt 模板存储 | **混合模式**（C）— `.md` 文件主体 + TS 参数 schema + TemplateEngine |
| D6 | 模板文件组织 | **层级目录** — `path.to.template` dot notation 映射到文件系统 |
| D7 | 叙事历史管理 | **分层存储+摘要**（B）— 近端 N 轮原文 + 远端 Haiku 摘要 |
| D8 | NPC 记忆过滤 | **重要性标记+分层保留**（C）— important 永久/normal 最近 N/trivial 仅计数 |
| D9 | Token 预算溢出 | **拼装阶段不管，调用层硬截断**（A）— 强制模块不可截，超预算 fail fast |
| D10 | 模块数据接口 | **结构化+默认渲染**（C）— `gather()` 返回结构数据，`render()` 默认格式化 |
| D11 | 模块截断降级 | 每个模块提供 `{full, compact, minimal}` 三种粒度 |

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    GameService.performAction()               │
│  读 DB → 调 LLM → 写 DB（两阶段事务，RFC-005 实现）          │
└──────┬──────────────────┬──────────────────┬────────────────┘
       │                  │                  │
       ▼                  ▼                  ▼
  GMContextBuilder   NpcContextBuilder  IntentContextBuilder
  (Opus, 全量)       (Sonnet, NPC视角)  (Haiku, 极简)
       │                  │                  │
       └──────┬───────────┴──────────┬────────┘
              │                      │
              ▼                      ▼
       ContextModule[]         PromptTemplate
       (可插拔模块)            (.md + TS schema)
              │
    ┌─────┬───┴───┬─────┬──────┬──────┐
    ▼     ▼       ▼     ▼      ▼      ▼
  World  NPC    Player Story  Events Intent
  State  Memory State  Line   Module Input
  Module Module Module Module        Module
```

## ContextModule 接口契约

```typescript
interface ContextModule {
  readonly name: string;           // 唯一标识，如 'world_state'
  readonly mandatory: boolean;     // 是否强制（不可裁剪）

  // 收集数据（从 DB/文件等来源）
  gather(ctx: GatherContext): Promise<ModuleData>;

  // 默认渲染为 prompt 文本（等价于 granularity.full，保留为便捷入口）
  render(data: ModuleData): string;

  // 粒度降级（非强制模块必须提供；强制模块可省略，始终走 render()）
  granularity: {
    full(data: ModuleData): string;       // 完整详情 = render()
    compact(data: ModuleData): string;     // 精简摘要（约 1/3 长度）
    minimal(data: ModuleData): string;     // 一行关键词
  };

  // 可选：传入自定义模板覆盖默认渲染
  renderWith(data: ModuleData, template: string): string;
}

interface GatherContext {
  gameId: string;
  callType: 'gm_narrative' | 'npc_dialogue' | 'intent_classify' | 'event_trigger';
  params?: Record<string, unknown>;  // 如 { npcId: 'xxx' } 用于 NPC 对话
}

interface ModuleData {
  structured: Record<string, unknown>;  // 结构化数据，模板可用 {{key}} 引用
  tokenEstimate: number;                // 粗略估算（字符数/2）
}
```

### ContextModule 清单

| 模块 | 职责 | 数据来源 |
|------|------|----------|
| `world_state` | 世界状态（时间/天气/当前区域/区域列表等） | `worlds` 表 + WorldConfig |
| `npc_persona` | NPC 人设（名称/性格/情绪/角色） | `npcs` 表 |
| `npc_memory` | NPC 对玩家的记忆（分级过滤后） | `npc_memories` 表 |
| `player_state` | 玩家状态（位置/物品/声望/任务） | `players` 表 + `player_quests` 表 |
| `narrative_history` | 叙事历史（分层：近端原文+远端摘要） | narrative log 文件 |
| `active_events` | 当前活跃事件 | `storylines` 表 |
| `scenario_hint` | GM 叙事指引/幕后提示 | world config 或 GM 配置 |
| `intent_input` | 玩家输入文本 + 可用意图标签列表 | `performAction` 参数 |

## ContextBuilder

### 接口

```typescript
interface ContextBuilder {
  readonly callType: CallType;

  // 主入口：按配置组装模块 → 渲染 → 输出 AssembledContext
  // budget: token 预算上限，来自调用方（如 Opus 200K, Sonnet 200K, Haiku 8K）
  build(gameId: string, budget: number, params?: Record<string, unknown>): Promise<AssembledContext>;
}

type CallType = 'gm_narrative' | 'npc_dialogue' | 'intent_classify' | 'event_trigger';
```

### 装配流程

```
Builder.build(gameId, callType, params?)

  1. 读取模块配置（当前：硬编码默认值）
     ↓
  2. 并行调各模块 gather(ctx)
     ↓
  3. 强制模块 → 全量 render()
     非强制模块 → 按优先级尝试 full → compact → minimal
     所有非强制模块降到 minimal 仍溢出 → fail fast
     ↓
  4. 拼接 system prompt sections
     ↓
  5. TemplateEngine.render("path.to.template", params)
     校验 required 占位符完整性
     ↓
  6. 输出 AssembledContext { systemPrompt, userPrompt, tokenEstimate }
```

### AssembledContext

```typescript
interface AssembledContext {
  systemPrompt: string;   // 拼装后的完整 system prompt
  userPrompt: string;     // 拼装后的 user prompt
  tokenEstimate: number;  // 粗略 token 估算（仅日志/监控用）
}
```

### 三种 ContextBuilder

| Builder | 调用类型 | 适用模型 | 特点 |
|---------|----------|----------|------|
| `GMContextBuilder` | `gm_narrative` | Opus | 全量世界状态 + 完整叙事历史 + 玩家状态 + 活跃事件 |
| `NpcContextBuilder` | `npc_dialogue` | Sonnet | NPC 人设/记忆 + 同区域状态 + 近期事件（同区域 NPC 视角） |
| `IntentContextBuilder` | `intent_classify` | Haiku | 极简 — 场景名 + 玩家输入 + NPC 名列表 |
| `EventContextBuilder` | `event_trigger` | Haiku | 世界状态 + 活跃事件 + 最近叙事 |

## 默认模块配置（硬编码）

```typescript
const DEFAULT_MODULE_CONFIG: Record<CallType, ModuleConfig> = {
  gm_narrative: {
    modules: [
      { name: 'world_state', mandatory: true },
      { name: 'player_state', mandatory: false },
      { name: 'narrative_history', mandatory: false },
      { name: 'active_events', mandatory: false },
      { name: 'scenario_hint', mandatory: false },
    ],
  },
  npc_dialogue: {
    modules: [
      { name: 'world_state', mandatory: true },
      { name: 'npc_persona', mandatory: true },
      { name: 'npc_memory', mandatory: false },
      { name: 'player_state', mandatory: false },
      { name: 'narrative_history', mandatory: false },
      { name: 'active_events', mandatory: false },
    ],
  },
  intent_classify: {
    modules: [
      { name: 'world_state', mandatory: true },
      { name: 'intent_input', mandatory: true },
    ],
  },
  event_trigger: {
    modules: [
      { name: 'world_state', mandatory: true },
      { name: 'active_events', mandatory: false },
    ],
  },
};
```

**设计约束**：
- 强制模块不可裁剪、不可降级粒度、始终全量带入
- 强制模块之和已超 token 预算 → fail fast（不静默降级）
- 后续可通过前端配置页面动态调整（新 RFC，编号待定）

## Prompt 模板系统

### 文件布局

```
backend/src/prompts/
  templates/
    gm/
      narrative/
        system.md          # GM 叙事 system prompt
        user.md            # GM 叙事 user prompt
    npc/
      dialogue/
        system.md          # NPC 对话 system prompt
        user.md            # NPC 对话 user prompt
    intent/
      classify/
        system.md          # 意图分类 system prompt
        user.md            # 意图分类 user prompt
    event/
      trigger/
        system.md          # 事件触发 system prompt
        user.md            # 事件触发 user prompt
  schemas/
    gm/narrative.schema.ts
    npc/dialogue.schema.ts
    intent/classify.schema.ts
    event/trigger.schema.ts
  template-engine.ts
```

### 引用方式

dot notation 映射到文件系统：`"gm.narrative.system"` → `templates/gm/narrative/system.md`

```typescript
const systemPrompt = engine.render("gm.narrative.system", params);
const userPrompt = engine.render("gm.narrative.user", params);
```

### 模板语法

使用 `{{placeholderName}}` 占位符。模板文件只含纯文本 + 占位符，无逻辑。

**示例** (`templates/gm/narrative/system.md`)：
```markdown
## 你是这个奇幻世界的 Game Master。

## 世界设定
{{worldDescription}}

## 当前状态
- 时间：{{timeOfDay}} · 天气：{{weather}}
- 当前位置：{{currentRegion}}
- 活跃事件：{{activeEvents}}

## 叙事历史
{{narrativeHistory}}

## 玩家
- 姓名：{{playerName}}
- 携带物品：{{inventory}}
```

### TS 参数 Schema

每个模板文件对应一个 schema，定义参数来源和是否必需：

```typescript
// schemas/gm/narrative.schema.ts
export const GM_NARRATIVE_PARAMS = {
  worldDescription:  { type: 'string', required: true,  source: 'world_state' },
  timeOfDay:         { type: 'string', required: true,  source: 'world_state' },
  weather:           { type: 'string', required: true,  source: 'world_state' },
  currentRegion:     { type: 'string', required: true,  source: 'world_state' },
  activeEvents:      { type: 'string', required: false, source: 'active_events' },
  narrativeHistory:  { type: 'string', required: false, source: 'narrative_history' },
  playerName:        { type: 'string', required: true,  source: 'player_state' },
  inventory:         { type: 'string', required: false, source: 'player_state' },
} as const;
```

### TemplateEngine 职责

```typescript
interface TemplateEngine {
  // "gm.narrative.system" → templates/gm/narrative/system.md
  load(templatePath: string): Template;

  // 加载 + 参数替换 + 校验
  // - required:true 的占位符缺失 → 抛错
  // - 模板中存在但 params 未提供的占位符 → 抛错（不静默忽略）
  render(templatePath: string, params: Record<string, string>): string;
}
```

## 叙事历史分层管理

### 数据结构

```typescript
interface NarrativeHistory {
  recent: NarrativeEntry[];      // 最近 N 轮原文（默认 5 轮）
  summary: string | null;        // 远端摘要（Haiku 生成）
  totalRounds: number;           // 总叙事轮数
}

interface NarrativeEntry {
  turn: number;
  content: string;
  timestamp: string;
}
```

### 渲染输出示例

```markdown
## 近期事件
- [第3轮] 玩家在村口遇到了长老Marin，Marin告诉他森林里最近有奇怪的声音。
- [第4轮] 玩家进入森林探索，在湖边发现了一面古镜。
- [第5轮] 玩家将古镜带回村子给长老看。

## 往事概要
玩家曾探索村庄、与森林游侠Kael交谈并获得了关于龙脊峰的警告、在湖边发现异常倒影。
```

### 摘要生成时机

每轮 GM 叙事完成后**异步**触发 Haiku 摘要更新（不阻塞当前回合）。失败时复用上一版摘要（降级安全）。

### 存储

继续使用现有 `narrative-log.ts` 的纯文本文件存储，不额外引入 DB 表。每轮叙事追加一行。摘要独立性高，单独存文件（`narrative-summary.txt`）。

## NPC 记忆分级过滤

### 分级模型

```
important  → 永久保留原文，所有对话都带入（不截断）
normal     → 保留最近 N 条（默认 10 条），按 turn 倒序取
trivial    → 不存原文到 context，仅显示计数摘要如 "还有 12 段日常对话"
```

### 数据模型（扩展现有 `npc_memories` 表）

```typescript
interface NpcMemory {
  id: number;
  npcId: string;
  content: string;
  turn: number;
  tier: 'important' | 'normal' | 'trivial';  // 新增字段
  createdAt: string;
}
```

**迁移**：为 `npc_memories` 表新增 `tier` 列（TEXT，默认 `'normal'`）。

### 写入时分级

新记忆写入时由 Haiku 判断重要性：

```
输入：NPC 当前已有记忆摘要 + 新事件描述
输出：{ tier: "important" | "normal" | "trivial", content: "精简后的记忆文本" }
```

- 判断为 `trivial` 的事件存原始记录（可审计），但 context 拼装时不带原文
- 分级判断失败 → 默认 `normal`（降级安全）

### NpcMemoryModule 的 gather() 逻辑

```typescript
async gather(ctx: GatherContext): Promise<ModuleData> {
  const npcId = ctx.params?.npcId as string;

  // 1. 所有 important 记忆（全量，不限数量）
  const important = await memoryRepo.findByNpcAndTier(npcId, 'important');

  // 2. 最近 N 条 normal 记忆
  const normal = await memoryRepo.findByNpcAndTier(npcId, 'normal', { limit: 10 });

  // 3. trivial 计数
  const trivialCount = await memoryRepo.countByNpcAndTier(npcId, 'trivial');

  return {
    structured: { important, normal, trivialCount },
    tokenEstimate: estimateTokens(important, normal),
  };
}
```

`render()` 输出格式：
```markdown
## NPC 记忆
- [重要] 玩家曾救过 NPC 的命（第2轮）
- [重要] 玩家背叛了 NPC 的信任（第8轮）
- [普通] 玩家问过关于森林的路（第10轮）
- [普通] 玩家分享了一块面包（第11轮）
- 还有 12 段日常对话未列出
```

## Token 预算与截断

### 策略

- **拼装阶段不截断**：ContextBuilder 正常拼装所有模块的 full 粒度
- **溢出时逐模块降级**：从最后一个非强制模块开始，依次降级 `full → compact → minimal`，直到不溢出或全部降完
- **所有非强制模块都 minimal 仍溢出 → fail fast**：抛出 `ContextBudgetExceededError`
- **强制模块不可降级**：始终 full 粒度完整带入

### 截断发生在调用层

调用层（RFC-005/006/007 实现）收到 `AssembledContext` 后，如果 token 估算仍接近模型上限，调用层做最后硬截断。004 不做截断。

```typescript
class ContextBudgetExceededError extends Error {
  constructor(
    public readonly totalEstimate: number,
    public readonly budget: number,
  ) {
    super(`Context budget exceeded: ${totalEstimate} > ${budget}`);
  }
}
```

## 遗留事项

| # | 内容 | 处置 |
|---|------|------|
| L1 | 非强制模块 minimal 后仍超预算 → fail fast | 已记录，后续根据实际场景决定降级/截断/分组策略 |
| L2 | 前端模块配置页面（动态调整各调用类型的模块组合） | 新 RFC，待前端搭建后择机提出 |
| L3 | LLM 自主决策模块组合（替换硬编码默认值） | 未来迭代，当前硬编码即可 |
| L4 | 精确 token 计数 | 当前用字符数/2 估算，后续可接入 tiktoken |

## 模块粒度定义

每个非强制模块提供三种渲染粒度：

```typescript
interface ContextModule {
  // ...
  granularity: {
    full: (data: ModuleData) => string;     // 完整详情（默认）
    compact: (data: ModuleData) => string;   // 精简摘要（约 1/3 长度）
    minimal: (data: ModuleData) => string;   // 一行关键词
  };
}
```

**示例** — `player_state` 模块的三种粒度：

```
full:     "玩家 Alice，当前位置：村庄。背包：[木剑, 药水×3, 古镜]。声望：{village: 10, forest: -2}。任务：寻找失踪的猎人(进行中)、修复古镜(进行中)"

compact:  "玩家 Alice 在村庄，携带木剑/药水/古镜，village声望10。2个进行中任务。"

minimal:  "玩家 Alice · village · 2任务"
```

## 非目标（明确排除）

- ❌ 热更新模板（改 `.md` 模板需重启后端）
- ❌ 前端模块配置页面（新 RFC）
- ❌ LLM 自主决策模块组合（未来迭代）
- ❌ 精确 token 计数（用字符数/2 估算）
- ❌ 实际 LLM 调用代码（属 RFC-005/006/007）
- ❌ 运行时修改世界配置（世界配置属 RFC-003）
- ❌ 模块配置持久化 / API（新 RFC）

## 测试策略

004 产出是纯逻辑模块，可独立测试，不依赖 LLM 调用：

| 层级 | 内容 |
|------|------|
| 函数级 | TemplateEngine：占位符替换、缺失 required 参数报错、未知占位符报错、嵌套模板路径解析 |
| 函数级 | 每个 ContextModule 的 `gather()` mock + `render()` 输出格式验证 |
| 函数级 | `granularity.full/compact/minimal` 三种粒度输出差异 |
| 模块级 | ContextBuilder：按配置组装模块、trim 策略、非强制降级顺序、fail fast 边界 |
| 模块级 | NpcMemoryModule：分级逻辑、important/normal/trivial 过滤规则 |
| 模块级 | NarrativeHistoryModule：近端 N 轮截取、摘要拼接 |

## 文件清单（预期产出）

```
backend/src/context/
  context-builder.ts              # BaseContextBuilder + GM/Npc/Intent/Event
  context-module.interface.ts     # ContextModule 接口 + ModuleData
  module-config.ts                # 默认模块配置（硬编码）
  modules/
    world-state.module.ts
    npc-persona.module.ts
    npc-memory.module.ts
    player-state.module.ts
    narrative-history.module.ts
    active-events.module.ts
    scenario-hint.module.ts
    intent-input.module.ts
  memory-filter.ts                # NPC 记忆分级过滤
  narrative-history.ts            # 叙事历史管理（近端+摘要）
  context-budget.error.ts         # ContextBudgetExceededError

backend/src/prompts/
  template-engine.ts              # 模板加载 + 参数替换 + 校验
  templates/                      # .md 模板文件（层级目录）
    gm/narrative/{system,user}.md
    npc/dialogue/{system,user}.md
    intent/classify/{system,user}.md
    event/trigger/{system,user}.md
  schemas/                        # TS 参数 schema
    gm/narrative.schema.ts
    npc/dialogue.schema.ts
    intent/classify.schema.ts
    event/trigger.schema.ts
```
