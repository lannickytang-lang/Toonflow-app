# Codex 引擎桥接实施方案（二期）

> 交付目标：在平台内把本机 OpenAI Codex CLI 作为第二个官方引擎接入（与已上线的 claude-code 引擎对等）。
> 本方案自包含：实施者无需历史记忆，按此文档 + 现有 claude 三件套源码即可正确完整实现。
> 撰写日期：2026-10-02。一手调研基于本机 **codex-cli 0.160.0**（Windows，ChatGPT 登录态），全部关键机制已 spike 实测。

---

## 0. 给实施者的话

- **先读**：`apps/server/src/agent/engines/claudeCode.ts`、`claudeStream.ts`、`claudeEnv.ts`（一期桥接三件套），`apps/server/src/routes/agent.ts`（引擎分流）。codex 接入 = 以 claude 三件套为模板的平行实现，公共设施（问题注册表、会话文件、前端渲染、MCP 端点）全部复用。
- **成本红线（用户明确要求）**：真实测试只用小任务（"只回复 ok"、四行短诗、列技能名），测试模型用 **GPT-6-Luna** 和 **GPT-5.6-Luna**（用户提供第三方端点）。禁止跑大生成任务，禁止用昂贵模型做反复推理验证。
- **禁止改动**：用户 `~/.codex/config.toml`、`auth.json`、`sessions/`（方案设计为完全不碰，见 D3/D5）。**禁止编写任何测试文件**，验证用临时脚本跑完即删。
- 遇到需要决策的点：按本方案已定决策执行；方案未覆盖的，选与 claude 侧最对称的做法并记录到 `.omc/plans/agentBridgeDecisions.md`（续写 D 编号）。

---

## 1. 已实测事实（一手 spike 结果，2026-10-02）

以下全部为本机实测确认，可直接作为实现依据：

### 1.1 非交互调用与事件流

- `codex exec [OPTIONS] [PROMPT]`：非交互执行；`--json` 向 stdout 输出 JSONL 事件。
- 事件流形态（实测样本）：
  ```jsonl
  {"type":"thread.started","thread_id":"01a0fb79-45dc-7960-806b-66f89e097ead"}
  {"type":"turn.started"}
  {"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"...","aggregated_output":"","exit_code":null,"status":"in_progress"}}
  {"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"...","aggregated_output":"14\r\n","exit_code":0,"status":"completed"}}
  {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"当前目录有 **14 个条目**。"}}
  {"type":"turn.completed","usage":{"input_tokens":42904,"cached_input_tokens":34688,"cache_write_input_tokens":0,"output_tokens":72,"reasoning_output_tokens":0}}
  ```
- 已见 item 类型：`agent_message{text}`、`command_execution{command,aggregated_output,exit_code,status}`。
- **实现时需实测补齐的 item 形态**（跑一次让模型调用 MCP 工具即可）：`mcp_tool_call`、`reasoning`（本轮 effort=low 时 reasoning_output_tokens=0 未出现）。
- **没有 token 级 delta 事件**：0.160 的 `exec --json` 只按 item 整块输出（两轮实测均如此）。流式体验降级为"整段出现"，见 D7。
- `turn.completed` 无耗时字段，时长用 `Date.now()` 差值。
- stderr 有良性噪音（如 `ERROR codex_models_manager: failed to refresh available models: request timed out`），**不构成失败信号**，失败判定以退出码 + 是否有 thread/turn 事件为准。

### 1.2 会话续接

- `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]`：SESSION_ID 用首轮 `thread.started` 的 `thread_id`（UUID）。
- **resume 后 thread_id 不变**（实测），上下文完整保持（首轮告知暗号，resume 轮正确答出）。
- **坑：resume 的 CLI 参数是 exec 的子集**——没有 `-s/--sandbox`、没有 `-C/--cd`。sandbox 用 `-c sandbox_mode='"read-only"'` 等 config 覆盖代替；工作目录用 spawn 进程的 `cwd` 选项（不用 `-C`）。`--dangerously-bypass-approvals-and-sandbox`、`--json`、`-m`、`-c` 在 resume 下可用。
- 会话落盘：`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<时间戳>-<thread_id>.jsonl`（文件名含 thread_id）。
- `--ephemeral` 不落盘（spike 用它避免污染；正式实现**不能带**，会话续接依赖落盘）。

