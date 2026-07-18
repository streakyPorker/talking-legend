# RFC-002: SQLite 多表持久化（Map → better-sqlite3）

> **状态**: Review (v2 — 审计修订后，回应 R1-R8)
> **优先级**: P0
> **创建**: 2026-07-18

---

## 背景

RFC-001 完成 NestJS 模块化重构后，`DbModule` 仍使用 `Map<string, Map<string, unknown>>` 作为内存骨架，所有 6 个 Repository 均为空壳，`GameService` 也绕过 Repository 直接操作自己的 `Map` 实例。RFC-002 是第一个"填肉" RFC——将内存存储替换为 `better-sqlite3`，打通真正的持久化链路。

## 问题

1. **无持久化**：服务重启丢失所有游戏数据
2. **无事务**：多表写操作无原子性保障
3. **无查询能力**：Map 只能按 key 查找，无法做关联查询（如"某个 NPC 的所有记忆"）
4. **绕过 Repository**：`GameService` 直接操作自己的 `Map`，Repository 层形同虚设
5. **无 schema 约束**：Map 可以是任意结构，开发和调试时无声 bug 多

## 方案

### 技术选型：better-sqlite3

| 候选 | 排除理由 |
|------|---------|
| `better-sqlite3` | ✅ 同步 API，与 NestJS 同步执行模型天然适配；WAL 模式读并发优秀 |
| `sql.js` | WASM 版本，性能不及原生；主要在浏览器场景使用 |
| `sqlite3` (node-sqlite3) | 异步回调式 API，需要额外包装为 Promise，不如同步方案简洁 |
| PostgreSQL / MySQL | 引入外部依赖，破坏"零运维启动"的设计目标 |

**`better-sqlite3` 关键配置**：
- 启用 WAL 模式（读写并发）
- `journal_mode = WAL`
- `synchronous = NORMAL`（WAL 模式下安全 + 性能最优）
- `foreign_keys = ON`

### 数据表设计

ER 图概览（6 张表 + 2 张关联表）：

```
games ──1:N──> npcs
games ──1:1──> worlds
games ──1:1──> players
games ──1:1──> storylines
games ──1:N──> llm_logs
npcs   ──1:N──> npc_memories
players──1:N──> player_quests
```

#### 1. `games` — 游戏会话主表

