# Agent 桥接实施决策记录（用户睡眠期间自主决策）

> 供 2026-10-03 晨起 review。对应计划：`.omc/plans/agentBridgePlan.md`；spec：`.omc/specs/deep-interview-agentBridge.md`。
> 用户授权："遇到需要决策选择的地方，仔细思考，按推荐决策执行，记录到 md 文档。"
> 原则：与 spec/计划冲突的决策标 ⚠️（需重点 review）；实施内决策标 D 编号。

## 决策索引

（实施过程中追加）

## Spike 记录

### 环境事实（2026-10-03 凌晨实测）

- 本机 claude CLI：`C:\Users\oyl\.local\bin\claude.exe`，版本 **2.1.286**（astrbot 经验基于 2.1.275，协议兼容但新增行为见 D1）。
- codex CLI 未安装（一期范围外，符合计划）。
- 用户 claude CLI 配置：ANTHROPIC_BASE_URL 指向 deepseek、模型 `deepseek-v4-flash`（第三方端点）。CLI 打印 `[claude-code:unrecognized_model]` 警告，不影响运行（与 astrbot 记录一致）。
- **hook 噪音大量存在**（用户装了 oh-my-claudecode 插件）：stream-json 里 hook_started/hook_response/hook_progress 事件成串出现——解析器必须按 type 白名单过滤（只处理 system:init / assistant / user / result / stream_event）。

### D1 ⚠️ 未知模型窗口强制（用户留言确认的阻塞点）

**现象**：spike 首跑（`claude -p` + stream-json）卡在 `stream_event:ping` 心跳 10 分钟无正文；用户终端实测 `claude` 交互模式提示：`"deepseek-flash" isn't described by this version's model catalog... CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1 restores the previous wait-for-the-API behavior`。

**根因**：claude CLI 2.1.286 对模型目录之外的第三方模型默认启用上下文窗口强制管理（不再是旧版"直接发 API"行为），无头模式下表现为长时间 ping 等待。

**决策**：
1. spike 重跑时注入 `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` 验证链路（已执行）。
2. 桥接层 spawn 的 env 在透传 `process.env` 基础上，**默认追加** `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1`——理由：桥接场景引擎上下文由引擎自管（`--resume` 会话 + auto-compact），宿主不做窗口管理，恢复旧行为最贴近 astrbot 已验证路径；对官方订阅用户（claude 官方模型在目录内）该变量无效果，无副作用。
3. agentEngine 设置预留 `extraEnv` 字段（KEY=VALUE 行数组），用户可按需覆盖/追加环境变量（如 `CLAUDE_CODE_MAX_CONTEXT_TOKENS`）。

### Spike 结果（S1–S4 全过，2026-10-03）

| 项 | 结果 | 关键实测数据 |
| --- | --- | --- |
| S1 spawn | ✅ | Git Bash 后台 spawn 无弹窗；`claude.exe` 直达（`where claude` → `C:\Users\oyl\.local\bin\claude.exe`，非 .cmd shim，实现仍保留 cmd 包装兜底） |
| S2 delta | ✅ | `--include-partial-messages` 输出 `message_start` → `content_block_start{index,content_block:{type:'thinking'\|'text'\|'tool_use'}}` → `content_block_delta{index,delta:{type:'thinking_delta',thinking}\|{type:'text_delta',text}}` → `content_block_stop` → `message_delta{delta:{stop_reason},usage}` → `message_stop`；thinking 与 text 逐字实测 |
| S3 技能/MCP | ✅ | `-p` 模式**默认**加载项目级 `.claude/skills`（init 事件 `slash_commands` 含 `spikeTestSkill`），无需 `--setting-sources`；`--mcp-config` 生效（init 事件 `mcp_servers` 含 `{name:'spikeEcho',status:'failed',source:'dynamic'}`，连接失败如实上报） |
| S4 resume | ✅ | `--resume <sid>` 续接成功（问"之前让你怎么回复"答"收到"，session_id 不变）；**失效降级行为明确**：删 jsonl 后 resume → `result:{subtype:'error_during_execution', is_error:true}` 无 assistant 输出 + stderr "No conversation found with session ID"——按此检测降级 |

**协议补充事实**（写入实现）：session_id 在所有事件顶层字段 + init 事件；usage 在 `result.usage`（{input_tokens, output_tokens, cache_read_input_tokens?, cache_creation_input_tokens?...}）与 `message_delta.usage`；每条消息一次进程内 claude 会跑多轮 assistant→tool_result 循环（message_start 多次）；hook 噪音事件按 type 白名单过滤。

