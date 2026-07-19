# RFC-002: SQLite 多表持久化

> **状态**: 正在进行
> **优先级**: P0
> **创建**: 2026-07-18

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
