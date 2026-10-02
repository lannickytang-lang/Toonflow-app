# 本机引擎桥接（Claude Code / Codex）知识库导读

面向后续接手的 AI（或人）：理解本机 Claude Code / Codex exec 桥接、定位故障与扩展能力。旧的 Claude 一期细节仍保留，Codex 当前行为见下方补充及实施计划。

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
- Codex exec 已接入并开放模型入口；app-server 留到后续。实施及已验证/未验证边界见 [codexBridgePlan.md](../../.omc/plans/codexBridgePlan.md) 第 13 节。

## Codex 与共享能力（2026-10-02）

- 每条消息启动 `codex exec` 或 `exec resume`，消息走 stdin，JSONL 过程复用平台事件；原生 ID 取得后立即保存。
- 平台说明只附带于新原生会话首轮，平台展示历史仍是原始输入。首次立即停止可能只有 ID、尚未提交输入，以 codexInstructionsSent 和只读原生记录区分；下一轮只补说明，不重放取消任务。
- Codex 地址/key 属于平台条目；均空沿用 CLI 配置，只有 key 用官方 Responses，只有 URL 允许无鉴权。Claude 的本机配置中心行为不应用于 Codex。
- 共享入口 `engineRuntime.ts` 负责问答与占用，`skillLinks.ts` 负责项目技能链接。清单损坏失败；用户目录、外部链接、旧复制目录均保留并提示冲突，只 unlink 可确认归属的平台链接。
- 正文按实际整段显示，统计扣除缓存输入；Codex 思考档位已按模型能力接通，不承诺原生审批/子代理的完整过程展示。
- 本机模型自动发现：GET /api/agentEngine/models 读取 Codex debug models 的可见目录及 TOML 默认模型，Claude 读取显式配置模型。设置和下拉共用目录与手动配置，跟随本机项显示默认名；平台自定义 Codex 端点只用平台模型。目录不等于已验证调用权限。

## 历史与过程记录（按需查阅）

- 决策记录（含 spike 实测、两次错误归因教训）：`.omc/plans/agentBridgeDecisions.md`
- 需求访谈晶化 spec：`.omc/specs/deep-interview-agentBridge.md`
- 实施计划：`.omc/plans/agentBridgePlan.md`、`.omc/plans/agentEngineModelsPlan.md`
- 本知识库锚点均为「文件 + 函数名」，不写行号（代码会漂移）。
