# 扩展指南（接入 codex 二期 / 引擎能力演进）

改动前先读 runtime.md 对应环节；设计取舍查 `.omc/plans/agentBridgeDecisions.md`（D1–D10）。

## 接入第二个引擎（codex）清单

骨架已就位：`packages/providers/src/language/codex.ts`（id `codex`，`kind:"engine"`，models 空）、下拉里的禁用入口、agent.ts 的拦截分支。要做的：

1. **server 引擎实现**：新建 `apps/server/src/agent/engines/codex.ts`，仿 claudeCode.ts 结构——
   - `runCodex(...)`：签名对齐 `ClaudeCodeOptions`（prompt/attachments/cwd/sessionFile/providerId/modelId/thinkingLevel/question/signal）。
   - spawn 参数：codex CLI 是 `codex exec`（JSON 输出模式与 stream-json **协议不同**，流解析要新写，勿复用 claudeStream）。
   - 会话：codex 自有会话存储与 resume 机制，先实测再写映射；`toonflowEngine` 条目结构可复用（加 engine 字段区分）。
   - 降级重跑、`registerClaudeQuestions` 等价注册（askUser MCP 工具对 codex 同样可用——平台侧是 HTTP MCP，与引擎无关）。
   - `agent/index.ts` 导出。
2. **分流**：`apps/server/src/routes/agent.ts` 把 `engineKind !== "claude-code"` 的"尚未接入"分支改为 `runCodex`。
3. **下拉解禁**：`apps/web/src/components/modelPopover.vue` `implementedEngines` 加入 `"codex"`。
4. **配置中心（若 codex 也走写回）**：`apps/server/src/utils/agentEngine.ts` 加 `readCodexLocalEnv`/`writeCodexLocalEnv`（codex 配置在 `~/.codex/config.toml`，**注意是 TOML 不是 JSON**）；`addCustomProviderDialog.vue` 的 `writeBack` 分支现在是 `engineKind === "claude-code"` 硬编码，需扩展为按引擎路由对应写回接口。
5. **技能注入**：codex 读 `AGENTS.md` 与自身 prompt 文件体系，`buildClaudeSystemPrompt`/`syncClaudeSkills` 的等价物需按 codex 机制单独设计。
6. **验证**：troubleshooting.md「测试与验证纪律」全条适用（隔离实例、deepseek-flash/便宜模型红线、跑完删脚本）。

## 引擎能力演进（改动检查单）

任何改动先过这张表：

- [ ] **内置定义改字段** → grep 全部消费方：`stores.modelChoices`、`modelPopover.modelGroups`、`resolveEngineProvider`、语言面板合成卡片。教训：D10 清空内置 models 漏查消费方，引擎从下拉消失。
- [ ] **改 spawn 注入** → 记住优先级 `--settings` env > 用户 settings.json env > 进程 env；平台配置只走 `--settings` 才可靠。
- [ ] **改流解析** → claudeStream.ts 头部注释通读；assistant content 数组不含 thinking 的索引错位是重写过的坑。
- [ ] **改写回语义** → 合并写 + `.bak` + 隔离 HOME 回归（改地址/清空/其余键保留三例）；密钥明文回显是用户明确要求（本机单用户场景），别改回打码。
- [ ] **对话框预填** → 引擎分支必须 await 本机配置后再开框（竞态已修过一次）。
- [ ] **路由文件增删** → `apps/server` 下 `bun run routes` 重新生成；server/web 双 `typecheck` + `build`，web 产物在 `build/web/`。
- [ ] 决策与知识同步：`.omc/plans/agentBridgeDecisions.md` 追加 D 节；本知识库对应文件更新。

## 已知待校准项

- 思考档位映射（MAX_THINKING_TOKENS 8k/16k/32k）是启发式，待按实际 thinking 长度校准（claudeCode.ts ACT 注释）。
- 引擎模式的思考档位：选择器照常显示，但**引擎发送时丢弃 thinkingLevel**（conversation.vue `engine ? {} : { thinkingLevel … }`）；若要支持，需在 runClaudeCode 里把 reasoningEffort 映射为 MAX_THINKING_TOKENS 并打通前端传参。
- 平台技能自然语言触发率：syncClaudeSkills 已注入，但 CLI 对技能描述的触发判断未系统验证。
- 浏览器端到端（答题卡片、续接渲染）待 DeepSeek 余额恢复后补验。