### 1.3 配置注入（全部经 `-c` 内联 + 环境变量，零文件写入）

- `-c key=value` 按 dotted path 覆盖 config.toml；**value 按 TOML 解析**——字符串要带内层双引号，如 `-c model_reasoning_effort='"low"'`（实测通过）。
- **MCP HTTP 直连注入（实测有效）**：
  ```
  -c mcp_servers.toonflow.url="<endpoint>"
  -c mcp_servers.toonflow.bearer_token_env_var="TOONFLOW_MCP_TOKEN"
  ```
  （字符串值的双引号：bash 里写 `-c 'mcp_servers.toonflow.url="http://..."'`；Node spawn 用 args 数组传 `-c`、`mcp_servers.toonflow.url="http://..."`，由 libuv 负责转义——M1 需在 Windows 实测一次转义结果。）
  `codex mcp list -c ...` 显示 `toonflow | enabled | Bearer token` 确认生效。与 claude 侧 HTTP MCP 直连同构，**不需要**写临时 mcp config 文件。
- 第三方供应商（GPT-6-Luna 等自定义端点）：
  ```
  -c model_provider="toonflow"
  -c model_providers.toonflow.name="Toonflow"
  -c model_providers.toonflow.base_url="<平台条目 apiUrl>"
  -c model_providers.toonflow.env_key="TOONFLOW_PROVIDER_KEY"
  ```
  key 经环境变量 `TOONFLOW_PROVIDER_KEY` 注入（codex 读取后作为 Bearer）。`wire_api` 默认 `chat`（第三方端点绝大多数适用）；若某端点是 Responses 协议需 `-c model_providers.toonflow.wire_api='"responses"'`（列为排障项，不做配置面）。
  apiUrl 为空 = 完全用 CLI 自身配置（用户 ChatGPT 登录态），不传以上任何 provider 键。
- **stdin 坑**：stdin 为管道时 codex 打印 `Reading additional input from stdin...` 并阻塞等待——spawn 必须 `stdio: ["ignore", "pipe", "pipe"]`（与 claude 侧一致）。

### 1.4 技能机制（与 claude 高度同构）

- 全局技能 `~/.codex/skills/<name>/SKILL.md`，项目级 **`<cwd>/.codex/skills/<name>/SKILL.md`**（实测：在临时目录放 spikeProbe 技能，模型能列出它，且与全局技能合并可见）。frontmatter（name/description）格式与 claude SKILL.md 相同——用户 `~/.codex/skills/` 里已有 tududo-center 分发的平台技能（canvasOperation、tdd-auto）。

### 1.5 其他实测确认

- 认证：ChatGPT 登录（`~/.codex/auth.json`，`codex login status` 显示 Logged in using ChatGPT）；或 `codex login --with-api-key`（stdin）。CODEX_HOME 指到新目录时复制 auth.json 即可继承登录态（实测）。
- `CODEX_HOME` 环境变量可整体隔离 codex home（config/sessions/auth 全迁移）——本方案默认不用（D3），但它是排查/测试的隔离手段。
- 全放开：`--dangerously-bypass-approvals-and-sandbox`（对齐平台"权限默认全放开"策略；exec 与 resume 均支持）。
- `--skip-git-repo-check` 必带（Toonflow 工作区不一定是 git 仓库）。
- `--ignore-user-config`：不加载用户 config.toml（auth 仍用 CODEX_HOME）。用户本机 config.toml 含 `notify`（computer-use exe 回调）、plugins、marketplaces、多个 enabled 的 stdio MCP server——在无 console 宿主下可能弹 cmd 窗口（claude 侧同款问题的前车之鉴）。Git Bash 有 console 的裸跑实测无明显噪音；**桌面宿主下待实测**，缓解手段见 D8。
- 用户本机 config.toml 现状参考：`model = "gpt-6.1-sol"`、`model_reasoning_effort = "low"`——"CLI 默认模型"语义 = 用户这套自身配置。

