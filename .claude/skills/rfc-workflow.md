# RFC 开发全流程

## 阶段总览

```
提议 → 设计(grill-me深度访谈) → 审查加固(Sonnet并行) → 实现(并行agent) → 验证 → 归档
```

---

## Phase 1: 设计（grill-me 深度访谈）

**目标**：在动手写代码前，通过逐层追问把每一个决策树走到底。

**流程**：
1. 写 `design.md` 初稿（架构图 + 设计决策表 + 伪代码）
2. 调 `/grill-me`，从最阻塞的决策开始，一次一个问题，深度优先遍历
3. 每个决策收敛后立即写进 design.md，不等到最后
4. 输出：design.md v2（所有决策树闭合，无未决分支）

**关键原则**：
- 先探索代码再问问题（不凭空问"你觉得能不能..."）
- 提供推荐答案 + 一句话理由，让用户做选择题而非开放题
- 涉及 UI 的地方画 ASCII 线框图确认

---

## Phase 2: 审查加固（Sonnet 并行多轮）

**目标**：用独立 agent 从不同视角对抗审视设计，发现盲区。

**流程**：
1. 派遣 2-3 路 Sonnet agent 并行审查：
   - **架构审查**：NestJS DI、模块边界、事务一致性、数据注入
   - **LLM 机制审查**：Prompt 设计、流式协议、Token 预算、记忆策略
   - **安全+边界审查**：输入校验、TOML 写入、并发、类型安全
2. 汇总发现，标注严重度（🔴/🟡/🟢），写进 design.md §审查修复清单
3. 修改 design.md 修复所有 🔴 和 🟡 问题
4. **再做一轮扫描**，确认零新增 🔴
5. 输出：design.md v3（审查加固完成，可开工）

**agent 提示词模板**：
```
你是 [角度] 审查员。请审查 RFC-XXX 设计文档，从 [具体角度] 找出所有问题。
必读文件: [design.md + 相关源码文件列表]
输出: 每个问题标注严重度 + 文件行号 + 修复建议
```

---

## Phase 3: 实现（并行 agent 文件级隔离）

**目标**：按文件变更清单拆分独立任务，并行分派 Sonnet agent 实现。

**流程**：
1. 从 design.md §文件变更清单提取任务，确保文件级隔离（任意两个 agent 不修改同一文件）
2. 按依赖关系分 Wave：
   - Wave 1：无依赖的基础层（LLMClient、工具类）
   - Wave 2：依赖 Wave 1 的中间层（引擎、Provider）
   - Wave 3：集成层（Controller、Module 注册）
3. 每个 agent 提示词包含：
   - 必读文件列表（精确路径）
   - 任务描述（从 design.md 复制的伪代码 + 约束）
   - 验证命令（`npm run typecheck`、`npm test`）

**agent 提示词模板**：
```
你是后端开发者。请按 RFC-XXX 设计实现 [具体模块]。
必读文件: [列表]
任务: [伪代码 + 接口签名 + 约束]
完成后运行: npm run typecheck -w backend
```

---

## Phase 4: 验证（完工铁律）

**目标**：证明代码在真实环境中可用。

**后端 RFC 完工检查**：
1. `npm run typecheck` 零错误
2. `npm run build` 编译成功
3. `npm test` 全量通过
4. `node dist/main.js` 启动 → 路由映射全部打印
5. `curl` 调用核心 API → 返回有效响应
6. 非法请求 → 结构化错误
7. 证据写入 `execution.md`

**前端 RFC 完工检查**：
1. `tsc --noEmit` + `npm test` 全通过
2. `vite build` 构建成功
3. 后端在跑时 `vite dev` 启动，浏览器不白屏
4. 核心交互链路可走通

**Playwright 中度体验**（所有 RFC 必做）：
1. 导航到入口页 (`/`) → 截图：确认布局正常、无重叠、输入可用
2. 创建/进入游戏页 (`/game/:id`) → 截图：确认 header/sidebar/输入框无关键体验问题
3. 打开配置面板 → 截图：确认各 section 可展开、可编辑、保存/重置可用
4. 路由跳转验证：`/` ↔ `/game/:id` URL 同步，前进/后退正常
5. 截图写入 `execution.md`，标注发现的问题（如有）

---

## Phase 5: 归档

1. `execution.md` 补充完工证据（启动日志 + curl 响应 + 截图）
2. 更新 proposal.md / design.md 状态 → `已完成`
3. 移动 RFC 目录：`正在进行/` → `已完成/`
4. 更新 `CLAUDE.md` RFC 进度表
5. **审视并更新 CLAUDE.md**（必做，不可跳过）：
   - 新增的模块/服务/引擎 → 写入 Architecture 对应子节
   - 新增的命令/npm scripts → 写入 Commands 表
   - 新增或变更的配置项 → 写入 Config 表
   - 新发现的 gotcha/反模式 → 写入 Backend gotchas
   - 新增的可复用代码模式 → 更新本 skill 的 §可复用代码模式
   - 确认 RFC 进度表状态与 `rfcs/` 目录一致
