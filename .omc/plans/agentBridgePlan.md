# Toonflow 桥接本地官方 Agent 引擎 · 实施计划

上游 spec：`.omc/specs/deep-interview-agentBridge.md`（deep-interview 定稿，歧义 19.5%）。
本计划为一期（claude code）文件级实施方案，产出前基于以下精读事实。

## 0. 精读结论（计划依据）

| 事实 | 出处 | 对计划的影响 |
| --- | --- | --- |
| 前端 `applyEvent`/`createReplyStream` 已处理全部 `AgentEvent`（text/thinking/tool/question/userMessage/subAgent/compaction/stats/canvasCall） | `apps/web/src/components/agent/conversation.vue:224-243`、`replyStream.ts` | **前端渲染零改动**，只加引擎选择 |
| 会话文件 = Pi SDK `SessionManager` JSONL；列表/改名/删除/历史读取全部基于该格式 | `apps/server/src/agent/runtime/sessions.ts:223-378`、`routes/agent/{list,get,rename,message}.ts` | claude 引擎**复用 Pi 格式落盘** → 会话管理全链路零改动 |
| `getMcpRuntime().stdio` 直接返回 stdio 桥 spawn 配置 `{command, args}` | `apps/server/src/utils/mcp/runtime.ts:89-101` | MCP 注入 = 生成一份 `--mcp-config` JSON，**零新桥接开发** |
| 提问桥 `createQuestionContext`/`answerQuestion` 是模块级 Map + Promise 挂起 | `apps/server/src/agent/bridge/question.ts` | MCP `askUser` 工具直接复用提问桥，前端答题卡片零改动 |
| `run()` 与 Pi SDK 深耦合（SessionManager/文件锁/activeSessions） | `apps/server/src/agent/runtime/index.ts:40-383` | 不改 `run()`，**平行新增** claude 引擎运行时，路由层分流 |
| 平台技能 = 标准 SKILL.md，`loadAgentSkills(cwd)` 已有扫描 | `apps/server/src/agent/skills/index.ts:9-21` | 技能注入 = 复制目录到 `<cwd>/.claude/skills/` |
| 引擎自带的 canvas 桥（`canvasCall`）与 claude 场景无关（claude 走 MCP 操作画布） | `routes/agent.ts:36` | claude 会话不传 `canvas` 参数即可 |

## 1. 架构设计

```
前端 conversation.vue ── POST /api/agent {engine:"claude-code", ...}
                              │
                     routes/agent.ts（engine 字段分流）
                    ┌─────────┴──────────┐
              engine=builtin        engine=claude-code
                    │                    │
          agent/runtime/index.ts   agent/engines/claudeCode.ts（新）
               （现有 run，不动）      ├─ spawn claude CLI（-p stream-json）
                    │                 ├─ claudeStream.ts：stream-json → AgentEvent
                    │                 ├─ 复用 SessionManager 落盘（Pi 格式）
                    │                 ├─ --resume 续接（toonflowEngine entry 存映射）
                    │                 ├─ MCP 注入（--mcp-config ← getMcpRuntime().stdio）
                    │                 └─ 技能注入（.claude/skills 同步）
                    ▼
              NDJSON AgentEvent 流（两引擎同协议，前端无感）
```

**引擎抽象策略（刻意从简）**：不建注册表接口——一期只有两个引擎，分流就是一个 `if`；等 codex 二期落地时若出现第三处分支再抽。`engines/` 目录约定本身就是抽象预留。

## 2. 文件级改动清单

### 新增

| 文件 | 职责 |
| --- | --- |
| `apps/server/src/agent/engines/claudeCode.ts` | 引擎主流程 `runClaudeCode(options, send)`：会话打开/创建（复用 `createAgentConversation`/`SessionManager`）、运行环境准备（MCP config、技能同步、系统提示追加）、spawn、abort/超时、resume 降级重跑、落盘 flush、注册 activeSessions 防并发 |
| `apps/server/src/agent/engines/claudeStream.ts` | stream-json 逐行解析器：`claudeStreamSession(options)` 返回事件回调（`onEvent(AgentEvent)`、`onEntry(Pi entry 累积)`、`onSessionId(id)`）；纯翻译无 IO，便于验证 |
| `apps/server/src/agent/engines/claudeEnv.ts` | 运行环境准备：CLI 路径探测（settings 覆盖 → PATH/常见安装位）、`--mcp-config` 临时文件生成、`<cwd>/.claude/skills/` 技能同步（`.toonflowInjected` 标记，只管自己写的目录）、系统提示追加文本 |
| `apps/server/src/routes/agentEngine/status.ts` | GET：CLI 探测结果（找到与否、路径、版本），供设置面板"测试"按钮 |
| `apps/web/src/components/settings/panels/agentEngine.vue` | 设置面板：CLI 路径覆盖、模型覆盖（`--model`）、单轮超时（默认 10 分钟）、状态测试按钮 |

