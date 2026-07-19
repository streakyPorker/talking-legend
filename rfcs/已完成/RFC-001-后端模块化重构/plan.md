# RFC-001: 后端模块化重构

> **状态**: 已完成
> **优先级**: P0
> **创建**: 2026-07-18

---

## 执行任务

| # | 任务 | 状态 |
|---|------|------|
| 1 | 安装 NestJS 依赖 | ✅ 已完成 |
| 2 | 创建 AppModule 和 main.ts 入口 | ✅ 已完成 |
| 3 | 实现 CommonModule（filters/interceptors/pipes） | ✅ 已完成 |
| 4 | 实现 ConfigModule + ConfigService | ✅ 已完成 |
| 5 | 实现 DbModule（SQLite + repositories） | ✅ 已完成 |
| 6 | 实现 LlmModule（骨架） | ✅ 已完成 |
| 7 | 迁移 GameModule（核心路由） | ✅ 已完成 |
| 8 | 迁移 NpcModule / WorldModule / StorylineModule（骨架） | ✅ 已完成 |
| 9 | 迁移/补充单元测试 | ✅ 已完成 |
| 10 | 移除旧 Express 文件 | ✅ 已完成 |

## 验收标准

| # | 标准 | 状态 |
|---|------|------|
| AC-1 | `npm run dev` 启动 NestJS 服务，端口从配置读取（默认 3001） | ✅ |
| AC-2 | `POST /api/game` 创建游戏，返回 201 + CreateGameResponse | ✅ |
| AC-3 | `POST /api/game/:id/action` 处理动作，返回 200 + GameActionResponse | ✅ |
| AC-4 | 非法请求返回 `{ success: false, error: "..." }` | ✅ |
| AC-5 | 已有 4 个后端 UT 迁移后全部通过 | ✅ |
| AC-6 | `GameModule` 可独立测试（mock DbModule + LlmModule） | ✅ |
| AC-7 | 旧的 `routes/game.ts` 和 `services/game-service.ts` 已移除 | ✅ |
| AC-8 | ConfigService 正确读取 .env + settings.json，配置优先级正确 | ✅ |
| AC-9 | 不配 LLM key 时服务不崩溃（仅 warn），骨架模式可用 | ✅ |

## 变更记录

- **2026-07-18**: RFC 编写完成，整体设计方案确定。
- **2026-07-18**: 全部任务实施完成，验收标准全部通过。
