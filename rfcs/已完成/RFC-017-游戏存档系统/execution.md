# RFC-017 Execution: 游戏存档系统

> **开始**: 2026-07-31
> **完成**: 2026-07-31

## 任务清单

### 后端
- [x] v5 migration: `saves` 表 (slot/player_name/turn/region/world/saved_at)
- [x] `db/repositories/save.repository.ts`: CRUD
- [x] `game/game.service.ts`: `saveGame()` + `loadSave()` + `deleteSave()` + `listSaves()`
- [x] `game/game.controller.ts`: POST save/load/delete + GET list 端点

### 前端
- [x] `services/api.ts`: `saveGame()` `loadSave()` `listSaves()` `deleteSave()`
- [x] `components/game/SaveManager.tsx`: 居中模态弹窗 + 槽位列表
- [x] `components/game/GameHeader.tsx`: 💾 按钮（与 ⚙ 并列）
- [x] `components/game/GameScreen.tsx`: 集成 SaveManager + 自动存档（每5回合）

### 验收
- [x] typecheck 零错误
- [x] build 成功
- [x] 247/247 测试通过
- [ ] Playwright 手动验证（待重拉测试）

## 实现总结

### 后端
- `db/migrate.ts` v3: `saves` 表，slot 0-5
- `db/repositories/save.repository.ts`: upsert/findAll/findBySlot/delete
- `db/db.module.ts`: 注册 SaveRepository
- `game/game.service.ts`: 
  - `saveGame(gameId, slot)`: 写 saves 表 + `fs.copyFileSync` 复制 DB → `data/saves/slot_N.db`
  - `listSaves()`: 查 saves 表
  - `loadSave(slot)`: 验证文件存在 → 返回 meta
  - `deleteSave(slot)`: 删行 + `fs.unlinkSync`
- `game/game.controller.ts`:
  - `GET :id/saves` → 列表
  - `POST :id/save {slot}` → 保存
  - `POST saves/:slot/load` → 复制文件 + 返回成功
  - `DELETE saves/:slot` → 删除

### 前端
- `services/api.ts`: SaveMeta 类型 + 4 个 API 函数
- `SaveManager.tsx`: daisyUI modal，自动存档(只读) + 手动槽位1-5
  - 空槽位: [保存到此]
  - 有存档: 元数据 + [读取](二次确认) + [覆盖] + [删除]
- `GameHeader.tsx`: 💾 按钮
- `GameScreen.tsx`: SaveManager 集成 + auto-save useEffect(turn%5===0 → saveGame(id,0))
