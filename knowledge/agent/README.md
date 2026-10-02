# 本机引擎桥接（Claude Code / Codex）知识库导读

面向后续接手的 AI（或人）：快速理解平台如何把本机 claude code CLI 桥接为对话推理引擎、准确定位故障、扩展第二个引擎（codex 二期）。四份文档按目的索引：

| 我想… | 读哪份 |
| --- | --- |
| 理解桥接怎么运行：消息链路/会话映射/配置体系/注入机制全流程 | [runtime.md](runtime.md) |
| 排查用户报告的对话故障（无回复/弹窗/配置不生效/渲染错乱…） | [troubleshooting.md](troubleshooting.md) |
| 接入新引擎（codex 二期）或扩展引擎能力 | [extend.md](extend.md) |
| 了解某个设计为什么这样定 | `.omc/plans/agentBridgeDecisions.md`（D1–D10 决策记录，含实测依据） |

## 30 秒速览

- **桥接 = 官方 CLI 接管完整推理循环**（子代理、技能、上下文压缩都是 claude 原生能力）。平台只做四件事：传输消息、解析事件流渲染 UI、注入平台工具（HTTP MCP：askUser 等）、维护会话映射。
- **每条消息 spawn 一次 CLI**：`claude -p <内容> --output-format stream-json … [--resume <引擎会话id>]`。引擎原生会话（`~/.claude/projects/<转义cwd>/` 下的 jsonl）自持推理上下文，只发最新一条消息。
- **双真相会话模型**：引擎 jsonl 是推理上下文（CLI --resume 用）；平台 Pi SessionManager（工作区 `.agent/sessions/`）仅供前端渲染；两者靠引擎条目里的 toonflowEngine 自定义条目映射。
- **配置中心模式（D9/D10）**：本机 `~/.claude/settings.json` 是 key/地址的唯一真相源。平台设置页的引擎卡片 = 该文件的图形化编辑器：保存即写回（合并写，只动 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` 两键），密钥/地址明文回显，平台条目本身不落这两个值（只存模型列表）。
- **引擎是文本模型体系里的一等公民**：内置定义在 `packages/providers/src/language/{claudeCode,codex}.ts`（`kind:"engine"`），出现在设置面板、模型下拉、对话分流各处；`models` 刻意为空数组——真实模型取决于本机端点（如 DeepSeek），不放占位名。

## 定位与边界（为什么这样设计）

- 内置 Agent（Pi SDK 单循环）能力远弱于官方 agent，桥接的目标是"平台内用上完整官方能力"，而不是把官方能力搬进内置循环。因此引擎型供应商不走内置 Agent 的 provider 调用（`utils/ai` 的 getConfiguredModel 直接拒绝引擎型）。
- 权限默认全放开（`--permission-mode bypassPermissions`）：通用助手定位，平台侧靠 askUser 卡片保留人工确认点。
- 一期只接 claude code；codex 内置定义与 UI 位置已占好（下拉里禁用态），接入清单见 extend.md。

## 历史与过程记录（按需查阅）

- 决策记录（含 spike 实测、两次错误归因教训）：`.omc/plans/agentBridgeDecisions.md`
- 需求访谈晶化 spec：`.omc/specs/deep-interview-agentBridge.md`
- 实施计划：`.omc/plans/agentBridgePlan.md`、`.omc/plans/agentEngineModelsPlan.md`
- 本知识库锚点均为「文件 + 函数名」，不写行号（代码会漂移）。
