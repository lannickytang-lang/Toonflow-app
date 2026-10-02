# 扩展指南（exec 桥接 / 引擎能力演进）

改动前先读 runtime.md 对应环节；设计取舍查 `.omc/plans/agentBridgeDecisions.md`（D1–D10）。

## Codex 已实现的入口与后续升级

当前 exec 实现为 engines/codexCode.ts（runCodexCode）、codexEnv.ts（环境/首轮说明）、codexStream.ts（JSONL 投影）。agent.ts 已分流，implementedEngines 已解禁。原生 ID/首轮提交标记存 toonflowEngine，平台历史不参与原生重放。

两引擎共用 engineRuntime.ts 的问答/占用与 skillLinks.ts 的安全项目链接。Codex 配置只保存在平台，禁止增加本机 TOML 写回；Claude 配置中心保持现有行为。新目录遵循小驼峰规范，旧复制目录不自动迁移删除。

app-server、原生分叉/历史重发、完整子代理展示、原生审批仍属后续。升级依据见 .omc/plans/codexBridgePlan.md，不要重复执行旧清单。

验证不新增测试文件或框架，仅运行类型检查、构建、手动隔离 HTTP/浏览器检查；真实 Codex 调用仅用 GPT-6-Luna / GPT-5.6-Luna。

## 引擎能力演进（改动检查单）

任何改动先过这张表：

- [ ] **内置定义改字段** → grep 全部消费方：`stores.modelChoices`、`modelPopover.modelGroups`、`resolveEngineProvider`、语言面板合成卡片。教训：D10 清空内置 models 漏查消费方，引擎从下拉消失。
- [ ] **改 spawn 注入** → 记住优先级 `--settings` env > 用户 settings.json env > 进程 env；平台配置只走 `--settings` 才可靠。
- [ ] **改流解析** → claudeStream.ts 头部注释通读；assistant content 数组不含 thinking 的索引错位是重写过的坑。
- [ ] **改写回语义** → 合并写 + `.bak` + 隔离 HOME 回归（改地址/清空/其余键保留三例）；密钥明文回显是用户明确要求（本机单用户场景），别改回打码。
- [ ] **对话框预填** → Claude 分支必须 await 本机配置后再开框（竞态已修过一次）。
- [ ] **路由文件增删** → `apps/server` 下 `bun run routes` 重新生成；server/web 双 `typecheck` + `build`，web 产物在 `build/web/`。
- [ ] 决策与知识同步：`.omc/plans/agentBridgeDecisions.md` 追加 D 节；本知识库对应文件更新。

## 已知待校准项

- 思考档位映射（MAX_THINKING_TOKENS 8k/16k/32k）是启发式，待按实际 thinking 长度校准（claudeCode.ts ACT 注释）。
- 引擎模式的思考档位：选择器照常显示，但**引擎发送时丢弃 thinkingLevel**（conversation.vue `engine ? {} : { thinkingLevel … }`）；若要支持，需在 runClaudeCode 里把 reasoningEffort 映射为 MAX_THINKING_TOKENS 并打通前端传参。
- 平台技能自然语言触发率：syncClaudeSkills 已注入，但 CLI 对技能描述的触发判断未系统验证。
- Codex 浏览器历史、问答和模型入口已隔离验证；Claude 真实模型回归仍待可用配置。
