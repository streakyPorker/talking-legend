# RFC-003: 世界配置加载系统

> **状态**: 正在进行
> **优先级**: P0
> **创建**: 2026-07-26

## 现状审视（2026-07-26）

| 现状 | 位置 |
|------|------|
| 世界/区域/NPC 种子硬编码在 `createGame()` | `backend/src/game/game.service.ts:37-94` |
| `scenario?: string` 字段已预留、从未使用 | `shared/src/index.ts:109` |
| `worldsDir` 已预留（`<repo>/worlds/`），目录不存在 | `backend/src/config/config.service.ts:30` |
| `WorldService` / `NpcService` 空壳 | 世界演化属 RFC-008，不在本 RFC 范围 |

结论：接口契约（`CreateGameRequest`）无需变更——`scenario` 字段天然就是世界选择入口。本 RFC 纯后端内部实现，不触碰 shared 类型。

## 配置格式：JSON + zod

```
worlds/
  aethelgard/
    world.json        # 单文件承载一个世界的全部定义
```

```json
{
  "id": "aethelgard",
  "name": "Aethelgard",
  "description": "A realm where legends are forged by deeds and words hold power.",
  "startingRegion": "village",
  "regions": [
    { "id": "village", "name": "Stoneshire Village", "description": "...", "connectedRegions": ["forest", "mountains"] }
  ],
  "npcs": [
    { "key": "elder-marin", "name": "Elder Marin", "role": "Village Elder",
      "personality": "...", "initialMood": "welcoming", "location": "village" }
  ]
}
```

选型理由：
- **JSON 而非 YAML**：项目全链路已用 zod 做校验（`*.schema.ts` 模式），JSON 零新依赖；世界配置由开发者/AI 维护，可读性收益不足以引入 YAML 解析器
- **单文件而非 world.json + npcs.json 拆分**：MVP 每世界 NPC 数量 <10，拆分无收益；NPC 跨世界复用是假想需求
- **`key` 与实例 `id` 分离**：配置内 NPC 用稳定 `key`（人类可读、可引用）；每局游戏实例化时生成 uuid 作为 `NPCState.id`，与现有 DB schema 一致

## zod 校验规则

- `id` 必须等于目录名（防错位）
- `startingRegion` 必须存在于 `regions[].id`
- `connectedRegions` 引用的区域必须存在
- `npcs[].location` 必须存在于 `regions[].id`
- `npcs[].key` 世界内唯一

## 模块设计：`world-config`

```
backend/src/world-config/
  world-config.module.ts    # @Global，导出 WorldConfigService
  world-config.service.ts   # 启动时加载 + 校验 + 注册表
  world-config.schema.ts    # zod schema + WorldConfig 类型
  world-config.service.spec.ts
  world-config.schema.spec.ts
```

`WorldConfigService`（`OnModuleInit`）：

| 方法 | 行为 |
|------|------|
| `loadAll()` | 扫描 `worldsDir` 子目录，逐个读 `world.json` → zod 校验 → 注册 |
| `getWorld(id)` | 返回配置；不存在返回 `undefined` |
| `listWorlds()` | 返回所有已注册世界的摘要（id/name） |
| `getDefaultWorld()` | 唯一世界时返回它；多世界时返回 `id` 字典序第一个 |

**错误策略**（与骨架模式哲学一致）：
- 单个配置文件无效 → `Logger.error` 打全错误详情，**跳过**该世界，不影响其他
- `worldsDir` 不存在 → warn 并视为空（允许骨架启动）
- 校验通过的世界数为 0 → **启动失败**（没有世界的游戏服务无意义）

**无热加载**：MVP 启动时加载一次。改配置需重启，可接受。

## `createGame()` 改造

```typescript
async createGame(req: CreateGameRequest): Promise<CreateGameResponse> {
  const config = req.scenario
    ? this.worldConfig.getWorld(req.scenario)          // 指定世界
    : this.worldConfig.getDefaultWorld();              // 缺省世界
  if (!config) throw new BadRequestException(
    `Unknown scenario: ${req.scenario}. Available: ${this.worldConfig.listWorlds().map(w => w.id).join(', ')}`
  );
  // WorldState/NPCState 由 config 映射；NPC 实例 id = uuidv4()
  // ...后续事务化种子写入逻辑不变（RFC-002 成果保留）
}
```

- `scenario` 缺省 → 默认世界（向后兼容：现有前端不传 scenario 也能玩）
- 未知 `scenario` → 400 + 可用世界列表
- 玩家状态（名字/背包/声望）留在代码里初始化——玩家不是世界内容
- `worlds.currentRegion` / `players.location` ← `config.startingRegion`

## 内置世界迁移

`worlds/aethelgard/world.json` = 现有硬编码内容**原样迁移**（4 区域 + 2 NPC）。

> 设计决策表写「MVP 区域 2 区域（village + forest）」，但现有种子是 4 区域。本 RFC 只做配置系统建设，内容原样保留；区域裁剪是内容决策，如需进行另行提出。

## 测试策略

| 层级 | 内容 |
|------|------|
| 函数级 | zod schema：合法配置通过；每种校验规则各一个失败用例（region 引用悬空、key 重复、startingRegion 不存在等） |
| 模块级 | `WorldConfigService`：tmp 目录夹具 —— 正常加载、无效文件跳过、目录不存在 warn、0 有效世界抛错、getDefaultWorld 单/多世界行为 |
| 服务级 | `GameService` 集成测试（`:memory:` DB）：默认世界建局、指定 scenario 建局、未知 scenario 400、NPC 实例 id 为 uuid 且配置 key 不泄露到实例 |

## 实施任务拆分（execution 用）

1. **T1** `world-config.schema.ts` + 单测（zod schema + 校验规则）
2. **T2** `world-config.service.ts` + module + 单测（加载/注册表/错误策略）
3. **T3** `worlds/aethelgard/world.json` 内容迁移 + `GameService.createGame()` 改造 + 集成测试
4. **T4** 完工铁律验证：启动日志（世界加载打印）+ curl（默认/scenario/未知 scenario）+ execution.md 实证

T1→T2→T3 串行（后者依赖前者接口），T4 收尾。

## 非目标（明确排除）

- ❌ 热加载 / 配置监听
- ❌ 世界配置的 CRUD API（运行时创建世界）
- ❌ NPC 跨世界复用、配置继承
- ❌ 区域内容裁剪（维持现有 4 区域内容）
- ❌ 前端世界选择 UI（`scenario` 字段先由 API 层支持，前端属 RFC-010/011）
