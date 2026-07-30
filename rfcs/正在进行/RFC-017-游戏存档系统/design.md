# RFC-017 Design: 游戏存档系统

> **状态**: 正在进行
> **创建**: 2026-07-31

## 决策总表

| # | 维度 | 决策 |
|---|------|------|
| 1 | 粒度 | 整 DB 文件复制 → `data/saves/slot_N.db` |
| 2 | 槽位 | 固定 5 槽 + slot 0 自动存档 |
| 3 | 自动存档 | 每 5 回合 + 关键操作后 → slot 0 |
| 4 | 元数据 | `saves` 表存 DB 内（slot/player/turn/region/world/time） |
| 5 | UI入口 | GameHeader 右上角 💾 按钮，与 ⚙ 配置并列 |
| 6 | 保存交互 | 两步：点💾→选槽位→确认→toast |
| 7 | 面板样式 | 居中模态弹窗，与配置面板风格一致 |
| 8 | 加载恢复 | 替换DB→跳回首页 `/`→玩家重新进入 |
| 9 | 自动存档 | toast 通知 "⚡已自动存档(第15回合)" |

---

## 架构

```
保存: GameService.save(slot) → UPDATE saves表 → fs.copyFile(主DB → saves/slot_N.db)
读取: GameService.listSaves() → SELECT * FROM saves ORDER BY saved_at DESC
加载: GameService.load(slot) → fs.copyFile(saves/slot_N.db → 主DB) → 前端重载
删除: GameService.delete(slot) → DELETE saves + fs.unlink(saves/slot_N.db)
```

### saves 表

```sql
CREATE TABLE saves (
  slot        INTEGER PRIMARY KEY,
  player_name TEXT NOT NULL,
  turn        INTEGER NOT NULL,
  region      TEXT NOT NULL,
  world       TEXT NOT NULL,
  saved_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- slot 0: 自动存档（不可手动覆盖，不可删除？可讨论）
- slot 1-5: 手动存档

### 保存流程

```
1. 前端调 POST /api/game/:id/save { slot }
2. 后端:
   a. db.transaction: UPDATE saves SET ... WHERE slot=N
   b. fs.copyFileSync('data/talking-legend.db', 'data/saves/slot_N.db')
   c. 写入 narrative-log 文件（如果存在单独文件）
3. 返回 { success, meta: { slot, turn, region, saved_at } }
```

### 加载流程

```
1. 前端显示存档列表 → 玩家选槽位 → 确认
2. 前端调 POST /api/saves/:slot/load
3. 后端:
   a. 关闭当前 DB 连接
   b. fs.copyFileSync('data/saves/slot_N.db', 'data/talking-legend.db')
   c. 重新打开 DB → 路由重新注册
   OR 直接返回成功，让前端调 window.location.reload()
4. 前端重载页面 → 进游戏设置 → 恢复 game state
```

**简化方案**: 加载后前端硬刷新 `window.location.href = '/'`，玩家重新进入游戏。

### 自动存档

触发条件:
- 每 5 回合自动保存到 slot 0
- 关键剧情操作后（未来 RFC）

实现:
- `performActionStream` 的 `done` 事件后，检查 `turn % 5 === 0` → 自动调 `save(0)`
- fire-and-forget，不阻塞玩家

## 前端 UI

### 入口: GameHeader 右上角 💾 按钮

与 ⚙ 配置按钮并列，`btn btn-ghost btn-sm` 相同风格。

### 保存交互（两步）

1. 点击 💾 → 弹出存档管理面板（居中模态弹窗）
2. 选择空槽位 → 点击 [保存到此]
3. 有内容的槽位 → 点击 [覆盖] → 二次确认
4. 保存完成 → toast "✅ 已保存到槽位 N"

### 加载交互

1. 有内容的槽位 → 点击 [读取]
2. 二次确认: "确定加载槽位N？当前进度将丢失"
3. 确认 → 后端替换DB → 前端 `window.location.href = '/'`
4. 玩家从首页重新进入游戏

### 读取加载状态

加载中显示 spinner + "正在恢复存档..."

### 存档管理面板（居中模态弹窗）

```
┌─────────────────────────────────────┐
│ 💾 存档管理                    [✕]  │
├─────────────────────────────────────┤
│                                     │
│ ⚡ 自动存档                         │
│ ┌─────────────────────────────┐    │
│ │ 第15回合 · 石辉村 · 2分钟前  │    │
│ │ 玩家: 张三 · 世界: 艾瑟尔加德 │    │
│ └─────────────────────────────┘    │
│                                     │
│ 💾 手动存档                         │
│ ┌─────────────────────────────┐    │
│ │ 槽位1 · 第12回合 · 低语森林  │ [读取] [删除] │
│ │ 槽位2 · 空                   │ [保存]        │
│ │ 槽位3 · 第8回合 · 镜湖       │ [读取] [删除] │
│ │ 槽位4 · 空                   │ [保存]        │
│ │ 槽位5 · 空                   │ [保存]        │
│ └─────────────────────────────┘    │
│                                     │
└─────────────────────────────────────┘
```

- 空槽位: "空" + [保存到此] 按钮
- 有存档: 元数据展示 + [读取] [覆盖] [删除]
- 读取需二次确认: "确定要加载此存档吗？当前进度将丢失"

### 自动存档通知

- 每 5 回合自动保存到 slot 0
- 右上角 toast: "⚡ 已自动存档（第15回合 · 石辉村）"
- 3 秒自动消失
- 失败时静默（不打断玩家）

## API

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/game/:id/saves` | GET | 列所有存档 |
| `/api/game/:id/save` | POST `{ slot }` | 保存到槽位 |
| `/api/saves/:slot/load` | POST | 加载存档 |
| `/api/saves/:slot` | DELETE | 删除存档 |

## 涉及文件

### 后端

| 文件 | 变更 |
|------|------|
| `db/migrate.ts` | v5: `saves` 表 |
| `db/repositories/save.repository.ts` | **新建**: CRUD |
| `game/game.controller.ts` | 新增 save/list 端点 |
| `game/game.service.ts` | save/load/autoSave 方法 |
| `main.ts` | load 端点（独立于 game 生命周期） |

### 前端

| 文件 | 变更 |
|------|------|
| `components/game/SaveManager.tsx` | **新建**: 存档面板 |
| `components/game/GameHeader.tsx` | 新增存档按钮 |
| `services/api.ts` | 新增 save API 函数 |

## 边界情况

- DB 文件正在写入时保存: `db.transaction` 保证原子性，copy 前等事务提交
- 加载后旧存档列表: saves 表随 DB 一起被替换，自然同步
- 磁盘空间不足: `fs.copyFileSync` 抛异常 → 返回 error
- 槽位不存在: 1-5 范围内，slot 0 只读（自动存档）
- 空槽位加载: 返回 404
- 同时保存+加载: 前端按钮互斥，后端文件操作串行
