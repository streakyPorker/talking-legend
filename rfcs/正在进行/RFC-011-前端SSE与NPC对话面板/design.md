# RFC-011 Design: NPC 对话面板

> **状态**: 正在进行
> **创建**: 2026-07-31
> **grill**: 2026-07-31

## 决策总表

| # | 维度 | 决策 |
|---|------|------|
| 1 | 入口 | NearbyNpcs 点击 → 右侧抽屉滑入 (380px) |
| 2 | UI | 聊天气泡: NPC `chat-start` / 玩家 `chat-end` |
| 3 | NPC↔GM | 独立流 + haiku 异步摘要注入 GM context |
| 4 | 流式 | SSE 逐字 + XML `<dialogue>` 标签渲染 |
| 5 | Prompt | 模板驱动，从 DB 属性自动组装（兼容动态 NPC） |
| 6 | 持久化 | DB 为主，worlds JSON 只是种子 |
| 7 | 记忆 | DB 持久化 + importance 分级 |
| 8 | 工具 | 本期搭框架 NpcEngine.generateWithTools()，无工具实例 |
| 9 | 情绪 | LLM `[mood:xxx]` 标记驱动（NpcEngine 已有） |
| 10 | 模型 | 对话: sonnet / 摘要: haiku |
| 11 | 并发 | 前端交互互斥；后端锁保留；未来 GM 异步演化子 agent |
| 12 | 事件感知 | 结构化事件 feed: 硬编码+LLM提取，区域范围，永久+重要性过滤 |
| 13 | 上下文 | 世界状态 + 事件feed + 玩家状态 + 同区域 NPC |
| 14 | 动态NPC | 属性同构，统一走 DB → 模板 → prompt |

---

## 1. 入口与布局

- 侧栏 NearbyNpcs 点击 NPC → 右侧抽屉滑入
- 抽屉固定 380px，`z-40`，不随侧栏拖拽改变
- 单抽屉模式：点击新 NPC 先关闭当前

## 2. 对话 UI

- NPC 消息: `chat-start`, `bg-neutral text-neutral-content` + 角色名标签
- 玩家消息: `chat-end`, `bg-primary text-primary-content`
- NPC 回复用 `TagRenderer` 渲染 XML 标签
- GM 叙事面板完全独立，不显示 NPC 对话内容

## 3. NPC ↔ GM 联动

```
玩家输入 → NPC SSE 流式回复 → done
  └→ 前端调 POST /api/game/:id/npc/:npcId/summary
      └→ haiku 生成一句话摘要
          └→ 写入 narrative_history → 下次 GM 生成时感知
```

- 例: "村长告知了玩家关于龙脊峰有龙的警告"
- fire-and-forget: 摘要生成失败不影响对话体验

## 4. 流式输出

- 复用 `POST /api/game/:gameId/npc/:npcId/talk/stream`（已实现）
- 前端 SSE: `chunk` → 追加当前气泡末尾, `done` → 完成
- 生成期间: 输入框禁用, "..." 加载态

## 5. Prompt 系统

模板 `templates/npc/dialogue/system.md`:
```
你是{{npcName}}，{{npcRole}}。
性格：{{npcPersonality}}
当前位置：{{npcLocation}}
当前心情：{{npcMood}}
同区域其他人：{{nearbyNpcs}}

## 世界状态
时间：{{timeOfDay}} · 天气：{{weather}}
{{regionDescription}}

## 最近本地事件
{{activeEvents}}

## 最近发生的事
{{narrativeHistory}}

## 玩家信息
姓名：{{playerName}}，携带：{{inventory}}

## 你对玩家的记忆
{{npcMemories}}

用符合你身份和性格的方式与玩家对话。使用 <dialogue speaker="你的名字">台词</dialogue> 标签。
```

- 属性来源: 统一从 `npcs` DB 表读取
- 静态 NPC: worlds JSON → seed npcs 表
- 动态 NPC: INSERT npcs 表，字段同构
- 前端/后端只读 DB，不关心来源

## 6. 持久化策略

```
创建游戏:  worlds JSON → seed npcs 表
运行时:    所有 NPC 从 npcs 表读写
动态生成:  INSERT npcs 表（字段与静态一致）
重启恢复:  npcs 表 → 恢复所有 NPC
```

静态/动态 NPC 对前端完全透明。

## 7. 记忆持久化

- `npc_memories` 表扩展:
  - `importance` INTEGER (1-5)
  - `type` TEXT (`dialogue`/`event`/`summary`)
- 对话完成 → 写入 (玩家消息 + NPC 回复摘要)
- 抽屉打开 → 加载最近 N 条记忆
- 前端: 头部可展开记忆列表，按 importance 排序
- 注入: NpcContextBuilder 的 npc_memory 模块按 importance 排序

## 8. Tool Use 框架

- 本期: `NpcEngine.generateWithTools()` — 搭框架，注册空工具列表
- 架构复刻 `GMEngine.generateWithTools()`: tool_use 循环 + messages 注入
- 工具注册: NpcModule 中 `ToolRegistry` 注入（与 GM 共用或独立 Registry）
- 预留工具: `npcGiveItem`, `npcChangeMood`, `npcTriggerQuest`
- 未来 RFC 实现具体工具

## 9. 情绪系统

