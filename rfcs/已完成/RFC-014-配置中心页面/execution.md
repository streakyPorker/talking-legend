# RFC-014 配置中心页面 — 验证报告

**验证日期**: 2026-07-29
**后端端口**: 4001
**config.toml 路径**: `D:\codebase\gaming\talking-legend\config.toml`
**构建方式**: `npm run build -w backend` (SWC + tsc --noEmit)

---

## 启动日志

```
[Nest] 6396  -   LOG [NestFactory] Starting Nest application...
[Nest] 6396  -   LOG [ConfigService] Settings loaded from C:\Users\26981\.claude\settings.json
[Nest] 6396  -   LOG [ConfigService] Config loaded from D:\codebase\gaming\talking-legend\config.toml
[Nest] 6396  -   LOG [InstanceLoader] AppModule dependencies initialized +4ms
...
[Nest] 6396  -   LOG [RoutesResolver] ConfigController {/api/config}: +6ms
[Nest] 6396  -   LOG [RouterExplorer] Mapped {/api/config, GET} route +4ms
[Nest] 6396  -   LOG [RouterExplorer] Mapped {/api/config, PUT} route +1ms
...
[Nest] 6396  -   LOG [NestApplication] Nest application successfully started +2ms
Talking Legend backend running on http://localhost:4001
```

ConfigController GET/PUT 路由正确注册。

---

## Step 2: GET /api/config — 返回 8 个 section

```json
curl -s http://localhost:4001/api/config
```

输出（解析后）：

```
[anthropic] 模型配置  restartRequired=true
  opus_model = deepseek-v4-pro  (text, hotReload=false)
  sonnet_model = deepseek-v4-flash  (text, hotReload=false)
  haiku_model = deepseek-v4-flash  (text, hotReload=false)
[model_tiers] 模型层级前缀  restartRequired=true
  opus = claude-opus-4, deepseek-v4-pro  (text, hotReload=false)
  sonnet = claude-sonnet-4, deepseek-v4-flash  (text, hotReload=false)
  haiku = claude-haiku-4, deepseek-v4-lite  (text, hotReload=false)
[server] 服务器  restartRequired=true
  port = 4001  (number, hotReload=false)
[llm.max_tokens] Token 预算 (max_tokens)  restartRequired=false
  opus = 40960  (number, hotReload=true)
  sonnet = 5120  (number, hotReload=true)
  haiku = 512  (number, hotReload=true)
[llm.thinking] Extended Thinking  restartRequired=false
  opus_budget = 4096  (number, hotReload=true)
  sonnet_budget = 2048  (number, hotReload=true)
[llm.context_budget] 上下文预算  restartRequired=false
  opus = 180000  (number, hotReload=true)
  sonnet = 50000  (number, hotReload=true)
  haiku = 8000  (number, hotReload=true)
[llm.stream] 流式超时  restartRequired=false
  timeout_ms = 90000  (number, hotReload=true)
[npc] NPC 对话  restartRequired=false
  history_rounds = 20  (number, hotReload=true)
```

**检查项**: 8 sections, 每 section 含 key/label/restartRequired, 每 item 含 key/label/value/type/hotReload。value 从 config.toml 正确读取。

---

## Step 3: PUT /api/config — 热加载

### 请求

```
curl -s -X PUT http://localhost:4001/api/config \
  -H "Content-Type: application/json" \
  -d '{"changes":{"llm.max_tokens.opus":99999}}'
```

### 响应

```json
{"applied":["llm.max_tokens.opus"],"restartRequired":[],"errors":[]}
```

### GET 验证

```
llm.max_tokens.opus = 99999 (expected 99999)
hotReload = true
```

### config.toml 文件验证

```
grep "opus = 99999" config.toml
opus = 99999
```

**热加载成功**: applied 含此项, restartRequired 为空, GET 读到新值, config.toml 已写入。

---

## Step 4: PUT /api/config — 需重启项

### 请求

```
curl -s -X PUT http://localhost:4001/api/config \
  -H "Content-Type: application/json" \
  -d '{"changes":{"anthropic.opus_model":"test-model"}}'
```

### 响应

```json
{"applied":["anthropic.opus_model"],"restartRequired":["anthropic.opus_model"],"errors":[]}
```

### 验证热加载项不受影响

```
llm.max_tokens.opus = 99999 (still 99999)
```

**重启标记正确**: `anthropic.opus_model` 同时出现在 applied 和 restartRequired。config.toml 中 `opus_model = "test-model"` 已写入。热加载项的 99999 不变。

