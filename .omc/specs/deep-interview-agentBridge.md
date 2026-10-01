# Deep Interview Spec: Toonflow 桥接本地官方 Agent 引擎（claude code / codex）

## Metadata
- Interview ID: di-agentbridge-20261002
- Rounds: 6（含 Round 0 拓扑确认）
- Final Ambiguity Score: 19.5%
- Type: brownfield
- Generated: 2026-10-02
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED · pending approval（2026-10-02 访谈完成，执行路径待用户指定）

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.85 | 0.35 | 0.298 |
| Constraint Clarity | 0.80 | 0.25 | 0.200 |
| Success Criteria | 0.75 | 0.25 | 0.188 |
| Context Clarity | 0.80 | 0.15 | 0.120 |
| **Total Clarity** | | | **0.805** |
| **Ambiguity** | | | **19.5%** |

## Topology

| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| 推理引擎桥接层 | active | server 端新增 claude code（一期）/ codex（二期）运行时：驱动官方引擎，事件流翻译为平台 AgentEvent，会话映射与续接；内置 agent 保留，引擎可切换 | 验收线 1/2 覆盖 |
| 平台能力注入 | active | 平台工具（画布/媒体/工作区文件）经 MCP 注入官方引擎；平台技能自动注入引擎环境（去重）；cwd 锚定与 env 透传 | 验收线 3 覆盖 |
| 对话前端适配 | active | 引擎选择、官方特有事件（thinking/子代理/工具卡片）渲染 | 验收线 1/4 覆盖 |
| 引擎配置界面 | active | 设置页管理引擎选项：CLI 检测、模型覆盖等；权限配置延后（一期默认全放开） | 最小配置集，见 Constraints |

## Goal

在 Toonflow 平台内新增"本地官方 agent 引擎"作为可选推理后端：用户在平台对话界面选择 claude code（一期）或 codex（二期）引擎后，对话由本地安装的官方 CLI 完整驱动——官方引擎接管规划、工具循环、自我纠错、上下文压缩、子代理等全部推理与生态能力；平台以"能力追加"方式把自己的工具（MCP）、技能（SKILL.md 目录注入）、提问通道（askUser）接入官方引擎环境；对话过程（文本流、thinking、工具调用、子代理活动）实时回传平台前端渲染。内置 agent 保留为默认引擎，创建会话时可选切换。

核心价值主张（Round 5 Contrarian 确认）：终端里直接跑 claude code + MCP 桥已可操作 Toonflow，平台 UI 集成的不可替代价值 = 会话管理 + 过程可视化 + 引擎切换体验。

## Constraints

- **一期只桥 claude code**；桥接层按多引擎抽象设计（参考 claudecodeui provider 八件套模式），codex 二期以增量接入，不预写 codex 代码。
- **权限：一期默认完全放开**（claude `--dangerously-skip-permissions` / 后续 codex `danger-full-access`），deny 列表与交互审批（canUseTool → 前端确认卡片）延后二期。个人本地单机使用场景。
- **定位：通用助手**。不限定制作场景；官方自带工具（Bash/Read/WebSearch 等）全量可用，平台能力是追加而非限定；子进程 cwd 锚定当前项目工作区。
- **平台技能自动注入**：spawn 时把平台技能（工作区 `skill/` + 全局 `skills/`）注入引擎可发现位置（如 cwd 项目级 `.claude/skills`），所有用户开箱即用，不依赖预先 `tdd install`；与宿主已有同名技能去重。
- **桥接在 server 层实现**（`apps/server`），独立 server 与桌面端（复用 `@toonflow/server/app`）两种形态天然同时获得能力；Windows 需 `CREATE_NO_WINDOW`（astrbot 实测）。
- **引擎绑定会话**：会话创建时选定引擎并固定；官方引擎会话与内置 agent 会话不互转（上下文格式不兼容），切换引擎 = 新会话。
- 不引第三方新依赖为原则：优先复用现有 MCP stdio 桥、Pi SDK 事件类型、现有前端组件。

## Non-Goals

