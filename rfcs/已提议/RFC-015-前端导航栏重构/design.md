# RFC-015: 前端导航栏重构 — 技术设计

> **状态**: 设计中
> **创建**: 2026-07-30

## ADR — 架构决策

### ADR-1: 导航栏组件树

**决策**: 采用复合组件模式，`TopNavBar` 作为容器，内部各信息模块为独立子组件。

**理由**:
- 各信息模块独立更新（回合变化不触发区域信息重渲染）
- 未来可以按需显示/隐藏子模块
- 符合 RFC-010 的组件化方向

**替代方案**: 单体 `TopNavBar` 组件——简单但不可扩展，被否决。

### ADR-2: 右侧信息面板的处理方式

**决策**: 混合策略——关键状态信息进入顶部导航栏，详细信息改为悬浮/可折叠方式。

| 信息类型 | 展示方式 | 位置 |
|----------|----------|------|
| 当前位置 + 区域名 | 顶部导航栏常驻 | 导航栏左侧 |
| 区域描述 | 鼠标悬停 tooltip / 点击弹出 Popover | 导航栏区域名上 |
| 可前往区域列表 | 点击区域名展开下拉菜单（同时作为切换区域的交互） | 导航栏 |
| 回合/时间/天气 | 顶部导航栏常驻图标+文字 | 导航栏中部 |
| 任务摘要 | 徽标数字 + 点击展开任务面板（Popover） | 导航栏右侧 |
| 附近 NPC 列表 | NPC 头像/图标 + 数量徽标，点击展开 NPC 列表 Popover | 导航栏右侧 |
| 配置按钮 | 齿轮图标 | 导航栏最右侧 |

**理由**: 信息分层——高频概览信息常驻导航栏；详情按需展示，不占用常驻空间。

### ADR-3: 区域切换交互

**决策**: 点击导航栏中的区域名弹出下拉菜单，列出所有可到达区域，点击即可切换（需后端支持区域移动 API）。

**注意**: 区域移动 API 可能属于 RFC-005 或尚未实现。初期可仅展示可到达区域列表，切换功能标记为 TODO。

### ADR-4: 入口页导航栏

**决策**: 入口页 (GameSetup) 保持简洁，仅右上角配置齿轮。待 RFC-010 组件化后再统一导航栏结构。当前阶段游戏页的导航栏与入口页可以不一致。

## 组件树设计

```
App
├── GameSetup (/)
│   └── 右上角齿轮按钮 (已有)
├── GameScreen (/game/:gameId)
│   ├── TopNavBar (新增)
│   │   ├── WorldTitle (世界名，可点击回首页)
│   │   ├── RegionSwitcher (当前位置 + 可前往区域下拉)
│   │   ├── GameStatusBar (回合 · 时间 · 天气)
│   │   ├── QuestBadge (任务摘要)
│   │   ├── NpcPresenceIndicator (附近NPC)
│   │   └── ConfigButton (齿轮)
│   ├── NarrativePanel (全宽，去掉右侧 sidebar)
│   └── ActionBar (底部输入栏，保持不变)
└── ConfigScreen (Modal，不变)
```

## 样式方案

延续当前内联 `<style>` 标签方案（在 RFC-010 引入 Tailwind 之前）。导航栏样式：

```css
.top-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1.5rem;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-secondary);
  height: 48px;
  gap: 1rem;
}

.nav-left   { display: flex; align-items: center; gap: 1rem; }
.nav-center { display: flex; align-items: center; gap: 0.75rem; }
.nav-right  { display: flex; align-items: center; gap: 0.5rem; }
```

三区布局（左-中-右），flex 自适应。

## 对现有代码的改动清单

### GameScreen.tsx

1. **移除** `info-sidebar` 整个 `<aside>` 块及其所有子元素
2. **重构 header** → `TopNavBar`：
   - `game-world-name` → `nav-left` 区（可点击回首页）
   - 新增区域下拉组件 → `nav-left` 区
   - `game-info`（回合/时间/天气）→ `nav-center` 区
   - 新增任务徽标 → `nav-right` 区
   - 新增 NPC 指示器 → `nav-right` 区
   - 齿轮按钮 → `nav-right` 区
3. **调整布局** CSS：
   - `.game-main` 去掉 `display: flex`，叙事面板变为全宽单列
   - 移除所有 `.info-sidebar` / `.info-section` 相关样式
   - 新增 `.top-nav` 相关样式
4. **数据保持**：区域信息、任务列表、NPC 列表仍从 `gameState` 读取（逻辑不变）

### GameSetup.tsx

- 暂不改动，保持现有设计。后续 RFC-010 统一组件化时再同步。

### App.tsx

- 暂不改动。`TopNavBar` 作为 `GameScreen` 内部组件管理。

### index.css

- 移除侧边栏相关全局样式（如有）
- 新增导航栏相关 CSS 自定义属性（如有需要）

## 风险与注意事项

1. **信息密度平衡**：顶部导航栏空间有限，需注意文字截断和响应式处理
2. **移动端适配**：当前设计面向桌面端，顶部导航栏在小屏幕上可能需要折叠为汉堡菜单（不在本次范围）
3. **与 RFC-010 时序**：如果 RFC-010（组件化重构）先执行，本 RFC 应在新组件结构上实现；如果本 RFC 先执行，应用内联样式实现，后续 RFC-010 再抽取为独立组件
4. **区域切换 API**：当前 `gameState.world.regions` 和 `connectedRegions` 已有数据，但实际切换区域的 API 端点需确认是否存在