---

## Step 5: TOML 注释保留

```
grep -c "^#" config.toml
13
```

所有 13 行注释完整保留。包含内联注释：

```
sonnet = 5120    # 5x 原值 1024
```

**注释保留**: 全部注释行 + 内联注释均未被删除或修改。

---

## Step 6: 原功能正常

### Health Check

```json
{"success":true,"data":{"status":"ok"}}
```

### GM Narrative SSE Stream

```
curl -s -N -X POST /api/game/<id>/action/stream -d '{"action":"look around","target":"village"}'

data: {"type":"chunk","content":"晨"}
data: {"type":"chunk","content":"光"}
data: {"type":"chunk","content":"洒"}
data: {"type":"chunk","content":"在"}
data: {"type":"chunk","content":"石"}
data: {"type":"chunk","content":"辉"}
data: {"type":"chunk","content":"村"}
data: {"type":"chunk","content":"的"}
data: {"type":"chunk","content":"石"}
data: {"type":"chunk","content":"板"}
data: {"type":"chunk","content":"路"}
data: {"type":"chunk","content":"上"}
data: {"type":"chunk","content":"，"}
data: {"type":"chunk","content":"清"}
data: {"type":"chunk","content":"凉"}
...
```

### NPC Dialogue SSE Stream

```
curl -s -N -X POST /api/game/<id>/npc/<npcId>/talk/stream -d '{"message":"hello elder"}'

data: {"type":"chunk","content":"长老"}
data: {"type":"chunk","content":"马林缓缓抬起头，浑浊"}
data: {"type":"chunk","content":"的双眼望向声音"}
data: {"type":"chunk","content":"传来的方向，嘴角"}
data: {"type":"chunk","content":"浮现出一丝温和"}
data: {"type":"chunk","content":"的笑意。\n\n\"啊"}
data: {"type":"chunk","content":"，远道而来的旅人"}
data: {"type":"chunk","content":"。你的问候如同"}
data: {"type":"chunk","content":"清晨的第一缕阳光，温暖"}
data: {"type":"chunk","content":"而真诚。欢迎"}
data: {"type":"chunk","content":"来到石辉村"}
data: {"type":"chunk","content":"，年轻人。我是"}
data: {"type":"chunk","content":"这里的老人，大家都"}
data: {"type":"chunk","content":"叫我..."}
```

**GM 叙事流和 NPC 对话流均正常工作**。

---

## Step 7: 恢复 config.toml

```
git checkout config.toml
```

成功恢复。末尾 `opus = 99999` 和 `opus_model = "test-model"` 已清除。

---

## 验证结论

| 步骤 | 验证项 | 结果 |
|------|--------|------|
| 2 | GET 返回 8 sections, 含 key/label/restartRequired, 每 item 含 key/label/value/type/hotReload | PASS |
| 3 | PUT 热加载 `llm.max_tokens.opus` → 99999, restartRequired 为空, GET 反射, TOML 写入 | PASS |
| 4 | PUT `anthropic.opus_model` → "test-model", applied+restartRequired 同时含, 热加载项不受影响 | PASS |
| 5 | TOML 注释 13 行 + 内联注释完整保留 | PASS |
| 6 | Health check 正常, GM SSE 流正常, NPC SSE 流正常 | PASS |
| 7 | config.toml git checkout 恢复 | PASS |

**所有验证项通过。RFC-014 配置中心后端 API 功能完成。**

---

## Step 8: Playwright 中度体验（2026-07-30）

| 页面 | 截图 | 关键体验检查 |
|------|------|-------------|
| 入口页 (`/`) | [entry-page.png](./rfc14-entry-page.png) | 布局居中正常，gear 按钮右上角无重叠，输入框可用 |
| 游戏页 (`/game/:id`) | [game-page.png](./rfc14-game-page.png) | Header 无重叠：world name + game-info + gear 按钮正常排列；sidebar + narrative + input 完整 |
| 配置面板 | [config-panel.png](./rfc14-config-panel.png) | 8 sections 全部展示，热加载/需重启标记正确，值正确加载，保存按钮初始 disabled |
| 路由验证 | — | `/` ↔ `/game/:id` 跳转正常，URL 同步更新 |
| 入口页最终 | [entry-final.png](./rfc14-entry-final.png) | 关闭配置后返回入口页正常，无残留元素 |

**Playwright 结论**：无关键体验问题。布局、路由、配置面板均正常。