### 修改

| 文件 | 改动 |
| --- | --- |
| `apps/server/src/routes/agent.ts` | inputSchema 增加 `engine: z.enum(["builtin","claude-code"]).optional()`；`providerId/modelId` 改为 engine=claude-code 时可选（`z.string().min(1).when("engine",{is:"claude-code",then:s=>s.optional(),otherwise:s=>s})` 或直接双双 optional + 运行时校验）；分流调用 |
| `apps/server/src/agent/runtime/sessions.ts` | 导出引擎映射 entry 读写辅助：`getEngineInfo(history)`（读最后一条 `toonflowEngine` custom entry）——落盘写侧由 claudeCode.ts 用现有 `appendCustomEntry` 完成，不加新 API |
| `apps/server/src/utils/mcp/tools.ts` | 新增 `askUser` MCP 工具：从 engines 模块的进程内注册表取当前 claude 会话的 `QuestionContext` → `ask()` 挂起 → 前端答题 `POST /api/agent/answer` 回流 resolve |
| `apps/server/src/utils.ts` | 导出新增模块（按现有出口方式） |
| `apps/web/src/components/agent/conversation.vue` | 模型选择器选项列表头部加"Claude Code（本地引擎）"项；选中时发送 body 带 `engine:"claude-code"`、省略 providerId/modelId；`initialSession.providerId === "claude-code"` 时自动选中；模型徽标对未知 providerId 容错显示 |
| `apps/web/src/stores/settings.ts`（按需） | agentEngine 设置字段透传 |

### 明确不动

- `agent/runtime/index.ts`（内置引擎零改动，防回归）
- `routes/agent/{list,get,rename,message,create,answer,skills}.ts`（Pi 格式兼容使然）
- `packages/mcp/src/*`（stdio 桥、/mcp 端点、control 通道原样复用）
- 前端 `replyStream.ts`、`toolMessage.vue`、`skillMenu.vue`（事件渲染就绪）

## 3. 事件映射表（claude stream-json → AgentEvent + Pi entry）

| claude 事件 | AgentEvent（NDJSON） | Pi entry 落盘 |
| --- | --- | --- |
| `system` init（含 `session_id`） | 无（捕获 sessionId） | 新会话追加 `toonflowEngine` custom entry `{engine:"claude-code", claudeSessionId}` |
| `stream_event` text_delta（`--include-partial-messages`） | `{type:"text", blockId:"{msg}:{i}", delta}` | 轮末统一 |
| `stream_event` thinking_delta | `{type:"thinking", blockId, delta}` | 轮末统一 |
| `assistant` 消息 `content[].type=text` | `{type:"text", blockId, content, done:true}`（无 partial 时由此承担） | assistant message entry（text part） |
| `assistant` `content[].type=thinking` | `{type:"thinking", blockId, content, done:true}` | assistant message entry（thinking part） |
| `assistant` `content[].type=tool_use` | `{type:"tool", blockId, tool:{id, name, args, status:"running"}}` | assistant entry toolCall part |
| `user` `content[].type=tool_result`（tool_use_id 关联） | `{type:"tool", tool:{id, status: isError?"error":"success", result}}` | toolResult message entry |
| `result` subtype=success | flush 落盘 → `{type:"done"}` 前置 stats | user 消息 entry（本轮 prompt）+ `toonflowUserMessage`（附件）+ `appendModelChange("claude-code", <CLI 模型名>)` |
| `result` is_error=true | `{type:"error", message}`；**无文本输出且带 --resume → 删映射重跑一次**（astrbot 实测协议） | 失败轮不落盘（保留用户消息 entry） |
| 子代理（tool_use name=`Task`，后续消息带 `parent_tool_use_id`） | 一期按普通工具卡片显示（args 含任务描述，前端现状即可读） | toolCall/toolResult 原样 |
| token 用量（result/usage） | `{type:"stats", stats:{tokens}}` | assistant entry usage 字段 |

blockId 约定 `{messageIndex}:{contentIndex}`，与内置引擎格式一致（仅影响当轮流式显示，历史重读由 `getAgentSession` 重新编号）。

## 4. 关键实现细节

### 4.1 spawn（`claudeEnv.ts` + `claudeCode.ts`）

```text
claude -p "<最新一条用户消息>"
  --output-format stream-json --verbose --include-partial-messages
  --resume <claudeSessionId>            # 仅续接时
  --permission-mode bypassPermissions   # 一期全放开；预留 --disallowed-tools 位置
  --mcp-config <dataDir>/claudeMcp.json
  --append-system-prompt "<平台上下文>"
  [--model <settings.agentEngine.model>]
```

