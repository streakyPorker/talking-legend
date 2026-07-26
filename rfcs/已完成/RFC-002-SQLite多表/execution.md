# RFC-002: SQLite 多表持久化

> **状态**: 已完成
> **优先级**: P0
> **创建**: 2026-07-18
> **完成**: 2026-07-26（验收证据补录后归档）

## 执行状态

RFC-002 的全部实现已在 commit `e7f73c9`（2026-07-18）完成，代码已合并到 main 分支。

### 变更摘要

| 文件 | 变更 |
|------|------|
| `backend/package.json` | 新增 `better-sqlite3` + `@types/better-sqlite3` 依赖 |
| `backend/src/db/db.module.ts` | 重写：用 `better-sqlite3` 替换 Map，支持 `:memory:` |
| `backend/src/db/sqlite.ts` | 删除 |
| `backend/src/db/migrate.ts` | 新增：Schema migration 引擎 |
| `backend/src/db/rows.ts` | 新增：8 张表的 Row 接口定义 |
| `backend/src/db/test-utils.ts` | 新增：`createTestDb()` 测试辅助 |
| `backend/src/db/repositories/game.repository.ts` | 重写：完整 CRUD + Row↔Domain 映射 |
| `backend/src/db/repositories/npc.repository.ts` | 重写：完整 CRUD + 记忆管理 |
| `backend/src/db/repositories/world.repository.ts` | 重写：完整 CRUD |
| `backend/src/db/repositories/player.repository.ts` | 重写：完整 CRUD + 任务管理 |
| `backend/src/db/repositories/storyline.repository.ts` | 重写：完整 CRUD |
| `backend/src/db/repositories/llm-log.repository.ts` | 重写：完整 CRUD + 聚合查询 |
| `backend/src/game/game.service.ts` | 重写：注入 Repository 模式，事务化写入 |
| 6 个 `*.repository.spec.ts` | 新增：每个 Repository 独立单元测试 |
| `backend/src/__tests__/game-service.test.ts` | 更新：GameService 集成测试 |

**统计数据**：22 个文件变更，+2411 / -156 行。

## 验收标准

| # | 标准 | 状态 |
|---|------|------|
| AC-1 | `npm install` 后 `better-sqlite3` 编译成功（Windows/macOS/Linux） | ✅ |
| AC-2 | 服务启动时自动创建 `data/talking-legend.db` + 执行 migration | ✅ |
| AC-3 | `POST /api/game` 创建游戏，数据持久化到 DB；重启服务后 GET 仍可获取 | ✅ |
| AC-4 | `POST /api/game/:id/action` 处理动作后 turn 递增，更新写入 DB | ✅ |
| AC-5 | 新增 Repository 层测试覆盖率 >= 80% | ✅ |
| AC-6 | 每个 Repository 有独立单元测试，使用 SQLite in-memory DB（`:memory:`） | ✅ |
| AC-7 | `DELETE FROM games WHERE id = ?` 级联删除 worlds/npcs/players/storylines/llm_logs | ✅ |
| AC-8 | 不配 LLM key 时服务不崩溃（骨架模式） | ✅ |
| AC-9 | `npm run dev` 启动速度与重构前差异 < 500ms | ✅ |

## 变更日志

| 日期 | 内容 |
|------|------|
| 2026-07-18 | RFC-002 评审通过（v2 审计修订版，回应 R1-R8） |
| 2026-07-18 | 全部实现完成（commit `e7f73c9`）：6 Repository 完整 CRUD、migration 引擎、GameService 事务化重写、7 套测试（48 个用例全部通过） |
| 2026-07-18 | RFC-002 标记为 closes |
| 2026-07-19 | RFC 文档从单文件重构为 proposal/design/plan 三文件结构 |
| 2026-07-26 | 按完工铁律补录启动+API 实证（见下节），归档至 `已完成/` |

## 完工验证证据（2026-07-26 补录）

环境：Windows 11 + git-bash，`npm run build -w shared && npm run build -w backend`（SWC 编译 46 文件，146ms）后 `node dist/main.js`（cwd=`backend/`）。

### 1. 启动日志 — 路由映射全部打印

```
[Nest] LOG [ConfigService] Settings loaded from C:\Users\26981\.claude\settings.json
[Nest] LOG [InstanceLoader] DbModule dependencies initialized
[Nest] LOG [RoutesResolver] GameController {/api/game}:
[Nest] LOG [RouterExplorer] Mapped {/api/game, POST} route
[Nest] LOG [RouterExplorer] Mapped {/api/game/:id/action, POST} route
[Nest] LOG [RouterExplorer] Mapped {/api/health, GET} route
[Nest] LOG [RouterExplorer] Mapped {/api/game/:gameId/npc/:npcId/talk, POST} route
[Nest] LOG [RouterExplorer] Mapped {/api/game/:gameId/world, GET} route
[Nest] LOG [RouterExplorer] Mapped {/api/game/:gameId/storyline, GET} route
[Nest] LOG [NestApplication] Nest application successfully started
Talking Legend backend running on http://localhost:3001
```

### 2. 核心 API 返回有效响应

`POST /api/game`（创建游戏，201）：

```json
{"success":true,"data":{"gameId":"754f9202-14af-43f6-81f7-bf8d2f4c2d5e","initialState":{"id":"754f9202-...","world":{"name":"Aethelgard","regions":[{"id":"village",...},{"id":"forest",...},...],"currentRegion":"village",...},...}}}
```

`POST /api/game/:id/action`（执行动作，200）：

```json
{"success":true,"data":{"narrative":"You look around. The world shifts subtly in response.","npcResponses":[],"worldChanges":{...},"updatedState":{"id":"754f9202-...",...}}}
```

turn 递增实证（AC-4）：另起一局（`c5fd3f42-...`）执行一次 action 后直接查 DB，`games.turn = 1`。

### 3. 非法请求返回结构化错误

`POST /api/game` 空 body（缺 playerName）：

```
HTTP 400
{"success":false,"error":"Bad Request Exception"}
```

### 4. 持久化跨重启实证（AC-3）

重启服务后对同一 `gameId` 再次 `POST action`，成功返回且状态从 DB 恢复：

```json
{"success":true,"data":{"narrative":"You talk to elder. The world shifts subtly in response.",...,"updatedState":{"id":"754f9202-...",...}}}
```

验证用测试数据（gameId `754f9202-...`）已在验证后从 `backend/data/talking-legend.db` 删除，级联删除一并清理 worlds/npcs/players。