```sql
CREATE TABLE games (
  id          TEXT PRIMARY KEY,         -- UUID
  player_name TEXT NOT NULL,
  turn        INTEGER NOT NULL DEFAULT 0,
  phase       TEXT NOT NULL DEFAULT 'intro',  -- GamePhase
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 2. `worlds` — 世界状态（1:1 games）

```sql
CREATE TABLE worlds (
  game_id         TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  current_region  TEXT NOT NULL,
  time_of_day     TEXT NOT NULL DEFAULT 'morning',
  weather         TEXT NOT NULL DEFAULT 'clear',
  regions         TEXT NOT NULL,        -- JSON array of Region
  global_events   TEXT NOT NULL DEFAULT '[]', -- JSON array of string
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**regions 字段**：存储为 JSON 文本，SQLite 支持 `json_extract` 函数做路径查询。不单独建 `regions` 表——regions 是世界的子属性，始终随 world 一起读写，拆分无收益。

#### 3. `npcs` — NPC 状态（1:N games）

```sql
CREATE TABLE npcs (
  id               TEXT PRIMARY KEY,    -- UUID
  game_id          TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL,
  personality      TEXT NOT NULL,
  current_mood     TEXT NOT NULL DEFAULT 'neutral',
  location         TEXT NOT NULL,
  is_alive         INTEGER NOT NULL DEFAULT 1,  -- boolean
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_npcs_game_id ON npcs(game_id);
```

#### 4. `npc_memories` — NPC 对玩家的记忆（1:N npcs）

```sql
CREATE TABLE npc_memories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  npc_id    TEXT NOT NULL REFERENCES npcs(id) ON DELETE CASCADE,
  content   TEXT NOT NULL,              -- 记忆内容
  turn      INTEGER NOT NULL,           -- 产生时的 turn 数
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_npc_memories_npc_id ON npc_memories(npc_id);
```

**为什么从 `memoryOfPlayer: string[]` 拆成独立表**：随着游戏推进，NPC 的记忆会增长。JSON 数组存储在 npc 行内会导致行膨胀 + 无查询能力（"找出 Eldar Marin 对玩家的所有记忆"需要全扫 JSON）。独立表支持按 npc_id 高效索引 + 按 turn 排序。

#### 5. `players` — 玩家状态（1:1 games）

```sql
CREATE TABLE players (
  game_id     TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  location    TEXT NOT NULL,
  inventory   TEXT NOT NULL DEFAULT '[]',      -- JSON array of string
  reputation  TEXT NOT NULL DEFAULT '{}',      -- JSON object: Record<string, number>
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 6. `player_quests` — 玩家任务（1:N players）

```sql
CREATE TABLE player_quests (
  id          TEXT PRIMARY KEY,         -- quest UUID
  game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active', -- 'active' | 'completed' | 'failed'
  progress    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_player_quests_game_id ON player_quests(game_id);
```

> **设计说明 — quest 归属语义**：`player_quests.game_id` 直接引用 `games` 而非通过 `players` 间接关联。理由是当前架构中 `game` 与 `player` 是 1:1 关系（每个游戏只有一个玩家角色），`game_id` 同时唯一标识一个 player。这种设计避免了不必要的中间 JOIN，且 `ON DELETE CASCADE` 从 games 出发路径最短。如果未来支持多人游戏（一 game 多 player），`player_quests` 需要增加 `player_id` 列并建立到 `players` 的 FK——这是已知未来演进点，但不在本 RFC 范围内。

#### 7. `storylines` — 事件链状态（1:1 games）

```sql
CREATE TABLE storylines (
  game_id          TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  current_stage    TEXT NOT NULL,           -- 当前阶段标识
  stage_data       TEXT NOT NULL DEFAULT '{}', -- JSON: 阶段相关数据
  completed_stages TEXT NOT NULL DEFAULT '[]', -- JSON array of string
  active_events    TEXT NOT NULL DEFAULT '[]', -- JSON array of active event IDs
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### 8. `llm_logs` — LLM 调用日志（1:N games）

```sql
CREATE TABLE llm_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  call_type     TEXT NOT NULL,            -- 'gm' | 'npc_dialogue' | 'intent' | 'memory_filter'
  model         TEXT NOT NULL,
  prompt_tokens  INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  latency_ms    INTEGER NOT NULL,
  cost_usd      REAL NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_llm_logs_game_id ON llm_logs(game_id);
CREATE INDEX idx_llm_logs_call_type ON llm_logs(call_type);
CREATE INDEX idx_llm_logs_created_at ON llm_logs(created_at);
CREATE INDEX idx_llm_logs_game_type ON llm_logs(game_id, call_type);
```

### Row 类型定义（数据访问层 → 业务层边界）

每个表对应一个 TypeScript **Row 接口**，字段类型直接映射 SQLite 列类型（`string | number | null`）。JSON 列以 `string` 存储，**序列化/反序列化在 Repository 层完成**。

```typescript
// backend/src/db/rows.ts — 所有 Row 接口集中定义

/** games 表行 */
export interface GameRow {
  id: string;
  player_name: string;
  turn: number;
  phase: string;
  created_at: string;
  updated_at: string;
}

/** worlds 表行 */
export interface WorldRow {
  game_id: string;
  name: string;
  description: string;
  current_region: string;
  time_of_day: string;
  weather: string;
  regions: string;          // JSON: Region[]
  global_events: string;    // JSON: string[]
  created_at: string;
  updated_at: string;
}

/** npcs 表行 */
export interface NPCRow {
  id: string;
  game_id: string;
  name: string;
  role: string;
  personality: string;
  current_mood: string;
  location: string;
  is_alive: number;         // SQLite boolean → 0|1
  created_at: string;
  updated_at: string;
}

/** npc_memories 表行 */
export interface NPCMemoryRow {
  id: number;               // AUTOINCREMENT
  npc_id: string;
  content: string;
  turn: number;
  created_at: string;
}

/** players 表行 */
export interface PlayerRow {
  game_id: string;
  name: string;
  location: string;
  inventory: string;        // JSON: string[]
  reputation: string;       // JSON: Record<string, number>
  created_at: string;
  updated_at: string;
}

/** player_quests 表行 */
export interface PlayerQuestRow {
  id: string;
  game_id: string;
  title: string;
  description: string;
  status: string;           // 'active' | 'completed' | 'failed'
  progress: number;
  created_at: string;
  updated_at: string;
}

/** storylines 表行 */
export interface StorylineRow {
  game_id: string;
  current_stage: string;
  stage_data: string;       // JSON: Record<string, unknown>
  completed_stages: string; // JSON: string[]
  active_events: string;    // JSON: string[]
  created_at: string;
  updated_at: string;
}

/** llm_logs 表行 */
export interface LLMLogRow {
  id: number;               // AUTOINCREMENT
  game_id: string;
  call_type: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  cost_usd: number;
  created_at: string;
}
```

**序列化边界约定**：

```
调用层（GameService 等）
    ↓ 使用 Domain 类型（来自 shared/）
Repository 层
    ↓ JSON.parse / JSON.stringify + Domain → Row 映射
SQLite（Row 类型）
```

- Repository 的 **公开方法签名全部使用 Domain 类型**（`GameState`、`WorldState`、`NPCState` 等），调用方只看到 Domain 类型
- Repository 内部在 `insert`/`update` 时将 Domain 类型映射为 Row 类型并序列化 JSON 字段；在 `findById` 时反序列化 JSON 字段并映射回 Domain 类型
- JSON 序列化/反序列化逻辑集中在 Repository 私有方法中，不泄漏到 Service 层
- 不引入单独的 Mapper 层——8 张表的映射逻辑足够简单，额外的抽象层反而增加文件跳转成本

**类型安全链**：

```
SQLite Row (rows.ts) → Repository 私有映射 → Domain 接口 (shared/)
                                                    ↓
                                            GameService / Controller
```

### Schema 迁移策略

使用 **schema version 表 + 顺序迁移** 而非 ORM migration：

```sql
CREATE TABLE IF NOT EXISTS _schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

启动时检查 `_schema_version`，按版本号顺序执行未应用的 DDL。不引入 Knex/Prisma/TypeORM —— 8 张表的手工 DDL 足够简单，ORM 层的抽象成本（映射配置、migration 文件生成、类型推导）远超收益。

#### Migration 生命周期

每个 migration 版本遵循以下规范：

1. **事务包裹**：每个版本的 DDL 在 `BEGIN IMMEDIATE` / `COMMIT` 内执行。任一条语句失败则整体回滚。
2. **失败处理**：migration 失败时 `_schema_version` 不递增。下次服务启动时自动重试同一版本。失败的 migration 错误信息写入 stderr。
3. **ALTER TABLE 边界**：v1 仅做 `CREATE TABLE`，不做 `ALTER`/`DROP`。后续版本优先使用 **CREATE 新表 + 数据迁移 + DROP 旧表** 策略处理 schema 变更；`ALTER TABLE` 仅在 SQLite 支持的简单操作（`ADD COLUMN`、`RENAME COLUMN`、`RENAME TABLE`）中使用。
4. **幂等性**：migration 条件判断 `IF NOT EXISTS` 确保重复执行安全（如 CREATE TABLE IF NOT EXISTS）。
5. **单实例假设**：当前架构单机部署，无需分布式 migration 锁。如果未来多实例部署，在 `_schema_version` 上使用 `BEGIN IMMEDIATE` 已提供文件级排他锁。

```typescript
// backend/src/db/migrate.ts — 结构示意
const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up(db: Database) {
      db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS games ( ... );
        CREATE TABLE IF NOT EXISTS worlds ( ... );
        -- ... 其余 6 张表
        INSERT INTO _schema_version (version) VALUES (1);
        COMMIT;
      `);
    },
  },
];

export function migrate(db: Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const current = db.prepare('SELECT COALESCE(MAX(version), 0) as v FROM _schema_version').get() as { v: number };
  for (const m of migrations) {
    if (m.version > current.v) {
      try {
        m.up(db);
        console.log(`Migration v${m.version} (${m.name}) applied.`);
      } catch (err) {
        console.error(`Migration v${m.version} (${m.name}) FAILED:`, err);
        throw err; // 阻止服务启动
      }
    }
  }
}
```

### Repository 接口设计

每个 Repository 遵循统一模式：

```typescript
@Injectable()
export class GameRepository {
  constructor(@Inject(DB_INSTANCE) private readonly db: Database.Database) {}

  findById(id: string): GameState | undefined { ... }
  create(id: string, playerName: string): GameState { ... }
  delete(id: string): void { ... }
  list(): GameState[] { ... }
}
```

- 所有方法为同步调用（`better-sqlite3` 同步 API）
- **公开方法签名使用 Domain 类型**（来自 `@talking-legend/shared`），而非 Row 类型
- Row ↔ Domain 映射在 Repository 私有方法中完成（JSON 序列化/反序列化）
- 使用 `db.prepare(sql)` + 参数绑定，避免 SQL 注入
- Repository 不处理业务逻辑，仅做数据访问
- `llm_log` Repository 额外提供聚合查询：按 game/type/时间范围聚合 token 和费用

### GameService 改造

当前 `GameService` 有自己私有的 `Map`：

```typescript
// ❌ 当前
const games = new Map<string, GameState>();

// ✅ 改造后
constructor(
  private readonly gameRepo: GameRepository,
  private readonly worldRepo: WorldRepository,
  private readonly npcRepo: NpcRepository,
  private readonly playerRepo: PlayerRepository,
) {}
```

`createGame()` 改为调用 Repository 写入多表，`performAction()` 改为读 DB 后执行业务逻辑再写回。

### 事务策略（并发安全）

`better-sqlite3` 是**同步单连接**——两个线程不能同时执行 SQL 语句，但 Node.js 的事件循环允许两个 async 请求交替执行 JS 代码，形成读-改-写 竞态窗口：

```
Request A: read turn=5 → (await something) → write turn=6
Request B: read turn=5 → (await something) → write turn=6  // 丢失 A 的更新
```

**缓解方案**：`performAction()` 及其他多步写操作包裹在 `db.transaction()` 中执行：

```typescript
// GameService
async performAction(gameId: string, req: GameActionRequest): Promise<GameActionResponse> {
  // db.transaction() 将内部所有 SQL 原子化执行
  const doAction = this.db.transaction((gameId: string, req: GameActionRequest) => {
    const game = this.gameRepo.findById(gameId);
    if (!game) throw new NotFoundException(`Game ${gameId} not found`);

    // 业务逻辑（同步执行——不在此事务内做任何 async 调用）
    const narrative = buildNarrative(game, req);
    const updatedGame = { ...game, turn: game.turn + 1 };

    // 写回（同一事务内）
    this.gameRepo.update(gameId, { turn: updatedGame.turn });
    this.worldRepo.updateWorld(gameId, applyWorldChanges(game, req));

    return { narrative, updatedGame };
  });

  return doAction(gameId, req);
}
```

**关键约束**：
- `db.transaction()` 回调内 **禁止任何 async 操作**（包括 await LLM 调用、网络请求）
- 如果未来需要在事务中调用 LLM（如 RFC-005），采用 **两阶段模式**：阶段 1（事务内）：读 DB + 锁行（`UPDATE games SET locked = 1 WHERE id = ? AND locked = 0`）；阶段 2（事务外）：调用 LLM；阶段 3（事务内）：写回 + 解锁
- 短期（单机单用户场景）：单连接已提供足够串行化保障；乐观锁（`UPDATE ... WHERE turn = ?` 检查 `changes`）作为额外防御层，在 v1 中实现

### DbModule 改造

```typescript
// db.module.ts — RFC-002 版本
import Database from 'better-sqlite3';

@Global()
@Module({})
export class DbModule {
  static forRoot(config: DbModuleConfig): DynamicModule {
    const db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    
    // Run pending migrations
    migrate(db);
    
    const dbProvider = {
      provide: DB_INSTANCE,
      useValue: db,
    };

    return {
      module: DbModule,
      providers: [dbProvider],
      exports: [dbProvider],
    };
  }
}
```

`DB_INSTANCE` 的 token 类型从 `Map<string, Map<string, unknown>>` 变为 `Database`（`better-sqlite3.Database`）。

### 目录变更

```
backend/src/db/
  db.module.ts           # 改用 better-sqlite3，启动时执行 migration
  sqlite.ts              # 移除（不再需要 createDb 占位函数）
  migrate.ts             # NEW: schema version 检查 + DDL 执行
  rows.ts                # NEW: 所有表的 Row 接口定义
  test-utils.ts          # NEW: createTestDb() 测试辅助函数
  repositories/
    game.repository.ts    # 实现 CRUD
    npc.repository.ts     # 实现 CRUD + 记忆管理
    world.repository.ts   # 实现 CRUD
    player.repository.ts  # 实现 CRUD + 任务管理
    storyline.repository.ts # 实现 CRUD
    llm-log.repository.ts  # 实现 CRUD + 聚合查询
```

## 替代方案

| 方案 | 排除理由 |
|------|---------|
| Prisma | 需要生成客户端代码 + migration 文件，对 8 张表的简单 schema 过度工程化。异步 API 需额外适配 |
| TypeORM | 装饰器实体定义 + 异步 API，同样过度。NestJS 官方虽推荐，但对本项目体量过重 |
| Knex.js | query builder 仅在 SQL 动态拼接复杂时有用；本项目查询简单，直接写 SQL 更清晰 |
| 保持 Map + JSON 文件 dump | 无并发控制、无事务、无查询能力；唯一优势是零依赖，但不满足游戏持久化需求 |

## 影响范围

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `backend/package.json` | 修改 | 新增 `better-sqlite3` + `@types/better-sqlite3` 依赖 |
| `backend/src/db/db.module.ts` | 重写 | 用 `better-sqlite3` 替换 `Map`，支持 `dbPath: ':memory:'` |
| `backend/src/db/sqlite.ts` | 删除 | 不再需要占位函数 |
| `backend/src/db/migrate.ts` | 新增 | Schema migration 逻辑 + 生命周期管理 |
| `backend/src/db/rows.ts` | 新增 | 8 个表的 Row 接口定义 |
| `backend/src/db/test-utils.ts` | 新增 | `createTestDb()` 测试辅助 |
| `backend/src/db/repositories/game.repository.ts` | 重写 | 实现 CRUD + Row↔Domain 映射 |
| `backend/src/db/repositories/npc.repository.ts` | 重写 | 实现 CRUD + 记忆管理 |
| `backend/src/db/repositories/world.repository.ts` | 重写 | 实现 CRUD |
| `backend/src/db/repositories/player.repository.ts` | 重写 | 实现 CRUD + 任务管理 |
| `backend/src/db/repositories/storyline.repository.ts` | 重写 | 实现 CRUD |
| `backend/src/db/repositories/llm-log.repository.ts` | 重写 | 实现 CRUD + 聚合查询 |
| `backend/src/game/game.service.ts` | 重写 | 注入 Repository，改用 DB 读写 |
| `backend/src/game/game.module.ts` | 修改 | 注册 Repository providers |
| `backend/src/**/*.spec.ts` | 新增 | 各 Repository 单元测试 + GameService 集成测试，使用 SQLite `:memory:` |

## 验收标准

| # | 标准 |
|---|------|
| AC-1 | `npm install` 后 `better-sqlite3` 编译成功（Windows/macOS/Linux） |
| AC-2 | 服务启动时自动创建 `data/talking-legend.db` + 执行 migration |
| AC-3 | `POST /api/game` 创建游戏，数据持久化到 DB；重启服务后 GET 仍可获取 |
| AC-4 | `POST /api/game/:id/action` 处理动作后 turn 递增，更新写入 DB |
| AC-5 | 新增 Repository 层测试覆盖率 ≥ 80%（当前代码库无已有测试，无需兼容） |
| AC-6 | 每个 Repository 有独立单元测试，使用 SQLite in-memory DB（`:memory:`），不 mock Database 实例 |
| AC-7 | `DELETE FROM games WHERE id = ?` 级联删除 worlds/npcs/players/storylines/llm_logs |
| AC-8 | 不配 LLM key 时服务不崩溃（骨架模式）——本 RFC 不改 LLM 行为 |
| AC-9 | `npm run dev` 启动速度与重构前差异 < 500ms |

### 测试策略

`better-sqlite3` 是原生模块，在 vitest 中 mock `Database` 类成本高且不可靠。采用 **真实 SQLite in-memory DB** 策略：

1. **Repository 测试**：使用 `:memory:` 数据库，每个测试或每个 describe 块创建新的 Database 实例并执行 migration
2. **GameService 测试**：注入真实 Repository（连接到 `:memory:` DB），做轻量集成测试
3. **DbModule.forRoot()** 支持 `dbPath: ':memory:'` 用于测试注入

```typescript
// 测试辅助：创建测试用 DB 实例
// backend/src/db/test-utils.ts
import Database from 'better-sqlite3';
import { migrate } from './migrate';

export function createTestDb(): Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
```

```typescript
// game.repository.spec.ts 示例
describe('GameRepository', () => {
  let db: Database;
  let repo: GameRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new GameRepository(db);
  });

  afterEach(() => db.close());

  it('insert and findById', () => {
    const row: GameRow = { id: 'g1', player_name: 'Test', turn: 0, phase: 'intro', created_at: now, updated_at: now };
    repo.insert(row);
    expect(repo.findById('g1')).toMatchObject({ id: 'g1', player_name: 'Test' });
  });
});
```

**trade-off 说明**：in-memory SQLite 测试本质上是轻量集成测试而非纯单元测试。但对 `better-sqlite3` 这种原生模块，"真 DB"比"mock 原生模块"更可靠、更接近生产行为、且测试速度仍然很快（in-memory DB 创建 < 5ms）。

## JSON 字段 Schema 演进策略

`regions`、`inventory`、`reputation`、`stage_data` 等字段以 JSON TEXT 存储。当对应 TypeScript 接口新增字段时（如 RFC-003 可能给 `Region` 增加 `climate` 字段），已持久化的旧 JSON 数据不会自动包含新字段。

**策略**：接受"新字段 = 默认值"为预期行为，Repository 在反序列化时负责填充默认值。

```typescript
// world.repository.ts — 反序列化 + 默认值填充
function deserializeWorld(row: WorldRow): WorldState {
  const regions: Region[] = JSON.parse(row.regions);
  return {
    name: row.name,
    description: row.description,
    currentRegion: row.current_region,
    timeOfDay: row.time_of_day,
    weather: row.weather,
    regions: regions.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      connectedRegions: r.connectedRegions ?? [],
      // 未来新增字段在此处补默认值：
      // climate: r.climate ?? 'temperate',
    })),
    globalEvents: JSON.parse(row.global_events),
  };
}
```

**演进原则**：
- 新增字段必须可空或有合理默认值——不对存量数据执行 JSON 迁移脚本
- 如果某字段的默认值无法合理定义（即"必须存在才能玩"），则不应作为 JSON 存储，而应独立成列或独立成表
- 不在 JSON 根对象中嵌入版本号（`_v`）——当前规模下版本号管理成本超过收益。如果将来 JSON 结构发生破坏性变更，通过标准 migration（ALTER TABLE + UPDATE 批量重写 JSON）处理

## 依赖

- **前置**: RFC-001（NestJS 模块化重构）— 已完成
- **后续**: RFC-003（世界配置加载）、RFC-005（LLM 引擎）、RFC-008（World 业务逻辑）、RFC-009（Storyline 业务逻辑）

## 不在范围

- 世界配置加载（RFC-003）
- LLM 引擎实现（RFC-005/006/007）
- NPC/World/Storyline 模块的实际业务逻辑（仅数据层）
- 数据迁移/导入导出工具
- 查询性能优化（索引已包含基础覆盖，后续按需补充）

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| `better-sqlite3` 在 Windows 上编译失败 | 中 | 高 | 提供 prebuild 备选或 `sql.js` fallback；README 补充 Windows 编译依赖说明 |
| 并发请求导致读-改-写竞态 | 低 | 高 | `db.transaction()` 包裹多步写操作；乐观锁（`UPDATE ... WHERE turn = ?`）作为防御层 |
| Schema 版本迁移脚本 bug 导致数据丢失 | 低 | 高 | 迁移包裹事务；失败时 `_schema_version` 不递增并阻止启动；仅做 CREATE TABLE，不做 ALTER/DROP |
| Repository 接口随后续 RFC 频繁变更 | 中 | 中 | 本 RFC 定义的 Repository 接口侧重基础 CRUD，后续按需扩展方法，不修改已有签名 |
| JSON 字段查询性能不足 | 低 | 低 | `regions`/`inventory` 等 JSON 字段始终随主行一起读写，不做 JSON 内部查询；如需路径查询，SQLite `json_extract` 已足够 |
| `better-sqlite3` 原生模块 mock 困难 | 中 | 低 | Repository 测试使用 SQLite `:memory:` 而非 mock Database |
| JSON 字段 Schema 演进导致旧数据不兼容 | 低 | 中 | Repository 反序列化时填充默认值；新增字段必须可空或有合理默认值 |