- 用 `node:child_process` spawn（Bun 完整兼容），`windowsHide: true`（astrbot：无窗口宿主必加）。
- win32 CLI 解析：settings 路径 → `where.exe claude`（.cmd shim → `cmd /c` 包装或解析到真实 .exe）→ `~/.local/bin/claude.exe` 常见安装位。
- env 全量透传 `process.env`（用户 CLI 自己的 `ANTHROPIC_*` 认证生效，平台不注入凭证）。
- cwd = 会话工作区目录。
- 只发最新一条消息（引擎 `--resume` 自持上下文，宿主不重放历史——astrbot 实测）。
- 超时默认 10 分钟可配；abort → kill 进程树（win32 `taskkill /pid <pid> /T /F`）+ flush 已完成部分落盘。
- 每条消息 = 一次进程；进程级超时/kill 后即可重入。

### 4.2 MCP 注入

- 每次 spawn 前从 `u.mcp.getMcpRuntime()` 取 `stdio` 配置，写 `{"mcpServers":{"toonflow":{command, args}}}` 到 `dirname(conf.path)/claudeMcp.json`（覆盖写）。
- `stdio` 为 null（MCP 未启用）→ spawn 前报错"请先在设置中启用 MCP"，不静默降级。
- `askUser` 工具：`utils/mcp/tools.ts` 注册，handler 从 engines 的进程内注册表（`Map<cwd, QuestionContext>`，随 run 注册/注销）取上下文调 `ask()`；工具 schema 复用 `QuestionRequest` 结构（title/question/options/fields）。系统提示追加段写明"需要用户确认或补充信息时用 askUser 工具"。
- ACT: 注册表键 = 工作区目录（MCP 调用不带会话身份，只能按 cwd 路由）；同一工作区并行多个 claude 会话时按最后注册者优先，多会话并行问答路由是已知上限，届时升级注册键（如会话专属 mcp config + env 透传）。

### 4.3 技能注入（`claudeEnv.ts`）

- `loadAgentSkills(cwd)`（workspace + global 两作用域）→ 平铺复制到 `<cwd>/.claude/skills/<name>/`（整目录，含 references/）。
- 管理：只操作带 `.toonflowInjected` 标记的目录；用户在 `.claude/skills` 自建的技能不碰；平台技能删除后标记目录同步清理。
- 与宿主 `~/.claude/skills` 同名：不检测不合并（项目级与用户级共存，claude 项目级优先；spike S3 实测确认行为）。
- 工作区落一个 `.claude/` 目录属 claude code 生态惯例，可接受；不改用户 .gitignore。

### 4.4 会话落盘（复用 Pi SessionManager）

- 新会话：复用 `createAgentConversation(cwd)` 建 `.agent/sessions/<id>.jsonl`（含 header 落盘）。
- 每轮 result 后 flush：user entry（prompt + `toonflowUserMessage` 附件 custom entry）→ assistant entry（text/thinking/toolCall parts + usage）→ 各 toolResult entry → `appendModelChange("claude-code", model)`。
- 引擎映射：`appendCustomEntry("toonflowEngine", {...})` 追加式，读取取最后一条（`getEngineInfo`）。
- 并发防护：`registerAgentSession` 复用（`session` 字段留空，锁语义一致）。
- SDK 写入 API 以 `SessionManager` 实际类型为准（内置流的 toolResult entry 证明 SDK 支持该结构），实施时对照。

### 4.5 引擎与会话绑定

- `runClaudeCode` 打开既有会话时读 `toonflowEngine` entry：无 entry（内置会话）→ 400"该对话属于内置引擎，请新建对话"；engine 不符同理。
- 前端新建会话选 claude-code → `routes/agent/create.ts` 建会话后首条消息带 engine。
- resume 失效降级：is_error 且无文本 → 追加新 `toonflowEngine` entry（空 claudeSessionId）→ 去掉 `--resume` 重跑一次。

### 4.6 系统提示追加（`--append-system-prompt`）

内容（精简，遵守"不断言资源存在"红线）：工作区路径说明、toonflow MCP 工具一句话清单（画布操作/媒体生成/工作区文件/askUser）、"数据或工具不可用时先探测再说明，不编造"。

## 5. 实施里程碑与验证点

### M0 · Spike（不改产品代码；临时脚本放 `.omc/state/`，跑完即删）

