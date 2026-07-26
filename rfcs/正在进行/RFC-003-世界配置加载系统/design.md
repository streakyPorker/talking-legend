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

## 配置格式：JSON 多文件、可动态拆分

保持 JSON（零新依赖、全链路 zod 校验），但**每个内容段都可按作者偏好自由拆分**，loader 动态装配：

```
worlds/
  aethelgard/
    world.json              # 必需：id, name, description, startingRegion（可内联 regions/npcs）
    regions.json            # 可选：Region[] 整组单文件
    regions/                # 可选：每文件一个 Region（文件名任意，以内容 id 为准）
      village.json
      forest.json
    npcs.json               # 可选：NpcConfig[] 整组单文件
    npcs/                   # 可选：每文件一个 NPC（文件名任意，以内容 key 为准）
      elder-marin.json
      ranger-kael.json
```

**装配规则**（对 regions / npcs 两段各自独立适用）：

1. 三种来源可任意共存：内联数组（world.json 内）、`<段>.json` 整组文件、`<段>/` 目录逐文件
2. loader 合并全部来源为一个列表
3. 合并后 id（region）/ key（npc）**重复 → 该校验世界无效**（防静默覆盖）
4. 段完全缺失 → 视为空数组（npcs 允许为空；regions 为空会使 startingRegion 校验失败）

选型理由：
- **JSON 而非 YAML**：零新依赖；loader 的合并逻辑与文件格式正交，未来若要支持 YAML 只需换解析器
- **动态拆分而非固定结构**：内容作者可粗可细——小世界一个 world.json 内联搞定，大世界逐文件维护；结构随内容规模自然生长，无需迁移

`world.json` 示例（meta 最小形态）：

```json
{
  "id": "aethelgard",
  "name": "Aethelgard",
  "description": "A realm where legends are forged by deeds and words hold power.",
  "startingRegion": "village"
}
```

`regions/village.json` 示例：

```json
{ "id": "village", "name": "Stoneshire Village", "description": "...", "connectedRegions": ["forest", "mountains"] }
```

`npcs/elder-marin.json` 示例：

```json
{ "key": "elder-marin", "name": "Elder Marin", "role": "Village Elder",
  "personality": "...", "initialMood": "welcoming", "location": "village" }
```

**`key` 与实例 `id` 分离**：配置内 NPC 用稳定 `key`（人类可读、可引用）；每局游戏实例化时生成 uuid 作为 `NPCState.id`，与现有 DB schema 一致。

## zod 校验规则（合并装配后统一校验）

- `id` 必须等于目录名（防错位）
- `startingRegion` 必须存在于合并后的 `regions[].id`
- `connectedRegions` 引用的区域必须存在
- `npcs[].location` 必须存在于 `regions[].id`
- 合并后来源间 region `id` / npc `key` 无重复

## 模块设计：`world-config`

```
backend/src/world-config/
  world-config.module.ts    # @Global，导出 WorldConfigService
  world-config.service.ts   # 启动时装配 + 校验 + 注册表
  world-config.schema.ts    # zod schema + WorldConfig 类型
  world-config.service.spec.ts
  world-config.schema.spec.ts
```

`WorldConfigService`（`OnModuleInit`）：

| 方法 | 行为 |
|------|------|
| `loadAll()` | 扫描 `worldsDir` 子目录 → 逐世界装配多来源 → zod 校验 → 注册 |
| `getWorld(id)` | 返回配置；不存在返回 `undefined` |
| `listWorlds()` | 返回所有已注册世界的摘要（id/name） |
| `getDefaultWorld()` | 唯一世界时返回它；多世界时返回 `id` 字典序第一个；无世界返回 `undefined` |

**错误策略（宽松，与骨架模式哲学一致）**：
- 单个配置文件 JSON 解析失败 → `Logger.error`，**跳过该文件**继续装配其余来源
- 装配后校验失败 → `Logger.error` 打全错误详情，**跳过该世界**，不影响其他
- `worldsDir` 不存在 → warn 并视为空
- 校验通过的世界数为 0 → **仅 warn**，服务以骨架模式正常启动；`createGame` 此时返回 400「无可用世界」

**无热加载**：MVP 启动时加载一次。改配置需重启，可接受。

## `createGame()` 改造

```typescript
async createGame(req: CreateGameRequest): Promise<CreateGameResponse> {
  const config = req.scenario
    ? this.worldConfig.getWorld(req.scenario)
    : this.worldConfig.getDefaultWorld();
  if (!config) throw new BadRequestException(
    req.scenario
      ? `Unknown scenario: ${req.scenario}. Available: ${this.worldConfig.listWorlds().map(w => w.id).join(', ')}`
      : 'No world configs available'
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

现有硬编码内容**原样迁移**，并采用拆分形态给多文件约定打样：

```
worlds/aethelgard/
  world.json                # meta only
  regions/village.json      # 4 个区域文件
  regions/forest.json
  regions/mountains.json
  regions/lake.json
  npcs/elder-marin.json     # 2 个 NPC 文件
  npcs/ranger-kael.json
```

> 设计决策表写「MVP 区域 2 区域（village + forest）」，但现有种子是 4 区域。本 RFC 只做配置系统建设，内容原样保留；区域裁剪是内容决策，如需进行另行提出。

## 测试策略

| 层级 | 内容 |
|------|------|
| 函数级 | zod schema：合法配置通过；每种校验规则各一个失败用例（region 引用悬空、key/id 重复、startingRegion 不存在等） |
| 模块级 | `WorldConfigService`：tmp 目录夹具 —— 单文件内联形态、拆分形态、混合形态三种装配等价性；JSON 损坏文件跳过；校验失败世界跳过；目录不存在 warn；0 世界时 getDefaultWorld 返回 undefined 且不抛错；getDefaultWorld 单/多世界行为 |
| 服务级 | `GameService` 集成测试（`:memory:` DB）：默认世界建局、指定 scenario 建局、未知 scenario 400、无世界 400、NPC 实例 id 为 uuid 且配置 key 不泄露到实例 |

## 实施任务拆分（execution 用）

1. **T1** `world-config.schema.ts` + 单测（zod schema + 校验规则）
2. **T2** `world-config.service.ts` + module + 单测（多来源装配/注册表/宽松错误策略）
3. **T3** `worlds/aethelgard/` 拆分形态内容迁移 + `GameService.createGame()` 改造 + 集成测试
4. **T4** 完工铁律验证：启动日志（世界加载打印）+ curl（默认/scenario/未知 scenario/无世界）+ execution.md 实证

T1→T2→T3 串行（后者依赖前者接口），T4 收尾。

## 非目标（明确排除）

- ❌ 热加载 / 配置监听
- ❌ 世界配置的 CRUD API（运行时创建世界）
- ❌ NPC 跨世界复用、配置继承
- ❌ YAML 等其他格式（loader 装配逻辑与解析器正交，未来可加）
- ❌ 区域内容裁剪（维持现有 4 区域内容）
- ❌ 前端世界选择 UI（`scenario` 字段先由 API 层支持，前端属 RFC-010/011）