**D2 ⚠️ spike 期间的环境插曲**：首轮 spike 卡 ping 10 分钟，当时归因于 claude 2.1.286 未知模型窗口强制（D1 注入 env 豁免）。用户晨间反馈真实根因是 **DeepSeek 服务端 flash 模型故障**，切换 `deepseek-v4-pro` 后全通。结论：D1 的 env 注入保留（对官方模型无副作用、对第三方模型是必要豁免，用户实测其配置已用 `[1m]` 后缀自管窗口），但"ping 长等待"的排查入口应先怀疑端点故障再怀疑 CLI 行为。桥接层超时（默认 10 分钟）+ 可配置正是为此兜底。

spike 临时文件已清理（`.omc/state/spike/`）。

### M1 + M2 验证结果（2026-10-03，隔离实例实测）

- ✅ **M1 全链路**：新会话事件流（session/userMessage/thinking 逐字 delta/text/stats/done）；`--resume` 续接（第 2 轮答出第 1 轮指定词，cacheRead 73984 证明引擎会话复用）；历史读取 parts 正确（thinking,text）；**引擎会话失效自动降级**（删 jsonl → 无输出 is_error → 清映射重跑 → 映射自动更换新 id）。
- ✅ **askUser 问答闭环**：引擎调 `mcp__toonflow__askUser` → question 事件 → 答题回流 → 引擎用答案继续（实测"最喜欢的数字"→答 42→引擎复述 42）。
- ✅ **MCP 平台工具真实调用**：getAppState、listAppOperations 均 success；出错时 claude 自我纠错重试，桥接层零干预。
- ✅ **技能注入**：`<cwd>/.claude/skills/verifySkill` 注入成功；claude 读项目级技能已由 S3 验证。
- ⚠️ **阻塞**：DeepSeek 余额耗尽（402 Insufficient Balance）——技能触发对话、M3 浏览器端到端等依赖真实推理的验证待充值后补做。402 报错被桥接层如实转成 error 事件，容错正确。

### D5 ⚠️ 落盘结构实测修正（相对计划的偏差）

- claude CLI 的 `assistant` 完整消息 content 数组**不含 thinking 块**，数组索引与 content_block 索引错位——已改为"blockId 统一由 content_block_start 的原始索引分配、text/thinking 权威内容用增量累积 + content_block_stop 收口、assistant 事件只补 tool_use 完整入参（按序匹配）"；退化模式（无增量事件）由 assistant 事件按数组索引整块补发（claudeStream.ts 有注释）。
- tool_result 事件的 blockId 必须映射回 tool_use 块（toolBlockIds Map），否则前端工具卡片重复。
- claude 项目目录转义规则实测：**所有非 `[a-zA-Z0-9-]` 字符**（含 `.`）转一个 `-`。

### D3 ⚠️ MCP 工具调用不带 target 的路由约定

claude 调平台 MCP 工具默认不传 `target.directory`。约定：
- **askUser 例外**：不依赖 target——有 directory 按其路由，未带取唯一/最后注册的活跃官方引擎对话（`getClaudeQuestionContext`）。
- **画布/文件类工具**：主场景用户开着页面（MCP control 连接提供默认工作区）；无页面时靠系统提示引导 claude 传 `target.directory`（实测被提示后能正确传参，getAppState 带 directory 成功）。
- 未做通用改造（动 resolveTarget 语义会波及外部 agent 既有用法）。

### D4 ⚠️ 前端引擎选择：不污染 modelChoices

`modelChoices` 有第三个消费者 a2aSettingsDialog——塞伪 provider 会让 A2A 模型下拉出现必报错的"claude-code 模型"。改为前端两组件各自兜底：modelPopover 加"官方引擎（本机）"分组 + 默认选中跳过 claude；conversation.vue claudeChoice 常量兜底 + 发送 engine 分支 + 会话恢复映射 + claude 会话隐藏重发按钮。

### M3 + M4 状态（2026-10-03）

- **M3 代码完成**：modelPopover 下拉新增"官方引擎（本机）"分组（默认选中跳过）；conversation.vue 发送 `engine:"claude-code"` 分支（不带 providerId/modelId/thinkingLevel/canvas——画布走 MCP）、claude 会话恢复自动选中引擎项、隐藏重发按钮。web vue-tsc 通过。**浏览器端到端验证因 DeepSeek 402 未做**（代码路径与 M1/M2 隔离验证一致，风险低）。
- **M4 完成并验证**：`GET /api/agentEngine/status` 实测返回 `{found:true, version:"2.1.287"}`；设置面板（CLI 路径/模型覆盖/超时/额外环境变量/测试按钮）注册进设置页"模型"分组；agentEngine 设置保存读回实测通过。server typecheck/build、web vue-tsc 全过。