---

## 2. 现有 claude-code 桥接架构速览（复用模板）

| 一期文件（claude） | 职责 | codex 侧对应 |
| --- | --- | --- |
| `apps/server/src/agent/engines/claudeCode.ts` | runClaudeCode 主流程：每条消息 spawn 一次 CLI、--resume 续接、会话映射、降级重跑、askUser 注册 | **新建 `codexCode.ts`**（runCodexCode，平行实现） |
| `apps/server/src/agent/engines/claudeStream.ts` | stream-json 解析器，产出 onSession/onBlock/onTool/onToolResult/onAssistant/onResult 回调 | **新建 `codexStream.ts`**（解析 §1.1 事件流） |
| `apps/server/src/agent/engines/claudeEnv.ts` | prepareMcpConfig、resolveEngineProvider、syncClaudeSkills（.toonflowInjected 清单）、buildClaudeSystemPrompt | resolveEngineProvider **直接复用**；prepareMcpConfig 被 `-c` 内联取代（D5）；syncCodexSkills/buildCodexSystemPrompt 平行实现 |
| `apps/server/src/routes/agent.ts` | 引擎分流（`u.ai.isEngineProvider` → kind 判断 → runClaudeCode） | 加 codex 分支（D2 改动点，2 行） |
| `apps/server/src/routes/agentEngine/status.ts` | 探测 claude --version + localEnv 回读 | 加 codex 探测；localEnv 仅 claude 有 |
| `apps/server/src/utils/agentEngine.ts` | claude 配置中心读写（~/.claude/settings.json） | **不适用**（codex 不做配置中心，见 D3） |
| `apps/server/src/utils/ai/index.ts` | engineProviders/isEngineProvider/getEngineKind | 已通用，零改动 |
| `packages/providers/src/language/codex.ts` | codex 内置引擎定义（id:"codex"、kind:"engine"、models:[]） | 已就位，零改动 |
| 前端 `stores/settings.ts` / `modelPopover.vue` / `conversation.vue` | 引擎分组、"CLI 默认模型"合成项、engine 分支（隐藏思考档/重发） | 仅 `implementedEngines` 加 "codex"（D6），其余已通用 |
| 前端 `addCustomProviderDialog.vue` | 引擎编辑：claude-code 写回本机 + localEnv 回显 | codex 引擎跳过 localEnv/写回，apiUrl/apiKey 平台正常存储（D3） |
| `agentEngine.vue` 设置面板 + `getAgentEngineSettings` | claudePath/timeoutMinutes/extraEnv | 加 codexPath 字段 |

核心机制（两引擎共用，直接依赖）：

- **双真相会话**：引擎原生会话（claude jsonl / codex rollout jsonl）是推理上下文；平台 Pi SessionManager JSONL（`.agent/sessions/`）仅供前端显示；平台 custom entry 存 engineSessionId 映射（claude 存 session uuid，codex 存 thread_id）。onSession 回调落映射的具体写法照抄 claudeCode.ts。
- **askUser**：`u.question.createQuestionContext` 创建问题上下文 → 传给 run → MCP askUser 工具挂起等待 → 前端答题 → 恢复。与引擎无关，codex 侧原样传 `question: questions.context`。
- **前端事件协议**：AgentEvent NDJSON（text/thinking/tool/question/session/stats/done/error）。codexStream 的回调产出对齐 claudeStream 的事件结构即可，前端渲染零改动（无 thinking 块可接受，见 D7）。

---

## 3. 设计决策