- 权限交互审批（确认卡片、"允许并记住"白名单）——延后。
- codex 引擎一期交付——延后（仅要求抽象层可增量接入）。
- 官方引擎会话与内置 agent 会话互相迁移/续聊。
- 远程/多用户场景（官方 CLI 在用户本机运行，平台仅本机访问）。
- 用官方引擎替换内置 agent（内置 agent 保留且仍是默认）。

## Acceptance Criteria

- [ ] **基线**：平台对话里可选 claude code 引擎；发消息后文本流、工具调用过程、thinking 在前端实时可见（NDJSON 事件流）。
- [ ] **会话续接**：关闭页面或重启 server 后回到该会话能继续聊；宿主侧维护 平台会话 ↔ 引擎原生 session id 映射，`--resume` 续接；映射失效（引擎会话被删）自动降级为新会话重跑。
- [ ] **平台能力注入生效**：claude code 引擎能调用平台工具（画布 16 操作、媒体生成、workspaceFiles 等，经现有 MCP stdio 桥注入）；平台技能（canvasOperation 等）对其可见、可自动触发或 `/技能名` 触发；askUser 提问能在前端弹出并可回答。
- [ ] **官方生态完整可用**：子代理、官方 skills、上下文压缩在桥接下正常工作；前端有对应展示（子代理活动分组、thinking 块、工具调用卡片）。
- [ ] **内置 agent 无回归**：默认引擎仍为内置 agent，现有对话/会话功能不受影响。
- [ ] **抽象层验证**（架构级）：新增引擎的接入点收敛在桥接抽象层内，codex 二期不需要改动前端事件协议与会话管理。

## Assumptions Exposed & Resolved

| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| 内置 agent "远比不了"官方 agent（模糊抱怨） | 具体比不了什么？若只是模型能力，桥接可以很薄 | 痛点 = 官方生态能力（子代理/skills/压缩）+ 规划执行智能 → 必须深度桥接，官方引擎接管完整推理循环 |
| "在平台内"是硬需求 | Contrarian：终端直接跑 claude code + tdd CLI + MCP 桥已可操作 Toonflow | UI 集成价值 = 会话管理 + 过程可视化 + 引擎切换，用户确认必要（4 条验收线全选） |
| 平台技能必须注入 | Simplifier：你本机 ~/.claude/skills 已装平台技能（tdd install），直接用即可 | 产品化考虑：其他用户机器上没有 → 平台自动注入 + 同名去重 |
| 双引擎一期都做 | 一期工作量翻倍 | 先 claude code 验证全链路，抽象层预留，codex 二期 |
| 官方引擎权限需要精细管控 | 通用助手场景下严格默认拒绝会让 Bash/写文件残废（astrbot 实测） | 一期默认完全放开，权限体系（deny 列表、交互审批）延后 |

## Technical Context

### Toonflow 侧现有资产（桥接可直接复用）

1. **对话事件协议**：前端只认 `AgentEvent` NDJSON 流（`POST /api/agent`，`apps/server/src/routes/agent.ts:30`；事件类型定义 `apps/server/src/agent/runtime/types.ts`）。桥接引擎只要产出同类事件即可复用现有对话 UI 骨架。
2. **MCP 通道已现成**：`/mcp` HTTP 端点（`packages/mcp/src/index.ts:43`）暴露画布 16 操作、插件工具、workspaceFiles、`runAgent` 等；`packages/mcp/src/stdio.ts` 是给 claude code/codex 这类 stdio 宿主的 MCP 桥（`--runtime mcpRuntime<port>.json` 自动发现地址+token）。**桥接方向从"外部 agent 操控平台"复用为"平台内官方引擎调用平台能力"**：spawn 时通过 SDK `mcpServers` 选项或 CLI 参数注入 stdio 桥即可。
3. **平台技能是标准 SKILL.md**：工作区 `<cwd>/skill/` + 全局 `<data>/skills/`（`apps/server/src/agent/skills/index.ts:9`）。claude code 技能发现只认 `~/.claude/skills`（用户级）与 `<cwd>/.claude/skills`（项目级）→ 注入点选 **cwd 项目级 `.claude/skills`**（工作区隔离、免污染用户全局目录）。
4. **LLM 后端抽象缺口**：`u.agent.run()`（`apps/server/src/agent/runtime/index.ts:40`）硬绑 Pi SDK `createAgentSession`；模型侧抽象只到 HTTP 协议级。**需要新增"进程级 agent 引擎"抽象**：引擎注册表（内置 pi / claude code / 预留 codex）+ 统一事件产出接口。
5. **已有桥可复用**：画布桥（`agent/bridge/canvas.ts`）与提问桥（`agent/bridge/question.ts`）是平台"事件让前端执行、结果回流"的成熟模式，askUser 通道可类比实现。

