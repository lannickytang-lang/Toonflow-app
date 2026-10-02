# 桥接运行全流程（消息链路 → spawn → 流解析 → 会话 → 配置）

链路中的权威文件与函数索引，改动任何一环前先读对应实现。

## 1. 供应商定义层（引擎是文本模型体系的一等公民）

- 内置引擎唯一源：`packages/providers/src/language/claudeCode.ts`（id `claude-code`）、`codex.ts`（id `codex`）。`kind:"engine"` + `engine:"<kind>"` 是引擎型标识（类型见 `packages/providers/types.d.ts`）。
- **`models` 刻意为空数组**：真实模型取决于本机接入的端点（如 DeepSeek），内置占位名（sonnet/opus/haiku）已移除（D10）。引擎规则里 apiKey/apiUrl 均可选（留空 = CLI 自身配置）。
- server 侧引擎注册表：`apps/server/src/utils/ai/index.ts` 的 `engineProviders` / `isEngineProvider` / `getEngineKind`（从 `@toonflow/providers` 过滤 `kind==="engine"`）；`getConfiguredModel` 显式拒绝引擎型（引擎不走内置 Agent 的 provider 调用）。
- 用户配置条目存 `settings.customProviders`（与普通自定义供应商同层）。**Claude 条目的 apiUrl/apiKey 恒为空串**——本机文件是唯一真相，平台条目只管模型列表（D9）。

## 2. 消息链路（前端 → spawn → 事件流回传）

1. **前端发送**：`apps/web/src/components/agent/conversation.vue` `sendMessage` → `POST /api/agent`。引擎模型时：不传 `thinkingLevel`/`canvas`（思考档位由 MAX_THINKING_TOKENS 注入替代，画布上下文引擎自持）；`modelId` 为空串时**不传该字段**（schema `min(1)`，空串会被 Zod 拒 400；空串语义 = "CLI 默认模型"）。
2. **分流**：`apps/server/src/routes/agent.ts` —— `providerId` 命中 `u.ai.isEngineProvider` 即进引擎分支，分别调用 runClaudeCode / runCodexCode；其他引擎仍拒绝。
3. **spawn 准备**（`apps/server/src/agent/engines/claudeEnv.ts`）：
   - `prepareMcpConfig()`：平台工具走 **HTTP MCP 直连**（`{"type":"http","url":getMcpRuntime().endpoint}`，由启动时 `initializeMcpRuntime` 注入；需要鉴权时带 Bearer），写临时 `claudeMcp.json` 传给 `--mcp-config`——不用 stdio 桥，防弹窗的关键一环。**MCP 未启用时直接 400"官方引擎依赖它调用平台工具"**（引擎对话的前置条件）。
   - `resolveEngineProvider(providerId)`：customProviders 条目优先（apiUrl/apiKey 空串 = 不注入），否则回退内置定义。
   - `syncClaudeSkills(cwd)`：平台技能同步进项目级 `.claude/skills/`，`.toonflowInjected` 清单管理增量（只动清单内目录，不碰用户自建技能）；`-p` 模式默认读项目级技能。
   - `buildClaudeSystemPrompt(cwd)`：`--append-system-prompt` 追加平台上下文。