- **D1 调用模式**：每条消息 spawn 一次 `codex exec`（对齐 claude 的 -p 模式）。`stdio: ["ignore","pipe","pipe"]`、`windowsHide: true`、spawn `cwd` = 工作区目录。prompt 用位置参数传递（与 claude 一致；超长再切 stdin，见 §5 坑 7）。
- **D2 会话与降级**：新会话从 `thread.started` 取 thread_id 落映射；续接 `exec resume --json <thread_id> <prompt>`（thread_id 不变）。降级对齐 claude 的 engineSessionInvalid：resume 因映射失效整跑失败时丢弃映射、按新会话自动重跑一次。**实现时实测**"resume 不存在的 UUID"的 stdout/stderr/退出码作为失效判定依据。
- **D3 配置注入（与 claude 的差异点，用户 review 重点）**：codex **不做配置中心写回**，平台条目正常保存 apiUrl/apiKey（存平台 settings.json，与普通自定义供应商同权），运行时经 `-c` + env 注入。理由：①codex 的 TOML 合并写没有保留注释/格式的安全方案，写坏用户 config.toml 风险高；②`-c` 内联是官方一等公民，语义等价且零落盘。前端：codex 引擎卡片**不显示** localEnv 信息条、不预填、保存不写回本机（`writeBack` 已按 `engineKind === "claude-code"` 区分，扩展为 localEnv 相关逻辑全部仅 claude-code）。
- **D4 模型与推理档位**：模型 `-m <modelId>` 透传（与 claude 同）；未选/CLI 默认时不传 `-m` 也不传 provider 键，用用户 codex 自身默认（一期已放宽的 modelId 逻辑模式复用）。思考档位一期**不透传**（前端 engine 分支本就不传 thinkingLevel；`-c model_reasoning_effort` 的 Windows 参数转义留到需要时再实测）。
- **D5 MCP 与 askUser**：`-c mcp_servers.toonflow.url/bearer_token_env_var` 内联注入 + `env.TOONFLOW_MCP_TOKEN` 传 token；MCP 未启用时报错文案对齐 claude 侧。askUser 走同一 MCP 工具，问题注册表复用。
- **D6 前端开关**：`modelPopover.vue` 的 `implementedEngines` 加入 `"codex"`（这是 codex 在下拉里从 disabled 变可选的唯一开关）。其余引擎通用逻辑已就绪。
- **D7 流式降级**：0.160 exec --json 无 token delta（§1.1），text 以 item.completed 整块渲染；无独立 thinking 块。写文档如实告知用户"codex 引擎回复整段出现，属 CLI 输出粒度限制"；若未来 codex 提供 delta（app-server 协议或新 flag），再升级。
- **D8 用户 config 噪音与弹窗**：一期**裸跑**（不加 `--ignore-user-config`，保住"CLI 默认模型=用户配置"语义），桌面宿主实测弹窗：若 notify/plugins 的 stdio 子进程弹窗，依次尝试 `-c notify='[]'`、逐项 `-c mcp_servers.<name>.enabled=false`，都不行再 `--ignore-user-config`（代价：丢用户默认模型配置，需同时兜底 -c model）。
- **D9 技能与系统提示**：`syncCodexSkills` 对齐 syncClaudeSkills（复制到 `<cwd>/.codex/skills/` + `.toonflowInjected` 清单增量管理，实测项目级可发现）。系统说明经 **AGENTS.md 注入**：exec 无 `--append-system-prompt`，codex 每次启动读 `<cwd>/AGENTS.md`——文件不存在则创建、存在则用 `<!-- toonflow:agentBridge -->` 起止标记追加/替换平台段（不碰用户内容）；内容对齐 buildClaudeSystemPrompt（平台说明 + askUser 指引 + 已注入技能清单行）。若实测发现 AGENTS.md 对 exec resume 不生效，备选方案：首轮 prompt 前缀（resume 轮上下文自带）。

---

## 4. 实施步骤

### M0 补充实测（半天内，全部小 prompt，用 GPT-6-Luna 或 CLI 默认模型）

1. `mcp_tool_call` / `reasoning` item 的 JSON 形态：让模型调用一个 MCP 工具（可临时注入一个 echo 类 server，或直接接平台 MCP 跑 `codex exec -c mcp_servers... "调用 toonflow 的 hello 工具"`）。→ 决定 codexStream 的 onTool 映射字段。
2. `resume` 一个不存在的 UUID → 记录 stdout/stderr/退出码 → 定降级判定条件。
3. 中断后 resume：kill 进程后对同 thread_id 再 resume，确认会话可用。
4. `-c` 参数在 Node spawn（Windows）下的转义实测：`spawn("codex", ["-c", 'model_reasoning_effort="low"', ...])` 跑通即确认字符串值写法。
5. 桌面宿主（无 console）下裸跑观察弹窗（D8）。

