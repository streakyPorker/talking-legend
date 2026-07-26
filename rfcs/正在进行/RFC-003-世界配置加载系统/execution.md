# RFC-003: 世界配置加载系统 — 执行记录

> **状态**: 正在进行
> **开始**: 2026-07-26（owner 批准 design v2）
> **执行方式**: subagent-driven development（implementer → spec 评审 → 质量评审，逐任务串行）

## 执行计划

| 任务 | 内容 | 状态 |
|------|------|------|
| T1 | `world-config.schema.ts` + zod 校验规则 + 函数级单测 | ⬜ |
| T2 | `world-config.service.ts` + module（多来源装配/注册表/宽松错误策略）+ 模块级单测 | ⬜ |
| T3 | `worlds/aethelgard/` 拆分形态内容迁移 + `GameService.createGame()` 改造 + 服务级集成测试 | ⬜ |
| T4 | 完工铁律验证（启动日志 + curl 矩阵）+ 本文件实证补录 | ⬜ |

依赖：T1→T2→T3 串行（后者依赖前者接口），T4 收尾。

## 验收标准

| # | 标准 |
|---|------|
| AC-1 | `worlds/<id>/` 下 world.json（必需）+ regions/npcs 三来源（内联/单文件/目录）可任意组合，loader 合并装配 |
| AC-2 | zod 校验全覆盖：目录名=id、startingRegion 存在、connectedRegions 无悬空、npc.location 存在、合并后 id/key 无重复 |
| AC-3 | 单文件 JSON 损坏 → error 日志 + 跳过该文件；世界校验失败 → error + 跳过该世界；worldsDir 不存在 → warn |
| AC-4 | 0 有效世界 → 仅 warn，服务骨架模式正常启动；此时 createGame 返回 400 |
| AC-5 | `POST /api/game` 不传 scenario → 默认世界建局（向后兼容）；传 scenario → 指定世界；未知 scenario → 400 + 可用列表 |
| AC-6 | 硬编码种子全部移除，aethelgard 内容以拆分形态迁移到 `worlds/aethelgard/`（4 regions + 2 npcs），行为与迁移前一致 |
| AC-7 | NPC 实例 id 为每局新 uuid，配置 key 不出现在实例中 |
| AC-8 | `tsc --noEmit` 零错误；`vitest run` 全部通过（新增 + 存量 48+1） |

## 完工验证证据

（T4 完成后补录：启动日志 + curl 矩阵 + 测试输出）