4. **spawn**（`apps/server/src/agent/engines/claudeCode.ts` `runClaudeCode`）：
   ```
   claude -p <内容> --output-format stream-json --verbose --include-partial-messages
     --permission-mode bypassPermissions --strict-mcp-config
     --settings <json> --append-system-prompt <提示> [--model <id>] [--resume <引擎会话id>]
   ```
   - `--settings` JSON：`disableAllHooks:true`（宿主插件噪音）+ `env` 注入（有值才注）：`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、`MAX_THINKING_TOKENS`（low 8192 / medium 16384 / high 32768，ACT 注释标注的启发式映射，待校准）。
   - **注入优先级（实测）**：`--settings env` > 用户 `~/.claude/settings.json` env 块 > 进程 env。平台配置必须走 `--settings`（进程 env 会被用户 settings 覆盖）。
   - **防弹窗三件套**：`--strict-mcp-config`（不加载插件 MCP）+ `disableAllHooks` + HTTP MCP 直连；spawn 本身 `windowsHide:true`。背景：宿主无 console 时 claude 内部 spawn 的子进程（hooks/插件 MCP/stdio 桥）会各弹一个 cmd 窗口。
   - `--model`：前端传的 modelId 不在 `resolveEngineProvider().modelIds` 内（含未传）就**不加该参数**——CLI 用自身默认（env `ANTHROPIC_MODEL` 或官方默认）。
   - `getAgentEngineSettings()`（engineRuntime.ts）：claudePath / codexPath / timeoutMinutes / extraEnv（设置页"Agent 引擎"面板，`apps/web/src/components/settings/panels/agentEngine.vue`）。
5. **流解析**（`apps/server/src/agent/engines/claudeStream.ts`）：stream-json NDJSON → 平台事件。
   - blockId 由 `content_block_start` 的**原始数组索引**分配（thinking delta 字段名 `thinking`、text 字段名 `text`）；`content_block_stop` 收口。
   - **assistant 完整消息的 content 数组不含 thinking**——索引与 content_block 序列错位，这是重写过一版的根因：assistant 事件只按序匹配 toolBlocks 补 tool_use 完整入参；退化模式（blocks 空）才按数组索引整块补发。
   - system:init 携带 session_id（引擎会话 id 的来源）；hook 噪音按 type 白名单过滤。
6. **回传前端**：`u.agent.run({…}, send)` 输出 AgentEvent NDJSON（text/thinking/tool/question/userMessage/session/stats/done），conversation.vue 逐事件渲染。

## 3. 会话映射（双真相模型）

- 引擎真相：`~/.claude/projects/<转义cwd>/<uuid>.jsonl`。**转义规则：cwd 所有非 `[a-zA-Z0-9-]` 字符（含 `.`）各转一个 `-`**（降级测试曾因只转 `\/:` 而没真删文件）。
- 平台真相：工作区 `.agent/sessions/` Pi SessionManager JSONL，仅供前端渲染历史。
- 映射存储：平台会话里的 `customType:"toonflowEngine"` 自定义条目（`apps/server/src/agent/runtime/sessions.ts` `getEngineInfo`），存引擎会话 id + 模型。续接时作为 `--resume` 传入。
- **降级重跑**：resume 指向的引擎会话被删/不兼容 → CLI 整跑 is_error 且无正文 → 丢弃映射、按全新会话重跑一次（claudeCode.ts `execute(resume)` 两阶段）。
- 重发按钮（resendFrom）引擎模式禁用——引擎上下文自持，平台无法替它回滚。

## 4. askUser 闭环（平台人工确认点）

1. MCP 工具 `askUser`（`apps/server/src/utils/mcp/tools.ts`，描述引导 CLI "需要确认/选择时调用；不回答会一直阻塞"）。
2. 两个官方驱动启动时 `registerEngineQuestions(cwd, context, send)`（engineRuntime.ts）注册等待回调；工具触发 → 前端弹答题卡片 → 用户作答 → 回调注入答案，CLI 继续同一轮推理。
3. 进程 env `MCP_TOOL_TIMEOUT=1800000`（30 分钟，与 MCP 端上限一致）给足等待。

## 5. 配置中心（引擎卡片 ↔ 本机 settings.json）

- 读写工具：`apps/server/src/utils/agentEngine.ts` —— `readClaudeLocalEnv()`（BASE_URL 明文、AUTH_TOKEN **明文**、ANTHROPIC_MODEL）+ `writeClaudeLocalEnv(apiUrl, apiKey?)`：合并写 `~/.claude/settings.json`，只增删 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` 两键，hooks/permissions/其余 env 原样保留，写前滚动备份 `.bak`。空串 = 删该键（回官方默认 / CLI 自身登录）。
- 路由：`GET /api/agentEngine/status`（CLI `--version` 探测 + localEnv 回显）、`PUT /api/agentEngine/localEnv`（写回，写后返回最新 localEnv）。
- 前端：`apps/web/src/components/settings/panels/languageModel/index.vue` —— 未添加引擎合成卡片（pendingEngines），`openEngine`/`openCustomProvider`（引擎条目）**先 `await ensureClaudeLocalEnv()` 再开对话框**（否则异步竞态导致预填落空）。
- 对话框 `addCustomProviderDialog.vue` 引擎模式：id/label 锁定、协议隐藏、无"获取模型列表"；地址/密钥**明文回显本机真实值**直接编辑；打开时若条目模型全等于旧占位集合（legacy 硬编码 set：sonnet/opus/haiku/gpt-5.2 系）则替换为本机默认模型。保存顺序：先写回本机（成功才继续）→ 平台条目 upsert（apiUrl/apiKey 落空串）。
- 行为语义：平台里改 key/地址 → 本机终端的 claude 下次启动同样生效（共享一份文件）；进行中的会话不受影响（CLI 启动时读一次）。

## 6. 模型选择链路（下拉 ↔ --model）

- `apps/web/src/stores/settings.ts` `modelChoices`：未添加引擎合成选项（内置 models 非空用之；**为空则合成一条"CLI 默认模型"，value `["claude-code",""]`**）；已添加用条目 models。默认选中跳过引擎。
- `apps/web/src/components/modelPopover.vue` `modelGroups`：引擎分组置顶；models 空时补"CLI 默认模型"项（保证开箱可选，D10 回归修复）；`implementedEngines` 已包含 Claude Code 与 Codex；均提供 CLI 默认项。
- 传递：conversation.vue 发送 → agent.ts → `runClaudeCode`：modelId 不在列表/未传 → 不加 `--model` → CLI 默认。stats 事件里 engineModel 兜底 `"default"`，assistant 事件返回的 model_used 会覆盖。

## 7. Codex exec 与共享安全边界

- prepareCodexEnvironment 使用独立 Responses provider 与环境密钥，模型独立覆盖；均空保留 CLI 原配置，不修改用户文件。HTTP MCP 参数逐轮提供，平台说明仅新原生会话首次输入附带。
- codexStream 用 StringDecoder 解析 UTF-8 JSONL，同 item 完整快照覆盖；完成事件且退出码 0 才成功。缓存输入从总输入扣除，不用整轮耗时伪造解码速度。
- codexThreadId 在 thread.started 立即存；codexInstructionsSent 记录首轮提交。初始中断只读原生记录确认，未提交则下一条输入补说明。只有明确 no rollout found 且未开始回合才新建一次。
- 问答先创建同 ID 卡片再发送问题，回答/跳过/取消持久化终态；同工作区只允许一个官方回合，未指定目录只允许唯一活跃回合兜底。
- 项目技能链接共用 skillLinks；清单损坏失败，用户目录/外部链接/旧复制目录保留并提示冲突。清理仅 unlink 指向与清单均匹配的链接，清单原子写入。
- Claude 本机配置中心规则只限 Claude。Codex 地址/key 回读平台条目，当前动态显示模型声明的思考档位。官方会话与内置 Agent 不允许相互接管已有消息。