### 遗留待办（用户充值 DeepSeek 后）

1. 浏览器端到端：平台 UI 选"Claude Code（本地引擎）"对话，验证 thinking/工具卡片/答题卡片渲染与会话续接。
2. 平台技能对引擎的可触发验证（注入已实测、claude 读项目级技能已由 spike 验证，唯"自然语言触发平台技能"一步未跑通真实推理）。
3. 建议重跑一轮 M1 隔离验证确认 2.1.287 版本协议无回归（当前实测基于 2.1.286/2.1.287 混合）。

### D6 ⚠️ 无头宿主下弹 cmd 窗口问题（用户晨间实测反馈，修复待用户下次使用验证）

**现象**：用户通过平台使用本地 claude code 时弹出大量 cmd 窗口。

**根因分析**：平台 spawn claude.exe 本体已加 `windowsHide`，但 claude **内部**还会 spawn 一批子进程——① oh-my-claudecode 插件的 hooks（用户装了 omc，每轮 7+ 次 spawn，spike 实测 hook 事件成串）② 插件自带的 MCP server（spike init 见 `plugin:oh-my-claudecode:t`）③ Toonflow stdio 桥（bun.exe，每轮 1 个）④ Bash 工具。当 Toonflow 宿主进程无可见 console（桌面版/后台方式启动）时，这些子进程无法继承隐藏 console，Windows 为每个分配新控制台 → 弹窗。有 console 的环境（如终端里跑 dev server）子进程继承 console 不弹——这就是隔离测试未发现的原因。

**修复（参数级三件套 + 超时）**：
1. **stdio 桥 → HTTP MCP**：`--mcp-config` 改为 `{"type":"http","url":"http://127.0.0.1:<port>/mcp"}` 直连（claude 原生支持），bun 桥子进程消失；auth 开启时带 Bearer token。
2. **`--strict-mcp-config`**：只加载我们的 MCP 配置，不加载插件/用户级 MCP server。
3. **`--settings {"disableAllHooks":true}`**：禁全部 hooks（桥接场景宿主插件 hook 是纯噪音，还省掉 hook 事件的解析开销）。若字段未被 CLI 识别则静默忽略——届时弹窗残留源就是 hooks，需换 hook 白名单方案。
4. env 加 `MCP_TOOL_TIMEOUT=1800000`：HTTP 直连后 askUser 长阻塞需要（stdio 桥时代的 30 分钟超时等价物）。

**附带收益**：HTTP 直连省一层进程转发；strict + disableHooks 让 claude 每轮内部 spawn 从"hooks×N + 插件 MCP×1 + 桥×1"削到只剩 Bash 工具的 bash.exe（继承 console，通常不弹）。

**验证状态**：typecheck + build 通过；**未跑真实推理验证**（用户叫停：DeepSeek v4-pro 太贵）。下次使用时观察：① 不弹窗 ② MCP 工具仍可用（getCanvas 等）③ askUser 仍正常。若仍弹窗，下一个嫌疑是 Bash 工具的 bash.exe（Claude Code Windows 已知行为，届时评估收益再决定是否引导用户改用内置 Bash 配置）。

### 测试成本控制（用户晨间指示）

用户明确要求：不要用 v4-pro 跑真实推理测试（太贵）。后续验证优先级：typecheck/build → 隔离实例无推理接口（status/settings）→ 真实推理验证只在用户明确要求或使用自然发生时进行。弹窗修复的真实效果验证留给用户下次实际使用。

### D7 引擎供应商接入文本模型体系（2026-10-03，方案 `.omc/plans/agentEngineModelsPlan.md`，已实现并验证）

按用户需求"claude code/codex 像普通文本模型一样填 key、选模型"，确认方案后实施。**S5/S6 spike 关键结论**：`--settings {"env":{...}}` 注入**能覆盖**用户 `~/.claude/settings.json` 的 env 块（假端点 ECONNREFUSED 实证）；而**进程 env 会被用户 settings 覆盖**（假端点下仍正常回复）——因此 key/地址/思考档位全部经 `--settings` 注入，不走进程 env。

