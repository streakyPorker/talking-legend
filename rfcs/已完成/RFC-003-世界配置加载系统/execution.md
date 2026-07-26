# RFC-003: 世界配置加载系统 — 执行记录

> **状态**: 已完成
> **开始**: 2026-07-26（owner 批准 design v2）
> **执行方式**: subagent-driven development（implementer → spec 评审 → 质量评审，逐任务串行）

## 执行计划

| 任务 | 内容 | 状态 |
|------|------|------|
| T1 | `world-config.schema.ts` + zod 校验规则 + 函数级单测 | ✅（18 测试；spec 评审 ✅ / 质量评审修复后 APPROVE） |
| T2 | `world-config.service.ts` + module（多来源装配/注册表/宽松错误策略）+ 模块级单测 | ✅（17 测试；spec ✅ / 质量修复后 APPROVE） |
| T3 | `worlds/aethelgard/` 拆分形态内容迁移 + `GameService.createGame()` 改造 + 服务级集成测试 | ✅（88/88 全量；spec ✅ / 质量 APPROVE） |
| T4 | 完工铁律验证（启动日志 + curl 矩阵）+ 本文件实证补录 | ✅ |

关键 commit：899de17(T1) → bdd7fad+dec342a(T1 修复) → dc18d66(T2) → 7434abe(T2 修复) → fbb810f+7460dce+b2ad5a7(T3)

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

环境：Windows 11 + git-bash，`npm run build -w backend`（SWC 51 文件 96ms）后 `node dist/main.js`（cwd=`backend/`）。测试：`npx vitest run` **9 文件 88 测试全通过**；`node node_modules/typescript/bin/tsc --noEmit` 零错误（注意：裸 `npx tsc` 被 rtk 包装会掩盖真实错误）。

### 1. 启动日志 — 世界加载

```
[Nest] LOG [InstanceLoader] WorldConfigModule dependencies initialized
[Nest] LOG [WorldConfigService] Loaded world "aethelgard" (4 regions, 2 npcs)
[Nest] LOG [NestApplication] Nest application successfully started
Talking Legend backend running on http://localhost:3001
```

### 2. curl 矩阵

**无 scenario（默认世界，向后兼容）→ 201**：

```json
{"success":true,"data":{"gameId":"8e8ec460-...","initialState":{"world":{"name":"Aethelgard","description":"A realm where legends are forged...","regions":[{...village/forest/mountains/lake...}],"currentRegion":"village"},...}}}
```

字段核查（第三局真实响应）：`currentRegion=village`、`player.location=village`、NPC 实例 `id` 为每局新 uuid、`memoryOfPlayer=[]`、`isAlive=true`、配置 `key`（elder-marin/ranger-kael）在响应中**不存在**。

**显式 scenario=aethelgard → 201** ✓

**未知 scenario → 400 结构化错误**：

```json
HTTP 400
{"success":false,"error":"Unknown scenario: narnia. Available: aethelgard"}
```

**零世界骨架模式**（从 `backend/dist` 启动使 worldsDir 解析到不存在的 `backend/worlds`）：

```
WARN [WorldConfigService] worldsDir "...backend\worlds" does not exist or is unreadable — starting with empty registry
HTTP 400
{"success":false,"error":"No world configs available"}
```

服务在零世界时正常启动不崩溃（骨架模式），仅建局被拒绝。

### 3. 已知行为差异与 Minor backlog（owner 裁决：仅记录不修复）

- **regions 数组顺序**：拆分形态按文件名排序装配（forest/lake/mountains/village），与原硬编码顺序（village 在前）不同。顺序无语义（currentRegion 独立字段），前端如需展示排序另行约定。
- **M1 测试夹具漂移风险**：`game-service.test.ts` 内联复制了 aethelgard 内容，与 `worlds/aethelgard/`  Canonical 配置可能漂移。后续可改为从真实 worlds/ 加载。
- **M2 `worldsDir` cwd 脆弱**：`process.cwd()/../worlds` 依赖从 `backend/` 启动；从其他 cwd 启动会静默进入骨架模式。后续可改为相对 `__dirname` 解析或支持 `WORLDS_DIR` 环境变量。
- **M3 `listWorlds()` 顺序隐式**：依赖 readdir 插入序，多世界时 "Available:" 消息顺序非显式契约。后续可按 id 排序。
- **M4 缺 `worlds/README.md`**：内容约定（三来源合并、all-or-nothing vs 逐文件容错、id=目录名）目前只在 design.md，内容作者无入口文档。
- **rtk tsc 包装陷阱**：`npx tsc` 输出不可信（曾报假的 TS5101、也曾掩盖 70 个真实错误），类型检查一律用 `node node_modules/typescript/bin/tsc --noEmit`。

验证用测试数据（3 局 T4 游戏）已从 `backend/data/talking-legend.db` 删除。