- NpcEngine 已有 `updateMood()`: 解析 LLM 回复中的 `[mood: xxx]` 标记
- 更新 `npcs.current_mood` 字段
- 前端抽屉头部实时显示（😊😐😠😢😨）
- 不需要额外开发

## 10. 模型策略

| 调用 | 模型 | 原因 |
|------|------|------|
| NPC 对话 | sonnet | 质量优先 |
| NPC→GM 摘要 | haiku | 便宜，一句话摘要 |

## 11. NPC 事件感知

**决策**: 结构化事件 feed — 混合产生 + 区域范围 + 永久存储 + 重要性过滤

**事件产生**（混合模式）:
- 硬编码: 关键操作自动产生事件
  - `moveToRegion` → `{ type: "arrival", location, actor: "player", summary: "玩家到达X" }`
  - NPC 对话完成 → `{ type: "dialogue", location, actors: [npc, player], summary: "..." }`
- LLM 提取: GM 叙事完成后 → haiku 从 narrative 提取结构化事件
  - 例: "暴风雨袭击了石辉村" → `{ type: "weather", location: "village", summary: "暴风雨袭击石辉村" }`

**事件结构**: `game_events (id, game_id, type, location, actors, summary, importance, turn, created_at)`

**NPC 访问**: 只看到当前区域事件, WHERE location=npc.location ORDER BY importance DESC, turn DESC LIMIT N

**NpcContextBuilder**: 新增 `active_events` 模块注入过滤后的事件摘要

## 12. 并发控制

- 前端: 输入框和 NPC 抽屉交互互斥（自然隔离）
- 后端: `locks Map`（已有）防同一 NPC 并发对话
- GM activeGenerations 锁保留（已有）
- 未来: GM 异步拉起演化子 agent，不阻塞玩家

## 13. NPC 上下文范围（完整）

NpcContextBuilder 注入:
- `world_state` (强制): 天气/时间/区域描述 + 同区域 NPC 列表
- **`active_events`** (非强制): 当前区域结构化事件 feed
- `narrative_history` (非强制): GM 叙事历史（作为事件补充）
- `player_state` (非强制): 玩家名/物品/任务
- `npc_persona` (强制): 角色/性格/心情
- `npc_memory` (非强制): 按 importance 排序

NPC 只知道当前区域发生的事，不知道远方情况。

---

## 抽屉内容

```
┌─────────────────────────────────┐
│ 🧑 村长   😊               [✕] │  ← 状态头
│ 村庄领袖 · 和蔼但谨慎             │
│ 📝 记忆: "警告过玩家龙脊峰危险"    │  ← 可展开
├─────────────────────────────────┤
│  ┌──────────────────────┐       │
│  │ 村长                   │       │  ← NPC 气泡
│  │ 欢迎来到石辉村...       │       │     TagRenderer 渲染
│  └──────────────────────┘       │
│       ┌──────────────────┐      │
│       │ 我想打听龙脊峰    │      │  ← 玩家气泡
│       └──────────────────┘      │
│  ┌──────────────────────┐       │
│  │ 村长                   │       │
│  │ 龙脊峰... ██░░░       │       │  ← 流式输出中
│  └──────────────────────┘       │
├─────────────────────────────────┤
│ [  输入你想说的话...    ] [发送] │  ← 输入栏
└─────────────────────────────────┘
```

## 涉及文件

### 前端

| 文件 | 变更 |
|------|------|
| `components/game/NpcDialogueDrawer.tsx` | **新建**: 抽屉容器+气泡+输入栏+记忆展开 |
| `services/api.ts` | 新增 `talkToNpcStream()` `getNpcMemories()` `submitNpcSummary()` |
| `hooks/useNpcDialogue.ts` | **新建**: SSE 流式 hook |
| `components/game/NearbyNpcs.tsx` | NPC 项加 `onClick` |
| `components/game/GameScreen.tsx` | 集成 NpcDialogueDrawer |

### 后端

| 文件 | 变更 |
|------|------|
| `prompts/templates/npc/dialogue/system.md` | **新建**: NPC prompt 模板 |
| `llm/npc-engine.ts` | 新增 `generateWithTools()` 框架 |
| `db/migrate.ts` | v3: `npc_memories` 加 `importance`, `type` |
| `db/repositories/npc.repository.ts` | 新增 `getMemories(npcId, limit)` |
| `npc/npc.service.ts` | Map→DB 读写记忆; lock 复用 |
| `npc/npc.controller.ts` | 新增 `POST :npcId/summary` + `GET :npcId/memories` |
| `context/modules/npc-memory.module.ts` | 按 importance 排序渲染 |
| `context-provider.ts` | buildNpcContext 加 nearbyNpcs + active_events |
| `context/modules/active-events.module.ts` | 扩展: 按 location 过滤事件 |
| `db/migrate.ts` | v4: 新建 `game_events` 表 |
| `world-config/world-config.schema.ts` | NpcConfig 可选 `promptHint` |

## 边界情况

- NPC 不在同区域: NearbyNpcs 只列同区域 NPC，点击无问题
- SSE 断流: error toast，保留已接收气泡
- LLM 不可用: fallback → "XXX沉默了..."
- 快速切换 NPC: 关闭当前抽屉，打开新 NPC
- 抽屉+侧栏拖拽: 抽屉 380px 固定不跟随
- 首次对话: 无记忆 → "初次见面"
- 摘要失败: fire-and-forget，静默忽略