实现要点：
- 内置定义：`packages/providers/src/language/{claudeCode,codex}.ts`（kind:"engine" + engine 字段加入 ProviderDefinition；languageProviders 改显式 `ProviderDefinition[]` 类型）
- schema 放宽：providerSchema 的 apiUrl/protocol 可选；`getConfiguredModel` 拒绝引擎型供应商（内置 Agent 不可用）；`listAiModels`（节点模型）过滤引擎型
- server：`resolveEngineProvider`（customProviders 查找 → 未添加回退内置定义，key 空 = CLI 自身认证）；`--model <modelId>` 每消息可换；thinkingLevel 映射 MAX_THINKING_TOKENS（低 8192/中 16384/高 32768，ACT 启发式待校准）；`settings.agentEngine.model` 字段删除（模型归供应商卡片管理）
- routes/agent.ts 分流改为按 providerId 引擎型判定；codex 分支返回"该引擎尚未接入"
- 前端：modelChoices 合成未添加的内置引擎条目（开箱即见）；modelPopover 引擎分组置顶（codex 模型 disabled）；对话发送统一传 providerId+modelId；语言模型面板合成"未添加"引擎卡片引导添加；addProviderDialog 引擎型 key 可空 + apiUrl 校验

**真实测试（deepseek-flash，3 次简单问题）**：①注入路径（key/地址 + flash 模型）回复"成功" ✓ ②同会话续接 + 缺省模型回退 + thinking low（88 个 thinking delta）准确复述"成功" ✓ ③codex 拦截提示 ✓。server/web typecheck + build 全过。

**用户侧生效方式**：刷新页面 → 文本模型面板出现两张"本机引擎"卡片（可填 key/地址，模型列表可编辑）→ 对话下拉"Claude Code（本机引擎）"分组选模型 → 思考强度档位照常可用。

### D8 引擎对话框回显本机真实配置（用户反馈"值能不能加载当前真实的"，已实现）

用户指出：本机 `~/.claude/settings.json` 明明配了 DeepSeek 地址/密钥，引擎编辑对话框却显示空框。设计语义澄清并实现：
- **"留空 = 实时跟随本机配置"**（不是复制值固化）——平台条目为空时每次对话 spawn 都用 CLI 当前配置，用户改本机配置平台自动跟随；填了才覆盖。这是"平台与本地一致"的正确形态：引用而非拷贝。
- **UI 回显真实值**：`GET /api/agentEngine/status` 扩展 `localEnv` 字段（读 `~/.claude/settings.json` env 块：ANTHROPIC_BASE_URL 明文、AUTH_TOKEN 打码 `sk-a77***eb1a`、ANTHROPIC_MODEL），引擎编辑对话框顶部 info 条展示"本机 CLI 当前配置 — 地址/密钥/默认模型"，地址与密钥输入框 placeholder 同步显示实测值。
- 实测：status 返回 `{apiUrl:"https://api.deepseek.com/anthropic", authMasked:"sk-a77***eb1a", model:"deepseek-flash[1M]"}` ✓（顺带确认用户本机模型名已配为 deepseek-flash[1M]）。
- 附带修复：addCustomProviderDialog 引擎模式 UI（id/名称锁定、协议隐藏、获取模型按钮隐藏）、保存改 upsert 语义（合成 provider 直接创建）、formGrid 闭合标签。

### D9 配置中心模式：引擎保存写回本机 ~/.claude/settings.json（用户选定，已实现并验证）

用户问"编辑保存时有正确修改本机的 claude code 配置吧？"——原实现是隔离模式（只影响平台对话）。AskUserQuestion 三选一，用户选**写回本机（配置中心）**：平台 = 本机 CLI 的图形化配置界面，两边永远一致。