### M1 服务端核心（对应 claudeCode.ts + claudeStream.ts）

1. 新建 `apps/server/src/agent/engines/codexStream.ts`：按行解析 JSONL，映射：`thread.started`→onSession；`item.completed(type=agent_message)`→onBlock/onAssistant(text)；`item.started/completed(type=command_execution|mcp_tool_call)`→onTool/onToolResult；`turn.completed`→onResult(usage 换算、Date.now 差值)；error/turn.failed→onResult(isError)。解析失败/未知 item 忽略并日志。
2. 新建 `apps/server/src/agent/engines/codexCode.ts`：照抄 claudeCode.ts 骨架，替换 spawn 参数组装（§1.3）、resume/降级（D2）、killProcessTree 复用。超时复用 getAgentEngineSettings().timeoutMinutes。
3. `claudeEnv.ts` 增补（或新建 codexEnv.ts）：syncCodexSkills、buildCodexAgentInstructions（AGENTS.md 标记注入）；MCP 注入参数组装函数。
4. `agent.ts` 分流：`engineKind === "claude-code" ? runClaudeCode : engineKind === "codex" ? runCodexCode : 报错`；resendFrom 拦截、question context、done/error 包装全部共用现有代码。
5. `agent/index.ts` 导出 runCodexCode；`u.agent` 出口暴露。
6. 验证：`bun run typecheck` + 隔离实例（createApp、端口 3712、临时数据目录）POST /api/agent 走 codex 引擎发"只回复 ok"，确认 NDJSON 事件（session/text/done）齐全。

### M2 注入完善

1. 技能同步：工作区+全局技能复制到 `<cwd>/.codex/skills/`（清单管理同 claude）；AGENTS.md 注入平台说明。
2. 验证：对话问模型"列出可用技能名"应含平台技能；"调用 askUser 问我一个问题"答题闭环；"列出当前目录文件"走 command_execution 且前端工具卡渲染。

### M3 前端

1. `modelPopover.vue`：`implementedEngines` 加 `"codex"`。
2. `addCustomProviderDialog.vue` + `languageModel/index.vue`：localEnv 拉取/信息条/预填/写回仅限 claude-code（按 `engineProviders` 的 `engine` 字段判断）；codex 引擎卡片 apiUrl/apiKey 正常表单保存（走平台 settings.json）。
3. `agentEngine.vue` 设置面板加 codexPath；`getAgentEngineSettings` 加字段；`status.ts` 并行探测两个 CLI 并返回 `codex: { found, version, error? }`。
4. 验证：`bun run typecheck` + `bun run build`（产物在仓库根 `build/web/`，**不是** apps/web/dist）；浏览器里 codex 卡片可编辑保存（apiUrl/apiKey 落平台设置）、模型下拉出现可用的 codex 分组。

### M4 设置路由与文档

1. `agentEngine` 相关路由如涉及 codexPath 保存，跑 `bun run routes`（apps/server 下，路由文件变更后必跑）。
2. 更新 `.omc/plans/agentBridgeDecisions.md`（续写 D 编号）与本方案的"实施结果"节。
3. 提醒用户：重启 server + 刷新页面（前端产物在 build/web）。

---

## 5. 坑与注意事项清单