6. Git commit: `docs(rfcNNN): RFC-XXX 归档 — 同步 CLAUDE.md`
7. `git push`

**CLAUDE.md 更新原则**：目标是让后续 `/init` 只需读 CLAUDE.md + 几次 codegraph 搜索 + RFC 进度表，即可快速掌握项目全貌，不需要大量读文件。每次 RFC 完工后，CLAUDE.md 就是项目的"最新快照"。

---

## 提交前缀

| 前缀 | 格式 | 示例 |
|------|------|------|
| 新功能 | `feat(rfcN): ...` | `feat(rfc5): LLMClient 重构` |
| Bug 修复 | `fix(rfcN): ...` 或 `fix(bfN): ...` | `fix(rfc14): whitelist 校验` |
| 配置/依赖 | `chore: ...` | `chore: config.toml 配置中心` |
| 文档 | `docs: ...` | `docs: RFC-004 归档` |

---

---

## Bug 跟踪

所有 bug 必须有记录。使用项目级 `bugfix/` 目录，三层文件夹 + 单文件格式。

### 目录结构
```
bugfix/
  待修复/           ← bug 已识别，尚未开始
  修复中/           ← 正在修复
  已修复/           ← 修复完成并验证
```

### 单文件格式
一个 bug 一个文件：`bugfix/{状态}/BF-NNN-简短描述.md`

```markdown
# BF-NNN: 简短标题

> **状态**: 待修复 | 修复中 | 已修复
> **发现**: YYYY-MM-DD
> **修复**: YYYY-MM-DD

## 描述
现象、复现步骤、影响范围。

## 修改计划
根因分析 + 修改方案 + 涉及文件。

## 修改后结果
做了什么、测试结果、验证证据。
```

### 流转
```
发现 bug → bugfix/待修复/BF-NNN.md
开始修 → bugfix/修复中/BF-NNN.md（写入修改计划）
修完验证 → bugfix/已修复/BF-NNN.md（写入结果+证据）
          → 审视并更新 CLAUDE.md（必做，同 RFC 归档的 CLAUDE.md 维护清单）
```

### Bugfix CLAUDE.md 维护
Bugfix 完成后，逐项确认是否需要更新 CLAUDE.md：
- 修复是否涉及模块/架构变更 → 更新 Architecture
- 是否新增或修改了命令/脚本行为 → 更新 Commands
- 是否涉及配置变更 → 更新 Config
- 是否发现了值得记录的 gotcha → 更新 Backend gotchas
- 是否产生了可复用的修复模式 → 更新本 skill 的 §可复用代码模式

### 提交前缀
```bash
fix(bfNNN): 简短描述
```

---

## 新建 RFC 文件清单

```
rfcs/已提议/RFC-NNN-标题/proposal.md   ← 问题+动机
rfcs/正在进行/RFC-NNN-标题/design.md   ← 决策+架构+伪代码+文件清单
rfcs/已完成/RFC-NNN-标题/execution.md  ← 验证证据
```

---

## 可复用代码模式

**SSE 端点**: `@Res() Response` + `text/event-stream` + `for-await` + `writableEnded` 保护。参考 `GameController`。

**ContextProvider**: `读DB → 创建Module → setData() → Map → ContextBuilder.build()`。GM=5模块, NPC=5模块。

**两阶段事务**: Phase1 `db.transaction` 同步快照+turn bump → Phase2 异步 LLM → Phase3 同步日志。

**配置优先级**: `process.env > settings.json > config.toml > 硬编码`。行级替换保留注释，`config.default.toml` 为重置模板。

**Agent 分发**: 文件级隔离（并行 agent 文件清单零交集），Wave 1→2→3 按依赖分阶段。

---

## 反模式（禁止）

- ❌ 跳过 grill-me 直接写代码 → 决策未闭合，返工
- ❌ 单 agent 审查 → 视角单一，盲区不发现
- ❌ 两个 agent 修改同一文件 → merge conflict
- ❌ 只跑单元测试就声称完工 → 必须 `curl` 验证 + 写 `execution.md`
- ❌ 长时间保留未提交变更 → 每次修改完立即 commit + push
- ❌ 无 commit 前缀 → `git blame` 无法追溯
- ❌ 手动启停服务 → 始终用 `bash dev.sh restart`，避免端口残留
- ❌ 发现 bug 不记录 → 必须写 bugfix 文件，修完归档