实现：
- `PUT /api/agentEngine/localEnv`：合并写回 `~/.claude/settings.json`，只增删 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` 两个键，其余内容（hooks/permissions/其他 env 变量）原样保留；写前滚动备份 `settings.json.bak`；密钥缺省 = 保留现值（编辑框不回填密钥正是为此）；地址空串 = 删除该键回官方默认。
- 前端：claude-code 引擎保存时先写回本机（成功才保存平台条目，且平台条目不落 key/地址——本机文件是唯一真相，平台条目只管模型列表）；地址框预填本机当前值；提示文案改为"保存将直接写回本机 ~/.claude/settings.json…"。
- 工具模块 `utils/agentEngine.ts`（读/写合并），status 路由复用。

隔离 HOME 实测（伪造 ~/.claude，含 hooks/permissions/OTHER_VAR）：①改地址+换密钥 → 两键更新、其余全保留 ✓ ②只改地址密钥留空 → 密钥保留现值 ✓ ③清空地址 → 键删除、status 回读一致、.bak 备份生成 ✓。用户真实文件未动（验证后核对完好）。server/web typecheck + build 全过。

**行为语义**：平台里改 key/地址 → 本机终端的 claude 下次启动同样生效（共享一份配置文件）；claude 会话进行中不受影响（CLI 启动时读一次）。

### D10 密钥明文回显可编辑 + 模型列表真实化（用户反馈，已实现并验证）

用户两点反馈：①"密钥为什么不让平台更改、回显"——D9 的打码 + 留空保留语义让用户看不到也改不动真实密钥；②模型列表显示内置的 sonnet/opus/haiku 占位名，与本机实际接入（DeepSeek）无关。

实现：
- **明文回显**：`readClaudeLocalEnv` 改返回明文 `auth`（删除打码）；本机单用户配置中心场景，密钥在本机文件里本就是明文，打码只造成困惑。对话框打开时地址与密钥均预填本机真实值，直接编辑保存写回；**清空保存 = 删键**（地址回官方默认、密钥回 CLI 自身登录），placeholder 承载清空语义说明。
- **修竞态**：原来 `ensureClaudeLocalEnv` 异步未完成对话框已打开，预填落空——`openEngine`/`openCustomProvider`（引擎条目）改为先 `await` 拉取本机配置再开框。
- **模型真实化**：内置引擎定义 `models` 清空（claudeCode/codex 占位名移除）；引擎对话框预填本机 `ANTHROPIC_MODEL`（如 deepseek-flash[1M]）；已存条目若模型列表完全等于旧占位集合（用户未自定义过）则自动替换为本机默认模型。`claudeCode.ts` 的 modelId 兜底放宽：不在列表/未传时不加 `--model`，CLI 用自身默认（原来强制取第一个、列表空直接报错）。
- 未添加引擎的合成卡片模型数显示"待配置"。

隔离 HOME 实测：status 明文回显（auth/model/apiUrl）✓、换地址 + 清空密钥删键 ✓、hooks/permissions/其他 env 键保留 ✓；用户真实文件未动（核对 13 个 env 键完好）。server/web typecheck + build 全过。生效需重启 server + 刷新页面。

### D11 技能注入复制改链接（用户提议，claude 一期已改造完成，codex 按此实施）

用户："skills 这类经常变更的，先通过软链接到目标 agent 全局的 skills 目录下吗？目的是避免多个来源后续改动不一致。"

决策：采纳链接；**作用域修正为项目级**（`<cwd>/.claude/skills/`、`<cwd>/.codex/skills/`），不写用户全局目录——全局会让非平台会话加载 Toonflow 技能（token + 误触发），且全局目录是用户/分发中心领地；链接本身已消除多副本不一致。

实现：源 = `<cwd>/skill/`（工作区技能）+ `<dataDir>/skills/`（全局安装态，分发中心直写处）；junction（`fs.symlink(target, path, "junction")`，Windows 无需特权，跨盘可用）；清单 `.toonflowInjected` 升级为 `{名: 预期指向}`，每轮校验（指向对→跳过、漂移/缺失→重建、源删→只删链接）；删除红线 = 只 unlink 链接绝不穿透（实测 `fs.rm` recursive 与 `unlink` 对 junction 均浅删除）。

claude 一期改造实测（2026-10-02）：junction 跨盘读写 ✓、旧 string[] 清单 + 复制目录自动升级为链接 ✓、改源即时透读 ✓、重复同步跳过 ✓、源删除链接自动清理 ✓、源 frontmatter 损坏时链接随清单清理 ✓、claude CLI 技能列表包含 junction 注入的 myProbe ✓（flash 小请求验证）。影响：dev:plugins / sync.py --publish / 工作区编辑改动技能后对 agent 即时生效，无需任何同步动作。

### 实施改动清单（实际落地）

新增：`apps/server/src/agent/engines/{claudeCode,claudeStream,claudeEnv}.ts`、`apps/server/src/routes/agentEngine/status.ts`、`apps/web/src/components/settings/panels/agentEngine.vue`。
修改：`apps/server/src/routes/agent.ts`（engine 分流）、`apps/server/src/agent/runtime/sessions.ts`（getEngineInfo）、`apps/server/src/agent/index.ts`（导出）、`apps/server/src/utils/mcp/tools.ts`（askUser 工具）、`apps/web/src/components/modelPopover.vue`、`apps/web/src/components/agent/conversation.vue`、`apps/web/src/components/settings/index.vue`（面板注册）。
未动：内置引擎 `run()`、会话管理路由、stdio 桥、前端事件渲染层——与计划一致。

### D12 Codex exec 落地与安全边界修正（2026-10-02）

Codex 采用每消息 exec/resume，HTTP MCP、平台问答与原生 thread 映射。说明只放新原生会话首次输入，后续不重复、不覆盖用户配置/AGENTS.md；thread.started 早于首轮提交的停止窗口通过 codexInstructionsSent 和只读原生记录确认，下一轮不重放取消任务。

共享技能同步替换 D11 中宽松的旧目录迁移：**不再自动删除旧复制目录或外部链接**，清单损坏显式失败，只 unlink 清单且指向均匹配的平台链接，原子写清单并加锁。旧 string[] 清单没有可证明指向，保留现有目录并报冲突。

Codex 地址/key 独立保存在平台；Claude 本机配置中心保持原语义。问答先发送同 ID 工具卡再发送问题，回答/跳过/取消均保存终态；官方引擎同工作区互斥。内置 Agent 增加拒绝接管已有官方引擎消息的检查。

隔离 Luna 实测与未验证事项见 codexBridgePlan.md 第 13 节；不把源码能力或构建通过等同于桌面真机验收。

### D13 自动显示本机模型列表（2026-10-02）

用户要求设置页和模型下拉自动显示本机真实模型。新增 GET /api/agentEngine/models：Codex 使用实际配置的 CLI 与 extraEnv 执行 debug models，不启动推理；只返回可见模型的 ID/名称，不暴露原始目录中的提示词或密钥。全局 config.toml 用 Bun.TOML 读取默认模型及所选 profile；目录合并该默认模型，缓存一分钟并合并并发请求。读取失败明确返回错误，不用 bundled 硬编码目录冒充实际读取成功。

前端启动及打开下拉时加载目录，设置卡片、编辑列表与发送选项共用合并逻辑，手动同 ID 配置优先；跟随本机选项保留空 ID 语义并显示读取到的默认名。Codex 地址/key 有平台覆盖时只显示平台模型，避免把本机目录误认成第三方模型。发送校验同时接受未覆盖 provider 的本机目录 ID，错误模型仍明确拒绝。

Claude 只显示本机显式配置的 ANTHROPIC_MODEL，不猜测其他可用模型。模型目录用于选择，不代表所有账号/供应商都已实际推理验权。隔离 HTTP 与浏览器实测显示 Codex 8 个可见模型、默认 gpt-6.1-sol，Claude deepseek-flash[1M]；未启动推理或修改真实设置。

### D14 模型选择及思考强度闭环（2026-10-03）

用户要求修复重复显示及思考强度不可选。跟随本机选项只显示“跟随本机设置”，当前模型用说明展示；具体模型按 ID 合并去重。Codex 目录增加 supported_reasoning_levels 与默认档位，前端按能力展示，后端校验并通过 -c model_reasoning_effort 传入 exec/resume。未声明的档位拒绝，不修改本机配置。Claude 和内置 Agent 保留低/中/高映射，修复前端官方引擎丢弃 thinkingLevel 的问题。

Codex 每轮 toonflowReasoning 记录显式档位或空串默认，Claude 记录 thinkingLevel；历史读回恢复选择。目录异步加载前不重置历史模型/档位，切模型只清除不支持的档位。

已用隔离 GPT-5.6-Luna 极小任务验证原生 turn_context 为 xhigh，续接默认恢复 medium，平台历史字段正确，ultra 不支持时拒绝且无 done。此前切模型补测被自动审批额度限制阻止，未执行；继续时保留既有成功验证，不因限额换模型或绕过审批。

2026-10-03 继续验证：冷刷新恢复 GPT-5.6-Luna / xhigh，切换 GPT-6-Luna 再返回保留有效档位；实际浏览器模型列表无同 ID 重复。修正了异步模型目录导致历史选择提前重置的竞态及档位文字截断。server/web 类型检查通过，服务端构建通过。当前宿主内存不足导致标准压缩前端构建失败；单线程、不压缩构建成功，未修改项目构建配置。Claude 与普通供应商真实模型调用未新增验证，不把界面恢复等同于所有供应商均支持推理。

最终样式构建通过：RAYON_NUM_THREADS=1、NODE_OPTIONS=--max-old-space-size=512、vite build --minify false。参数仅对该次进程生效，项目构建配置未改。用户在用实例 GET / 返回 200，未重启。