| # | 验证项 | 通过标准 |
| --- | --- | --- |
| S1 | Bun/Node `child_process` win32 spawn claude（`where` 解析、windowsHide、无弹窗） | 拿到 stream-json 输出 |
| S2 | `--include-partial-messages` 在 2.1.x 的 delta 粒度 | 确认 text_delta 可用；不可用则标记退化方案（整块 text 事件，前端显示非逐字） |
| S3 | `-p` 模式项目级 `.claude/skills` 与 `--mcp-config` 生效（必要时 `--setting-sources`） | 技能出现在 `/skills` 输出或直接触发；MCP server 连接成功 |
| S4 | `--resume <id>` 续接 + 指向已删会话的 is_error 行为 | 双向验证：终端 `claude --resume <id>` 载入平台会话历史 |

**S1–S4 全过才进 M1**；任一失败先修订计划再实施。

### M1 · 桥接核心（`claudeCode.ts` + `claudeStream.ts` + 路由分流）

改动：`engines/` 两文件、`routes/agent.ts`、`sessions.ts` 的 `getEngineInfo`、`utils.ts` 出口。
验证（`bun run routes` + `bun run typecheck` + `bun run build` 后）：
- curl `POST /api/agent`（engine=claude-code）→ NDJSON 收到 text/thinking/tool/userMessage/session/stats/done。
- `.agent/sessions/` 列表接口出现新会话；`GET /api/agent/get` 历史消息 parts 正确（text/thinking/toolCall+toolResult）。
- 同会话发第二条消息 → 带 `--resume` 续接（`~/.claude/projects/` 对应 jsonl 增长）。
- 删掉 claude 原生会话再发消息 → 自动降级新会话重跑，不 500。
- 重启 server 后同会话续聊正常。
- 内置引擎会话照常（回归）。

### M2 · 能力注入（MCP + 技能 + askUser）

改动：`claudeEnv.ts`、`utils/mcp/tools.ts`（askUser）、claudeCode.ts 接线。
验证：
- 对话中让引擎"在画布 X 上加一个节点" → 走 `mcp__toonflow__*` 工具成功改画布（画布文档真实变化）。
- 平台技能（如 canvasOperation）对引擎可见并可用 `/技能名` 或自然语言触发。
- 引擎调 askUser → 前端弹出答题卡片 → 提交 → 引擎收到答案继续。
- MCP 未启用时给明确报错。

### M3 · 前端（引擎选择 + 容错）

改动：`conversation.vue`、settings store（按需）。
验证（浏览器端到端）：
- 模型选择器出现"Claude Code（本地引擎）"，选中发送 → 流式渲染 text/thinking/工具卡片/答题卡片。
- 重开该会话 → 历史正确渲染、引擎项自动选中、续聊正常。
- 删除/改名会话、会话列表交互正常。
- 内置引擎全流程回归。

### M4 · 设置面板

改动：`panels/agentEngine.vue`、`routes/agentEngine/status.ts`、设置页注册。
验证：CLI 路径/模型/超时修改后生效（改超时为 1 分钟→长任务被正确中断并报错）；CLI 未装时状态接口如实报告。

## 6. 风险与预案

| 风险 | 预案 |
| --- | --- |
| **MCP headless 改画布后前端画布页不刷新**（内置引擎走前端执行的桥天然同步，claude 走后端直改） | M2 验证现有 headless 链路的前端刷新机制（tdd CLI 用户一直这么用，应有方案）；无则补画布文档变更通知 |
| 同工作区并行 claude 会话时 askUser 路由歧义 | MVP 按 cwd 路由、最后注册优先，`ACT:` 标注上限（见 4.2） |
| claude 自带 AskUserQuestion 在无头 bypass 下无人可问 | 系统提示引导用平台 askUser；M0 spike 验证其行为不干扰 |
| `--include-partial-messages` 版本差异 | S2 前置验证；退化整块事件（验收线"事件流可见"仍达标） |
| Pi `SessionManager` 写入 API 与预期不符 | M1 实施首日对照 SDK 类型；极端情况降级为自定义 entry 存历史 + `getAgentSession` 兼容层 |
| Bun 下 `node:child_process` 边缘差异（kill 树） | S1 一并验证 kill；不行用 `taskkill` 兜底 |
| 项目级技能与用户级同名冲突行为未知 | S3 验证；冲突则同名跳过注入（宿主优先） |
| 会话运行中 MCP 端口重载（设置变更） | `claudeMcp.json` 每次 spawn 重写，天然拿到最新 runtime 文件；不做热更新 |
| claude CLI 未安装/未登录 | 状态接口 + spawn 前探测给出可读报错（含 `claude` 安装指引一句话） |

## 7. 工作量预估

M0 半天内；M1 约 1.5 天（事件翻译+落盘是主体）；M2 约 1 天；M3 半天；M4 半天。合计约 4 个工作日内。