1. **resume 参数子集**：无 `-s`/`-C`；sandbox 用 `-c sandbox_mode='"..."'`，cwd 用 spawn 选项（§1.2）。
2. **TOML 内联值**：`-c` 的字符串值要带内层双引号，否则被当裸字符串；数字/布尔不加引号（§1.3）。
3. **stdin 阻塞**：必须 `stdio: ["ignore","pipe","pipe"]`（§1.3）。
4. **`--ephemeral` 禁用**：正式会话必须落盘否则无法 resume。
5. **`--skip-git-repo-check` 必带**：工作区未必是 git 仓库。
6. **stderr 噪音**：models manager 刷新超时等 ERROR 不代表失败；失败判定 = 退出码非 0 且无有效事件。
7. **超长 prompt**：Windows 进程参数有长度上限（约 32K 字符）；带大附件引用时改走 stdin（PROMPT 传 `-`，spawn 后 write+end）。
8. **弹窗风险**：用户 config 的 notify/plugins（stdio MCP）在无 console 宿主可能弹 cmd 窗口；缓解顺序见 D8。
9. **密钥安全**：TOONFLOW_PROVIDER_KEY / token 只经环境变量传递，禁止打进日志或事件流。
10. **用户文件红线**：不写 `~/.codex/config.toml`、不写 `~/.codex/skills/`（只写工作区内 `<cwd>/.codex/skills/`）、AGENTS.md 只做标记段管理。
11. **测试隔离**：spike/验证用 `--ephemeral` 或 `CODEX_HOME=临时目录`（复制 auth.json），不污染用户 sessions 列表；正式链路测试的会话落在用户 HOME 属正常，验收后可留。
12. **前后端生效**：server 改动需重启；web 改动需 `bun run build`（build/web）+ 刷新。

---

## 6. 验收标准（全部满足才算完成）

服务端（隔离实例或用户实例，小 prompt）：

- [ ] **A1 基础问答**：选 codex 引擎 + GPT-6-Luna 发"只回复 ok"，前端收到 session/text/stats/done 事件，回复正确渲染。
- [ ] **A2 多轮续接**：第二轮问首轮告知的暗号能答对；映射的 thread_id 与 `~/.codex/sessions/` rollout 文件名一致。
- [ ] **A3 历史续接**：刷新页面重开会话继续对话，上下文保持。
- [ ] **A4 降级**：手工把平台会话映射改成随机 UUID 后发消息，自动按新会话重跑成功（对齐 claude 侧降级行为）。
- [ ] **A5 MCP 工具**：让模型"列出当前目录文件"（command_execution 工具卡渲染）与"用 askUser 问我 A 还是 B"（答题卡片弹出、作答后模型继续）。
- [ ] **A6 技能注入**：对话问"列出可用技能"，包含平台工作区技能；`<cwd>/.codex/skills/` 有 `.toonflowInjected` 清单。
- [ ] **A7 权限放开**：模型执行命令无审批卡点（bypass 生效）。
- [ ] **A8 中断**：流式中点停止 → 进程被杀、无悬挂，会话仍可继续。
- [ ] **A9 模型切换**：GPT-6-Luna ↔ GPT-5.6-Luna 逐消息切换均正常；不选模型（CLI 默认）也正常。
- [ ] **A10 第三方端点**：平台 codex 卡片填用户提供的 apiUrl/apiKey 后请求打到该端点（key 经 env 注入、不落日志）。
- [ ] **A11 claude 侧无回归**：claude-code 引擎问答/续接照常（分流改动不破坏一期）。
- [ ] **A12 构建与类型**：apps/server 与 apps/web `bun run typecheck`、`bun run build` 全过。

体验（如实告知用户即可，非阻塞）：

- codex 回复整段出现（无逐 token 流式）、无独立 thinking 块——CLI `--json` 输出粒度所限（D7）。
- 桌面宿主下无弹窗（若有，按 D8 缓解后复测）。

---

## 7. 测试说明

- **测试模型**：GPT-6-Luna（主）、GPT-5.6-Luna（切换验证）。实施前在平台"文本模型设置 → Codex（本机引擎）→ 配置密钥与模型"里把这两个 ID 加入模型列表（编辑框模型列表手动添加即可）。
- **第三方端点**：向用户要 base_url（一般 `https://<host>/v1` 形态）与 API key，填在 codex 引擎卡片；若请求 404/协议错，尝试 `-c model_providers.toonflow.wire_api='"responses"'` 排障（§1.3）。
- **成本纪律**：每个验收项一次小 prompt 验证；A2 的暗号、A6 的技能列表都是零成本任务；严禁让 codex 跑画布批量生成等大任务。
- **对照模板**：行为不确定时，先看 claude 侧同位置怎么做的——两引擎的产品语义（会话、映射、降级、askUser、前端事件）必须完全一致。
