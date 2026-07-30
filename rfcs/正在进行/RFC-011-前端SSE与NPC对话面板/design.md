# RFC-011 Design: NPC 对话面板

> **状态**: 已提议 → 设计阶段
> **创建**: 2026-07-31

## 决策记录

### 1. 入口与布局

**决策**: 侧栏 NearbyNpcs 点击 → 右侧抽屉滑入

- 抽屉覆盖侧栏区域（右侧栏本身可拖动宽度，抽屉固定 380px）
- 不遮挡叙事面板，不影响 GM 流
- 右上角关闭按钮
- `z-40`，高于侧栏 `z-0`

### 2. 对话 UI

**决策**: 聊天气泡 + 角色名 + 流式输出

- NPC 消息: `chat-start`, `bg-neutral text-neutral-content`
- 玩家消息: `chat-end`, `bg-primary text-primary-content`
- 每条消息显示角色名小标签
- GM 叙事和 NPC 对话视觉区分：GM 用 `NarrativePanel`（TagRenderer），NPC 用独立抽屉的气泡风格

### 3. 流式输出

**决策**: 逐字流式 SSE

- 复用 `POST /api/game/:gameId/npc/:npcId/talk/stream`（后端已实现）
- 前端 SSE 解析：`chunk` → 追加到当前 NPC 气泡末尾，`done` → 完成
- 生成期间输入框禁用，显示 "..." 加载态

### 4. 对话历史与 NPC 记忆

**决策**: 两阶段

**Phase A（本期）**: 会话级历史
- 抽屉打开期间保留对话历史（前端 state）
- 关闭抽屉清空，下次重开全新对话
- 后端 `NpcService` 已有 in-memory Map 存储对话上下文

**Phase B（后续 RFC）**: 持久化
- 对话记录写入 `npc_memories` 表
- 下次对话自动加载历史
- NPC 形成持久记忆
- 需要：后端 `NpcService` 改 Map → DB 读写

### 5. XML 标签

**决策**: NPC 回复也走 XML 标签

- Prompt 要求 NPC 输出 `<dialogue speaker="name">台词</dialogue>`
- 抽屉内 NPC 气泡用 `TagRenderer` 渲染（与叙事面板一致）
- 如果 NPC 引用事件：`<event>` 标签
- 如果 NPC 提供信息：`<system>` 标签

### 6. 抽屉内容结构

```
┌─────────────────────────────────┐
│ 🧑 村长 (村长)  😊        [✕]  │  ← NPC 状态头 (bg-base-200)
│ 角色: 村庄领袖                    │
├─────────────────────────────────┤
│                                 │
│  ┌──────────────────────┐       │
│  │ 村长                   │       │  ← NPC 气泡 (chat-start)
│  │ 欢迎来到石辉村...       │       │
│  └──────────────────────┘       │
│                                 │
│       ┌──────────────────┐      │
│       │ 我想打听龙脊峰    │      │  ← 玩家气泡 (chat-end)
│       └──────────────────┘      │
│                                 │
│  ┌──────────────────────┐       │
│  │ 村长                   │       │
│  │ 龙脊峰...（流式输出中） │       │  ← 加载中闪烁
│  └──────────────────────┘       │
│                                 │
├─────────────────────────────────┤
│ [  输入你想说的话...    ] [发送] │  ← 输入栏 (bg-base-200)
└─────────────────────────────────┘
```

## 涉及文件

### 前端（本期新建/修改）

| 文件 | 变更 |
|------|------|
| `components/game/NpcDialogueDrawer.tsx` | **新建**: 抽屉容器 + 气泡列表 + 输入栏 |
| `services/api.ts` | 新增 `talkToNpcStream()` |
| `hooks/useNpcDialogue.ts` | **新建**: SSE 流式 hook |
| `components/game/NearbyNpcs.tsx` | NPC 列表项加点击 → openDrawer |
| `components/game/GameScreen.tsx` | 集成 NpcDialogueDrawer |

### 后端（本期不改）

后端 NPC 对话已实现：`NpcController` + `NpcService` + `NpcEngine`（SSE 流式 + context + fallback + 情绪更新）。

### 后续 RFC（Phase B）

| 文件 | 变更 |
|------|------|
| `npc/npc.service.ts` | Map→DB 持久化对话历史 |
| `db/migrate.ts` | `npc_memories` 表扩展（存 NPC 回复+回合号） |
| `NpcDialogueDrawer.tsx` | 打开时加载历史 |

## 交互流程

```
1. 玩家点击 NearbyNpcs 中的 NPC
2. 抽屉从右侧滑入
3. 显示 NPC 状态头（名字/角色/心情）
4. 输入问候 → 发送
5. SSE 流式返回 NPC 回复（逐字气泡）
6. 可继续对话
7. 关闭抽屉 → 清空当前会话
```

## 边界情况

- NPC 不在同区域：点击无反应（NearbyNpcs 只列同区域 NPC）
- SSE 断流：显示错误 toast，保留已接收内容
- LLM 不可用：fallback → NPC 沉默/兜底文案
- 快速点击多个 NPC：关闭当前抽屉，打开新 NPC（单抽屉模式）
- 抽屉打开时调整侧栏宽度：抽屉固定 380px，不受侧栏拖拽影响