### claudecodeui（CloudCLI）可借鉴模式

- **SDK 优先**：claude 用 `@anthropic-ai/claude-agent-sdk` `query()` 流式输入（SDK 内部管理 CLI 子进程），SDK options 注入 `settingSources: ['project','user','local']`、`mcpServers`、`resume`、`permissionMode`、`model`；Toonflow 是 Bun 运行时，SDK 兼容性需先验证，**fallback 是裸 spawn CLI**（`claude -p --output-format stream-json --verbose --resume <sid>`，astrbot 已在 Python 侧完整验证该协议）。
- **会话模型**：应用层稳定 session id ↔ 引擎原生 session id 映射；转录留在引擎原生位置（`~/.claude/projects/<cwd转义>/`）不复制；新会话首个 system 事件捕获 `session_id` 入映射；映射失效自动降级重开（astrbot 实测）。
- **事件归一化**：引擎原生消息流 → normalize 适配器 → 统一帧协议逐条转发；官方引擎事件（assistant/tool_use/thinking/system）到平台 `AgentEvent` 的映射表在实施时按 claudecodeui 的 `transformMessage` + astrbot 的 stream-json 协议笔记设计。
- **只发最新一条用户消息**：引擎 `--resume` 自持完整上下文，宿主不重放历史（双份历史重复且费 token，astrbot 实测）。
- **模型**：透传宿主 env（`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` 等，用户自己的 CLI 认证体系生效）；平台配置界面提供可选的模型覆盖（`--model` / SDK `model`）。

### astrbot 实战红线（实施时必须遵守）

- Windows spawn 加 `CREATE_NO_WINDOW`；引擎一次跑 60s+ 常见，超时设 10 分钟级；每条消息一次进程，不做常驻假设。
- `bypassPermissions` + deny 列表可共存（bypass 下 deny 仍硬拦，已实测）——一期全放开仍建议预置最小 deny 集（如 `rm -rf` 类）防误删。
- 系统提示词（如注入的工作区说明）不断言资源存在性，加早停条款。
- 无头会话不出现在交互式 `claude --resume` 选择器，但按 ID resume 完全可用——验证桥接真假用 `claude --resume <sid>`。

### 关键设计决策点（实施计划阶段细化）

1. **SDK vs 裸 CLI**：先验证 Bun 下 `@anthropic-ai/claude-agent-sdk` 可用性（它内部 spawn Node CLI）；不可用则裸 spawn stream-json（协议已验证）。倾向：抽象层留两种驱动的空间，一期择一落地。
2. **askUser 通道**：官方引擎环境下让引擎能"问用户"——候选：平台 MCP server 新增 askUser 工具（长阻塞 + 平台 SSE 推前端 + 回答回流），类比现有提问桥。
3. **事件映射表**：官方引擎事件 → `AgentEvent`（含 thinking/subagent/tool 事件的前端扩展），一期需在 `agent/runtime/types.ts` 与前端 `conversation.vue` 同步扩展事件类型。
4. **引擎注册表落点**：`routes/agent.ts` 装配处按会话所选引擎分流到内置 `run()` 或新桥接运行时；会话元数据增加引擎字段。

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| 推理引擎 | core domain | id（builtin/claude-code/codex）、CLI 路径、版本 | 引擎绑定会话；桥接层驱动引擎 |
| 桥接层 | core domain | 引擎注册表、驱动器（SDK/CLI）、事件归一化 | 产出 AgentEvent；调用 MCP 注入 |
| AgentEvent | core domain | type、text、toolUse、thinking、subagent、seq | 前端按 type 渲染 |
| 平台工具 | core domain | ToolDefinition（画布 16 操作、媒体生成、workspaceFiles…） | 经 MCP 通道暴露给引擎 |
| 平台技能 | core domain | SKILL.md、作用域（工作区/全局） | 注入到引擎 cwd 项目级目录 |
| MCP 通道 | supporting | /mcp HTTP、stdio 桥、runtime json（url+token） | 桥接平台工具与引擎 |
| 会话映射 | core domain | 平台会话 id ↔ 引擎原生 session id、jsonl 路径 | 会话续接的锚点 |
| 对话前端 | supporting | conversation.vue、引擎选择器、事件渲染 | 消费 AgentEvent |
| 官方自带工具集 | external system | Bash/Read/WebSearch/Skill… | 引擎原生能力，全量放行 |
| 子代理/官方生态展示 | supporting | thinking 块、subagent 分组、压缩状态 | AgentEvent 驱动的前端呈现 |

## Ontology Convergence

| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 8 | 8 | - | - | N/A |
| 2 | 9 | 1（官方自带工具集） | 0 | 8 | 89% |
| 3 | 9 | 0 | 0 | 9 | 100% |
| 4 | 9 | 0 | 0 | 9 | 100% |
| 5 | 10 | 1（子代理/官方生态展示） | 0 | 9 | 90% |
| 6 | 10 | 0 | 0 | 10 | 100% |

## Interview Transcript

<details>
<summary>Full Q&A（6 轮）</summary>

### Round 0（拓扑确认）
**Q:** 诉求读解为 4 个顶层组件：推理引擎桥接层 / 平台能力注入 / 对话前端适配 / 引擎配置界面，对吗？
**A:** 拓扑正确（4 组件全激活，内置 agent 保留、引擎可切换）。

### Round 1
**Q:** 内置 agent "远比不了"官方 agent——具体比不了什么？（决定桥接深度）
**A:** 官方生态能力（子代理/skills/hooks/压缩）+ 规划与执行智能。
**Ambiguity:** 60%（Goal 0.55 / Constraints 0.25 / Criteria 0.15 / Context 0.70）

### Round 2
**Q:** 启用官方引擎后主要让它干什么？工作台（cwd）锚定在哪？
**A:** 通用助手——制作任务 + 文件读写 + 终端 + 调研，官方自带工具全量可用。
**Ambiguity:** 54%（Goal 0.70 / Constraints 0.25 / Criteria 0.15 / Context 0.75）

### Round 3
**Q:** 官方引擎拥有终端/文件全权，权限怎么管？
**A:** 权限靠后，先默认无权限限制、完全访问。
**Ambiguity:** 48%（Goal 0.75 / Constraints 0.45 / Criteria 0.15 / Context 0.75）

### Round 4
**Q:** claude code 和 codex 的实施节奏？
**A:** 先 claude code（推荐项），桥接层预留多引擎抽象，codex 二期。
**Ambiguity:** 44%（Goal 0.75 / Constraints 0.60 / Criteria 0.15 / Context 0.75）

### Round 5（Contrarian 模式）
**Q:** 终端直接跑 claude code + MCP 桥已可操作 Toonflow——"在平台 UI 里"的价值必须成立。哪些是验收必过线？
**A:** 全选：基线对话+事件流可见 / 会话续接 / 平台能力注入生效 / 官方生态完整可用。
**Ambiguity:** 23%（Goal 0.85 / Constraints 0.65 / Criteria 0.75 / Context 0.80）

### Round 6（Simplifier 模式）
**Q:** 你本机 ~/.claude/skills 已装平台技能，其他用户没有——平台技能怎么对引擎可见？
**A:** 平台自动注入（cwd 项目级注入 + 同名去重，开箱即用）。
**Ambiguity:** 19.5%（Goal 0.85 / Constraints 0.80 / Criteria 0.75 / Context 0.80）✅ 达标

</details>
