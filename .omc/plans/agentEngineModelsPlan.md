# 方案：官方引擎接入平台统一"文本模型"体系（claude code / codex 像普通供应商一样配置）

状态：方案待确认（2026-10-03）。上游：`.omc/plans/agentBridgePlan.md`（一期已落地）、`.omc/plans/agentBridgeDecisions.md`。

## 0. 目标

1. 文本模型设置面板内置 **Claude Code / Codex** 两张供应商卡片：可填 API Key（可选）、API 地址（可选）、模型列表（预置 + 可编辑）。
2. 对话模型下拉里官方引擎的模型与普通文本模型并列，**可选模型、可选思考强度**。
3. 设置保存后**下一条消息立即生效**，无需重启。

## 1. 调研结论

### 1.1 平台内置供应商机制（现成可复用）

- 内置定义在 `@toonflow/providers` language 包：`{id,label,version,apiUrl,protocol,readme,rules,models}`（`packages/providers/src/language/{tfRouter,deepSeek}.ts`）；`models` 预置非空时"添加供应商"对话框**跳过 API 拉取直接用**（`addProviderDialog.vue:99-102`）。
- 用户添加后落到 `settings.customProviders`（面板卡片/编辑/删除都是对它的常规操作）。
- **server 端也能 import 内置定义**（`apps/server/src/utils/conf/index.ts:3` 就在 import tfRouter）——前后端共享一份定义无障碍。
- `providerSchema`（`utils/ai/index.ts:13`）当前强制 `apiUrl`(z.url) 与 `protocol` 必填——engine 型供应商没有这两个值，**需放宽为可选**。

### 1.2 claude CLI 配置机制（一期实测 + CLI 约定）

| 配置项 | 通道 | 说明 |
| --- | --- | --- |
| 认证 | env `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` | 用户本机即此方式（~/.claude/settings.json env 块） |
| 模型 | `--model <id>` 命令行 | 优先级最高；第三方模型名可透传（unrecognized 警告无害，`[1m]` 后缀声明窗口）；每条消息独立 spawn，**每消息可换模型** |
| 思考强度 | env `MAX_THINKING_TOKENS` | 按档位映射 token 预算（映射值待实测校准） |
| ⚠️ 优先级风险 | `~/.claude/settings.json` 的 env 块 | **用户本机已配置 ANTHROPIC_*，可能覆盖平台 spawn 注入的进程 env**。稳妥通道：`--settings '{"env":{...}}'`（命令行 settings 优先级高于用户 settings 文件）。一期弹窗修复已用 `--settings` 传 disableAllHooks，同一 JSON 里合并 env 即可 |

### 1.3 codex CLI 配置机制（二期方向，本轮只预留）

- 非交互：`codex exec --json "<prompt>"`；认证：env `OPENAI_API_KEY` 或 `~/.codex/auth.json`（ChatGPT 登录）。
- 配置覆盖用 `-c key=value`（TOML 路径覆盖，不写文件）：`-c model="gpt-5.2"`、`-c model_providers.<id>.base_url="..."`、`-c model_reasoning_effort="low|medium|high"`。
- 事件协议与 claude 完全不同（thread 事件流），桥接层二期按 claudeStream 模式另写 codexStream。
- `runCodex` 未实现前，codex 供应商卡片可以先出（配置保存），选中发送时报"codex 引擎二期接入"。

### 1.4 设置生效链路（零新增机制）

桥接架构天然解决：**每条消息 spawn 一次进程，spawn 时现读 settings**。保存 key/模型/思考强度 → 下一条消息即按新配置 spawn；正在运行中的一轮不受影响（进程已起）。前端 `modelChoices` 是 computed，settings 更新自动反映到下拉。

## 2. 设计

### 2.1 设置形态：内置定义 + 前端合成显示 + customProviders 落地

**新增内置语言供应商定义**（`packages/providers/src/language/`）：

```ts
// claudeCode.ts
export default {
  id: "claude-code",            // 与引擎标识同名，分流判定零映射
  label: "Claude Code（本机引擎）",
  version: "1.0.0",
  kind: "engine",               // 新增可选字段；引擎型供应商
  engine: "claude-code",
  readme: "使用本机安装的 Claude Code CLI 推理。API Key 与地址留空时使用 CLI 自身登录（订阅/API 均可）。",
  rules: [                      // apiKey 可选；新增 apiUrl 可选字段
    { type: "input", field: "apiKey", title: "API Key（留空使用 CLI 自身登录）", props: { type: "password", showPassword: true } },
    { type: "input", field: "apiUrl", title: "API 地址（留空使用官方端点）", value: "" },
  ],
  models: [                     // 预置，可在编辑对话框增删
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-opus-4-1", label: "Claude Opus 4.1" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
}
// codex.ts 同构：id "codex"，models 预置 gpt-5.2-codex 等，readme 注明需本机安装 codex CLI
```

**显示与落地策略（避免迁移与"删除对抗"）**：
- 对话下拉 `modelChoices`：customProviders 平铺结果 + **未添加的内置引擎供应商合成条目**（已添加则不重复）→ 开箱即见。
- 设置面板：同样合成两张引擎卡片（未添加态显示"添加"引导，key 留空也可添加）；添加后走 customProviders 常规编辑/删除。
- **不自动写 customProviders**（不改 conf/index.ts 初始化逻辑）——零迁移、删除后不复活。
- **server 回退**：engine 分流解析供应商配置时，customProviders 无此条目 → 回退内置定义（apiKey 为空 = CLI 自身认证）。用户"没配置也能用，配置了按配置"。

**schema 放宽**（`providerSchema`）：`apiUrl`/`protocol` 改可选；内置 agent 消费端（`getConfiguredModel`）对 engine 型供应商（id ∈ 内置 engine 集）显式拒绝："该供应商由本地引擎使用，不支持内置 Agent"。

### 2.2 server 端映射（claudeCode.ts 扩展）

```
resolveEngineProvider(providerId)  →  customProviders 查找 ?? 内置定义
  ├─ apiKey  → --settings {"env":{"ANTHROPIC_AUTH_TOKEN": key}}   （非空才注入）
  ├─ apiUrl  → 同上 {"env":{"ANTHROPIC_BASE_URL": url}}           （非空才注入）
  ├─ modelId → --model <modelId>                                   （每消息，支持会话中途切换）
  └─ thinkingLevel → MAX_THINKING_TOKENS 映射                       （默认不传=引擎自适应）
       低 → 8192；中 → 16384；高 → 32768（ACT: 档位值待实测校准）
```

- 全部经 `--settings` 注入而非进程 env：**命令行 settings 优先级高于用户 ~/.claude/settings.json 的 env 块**，保证平台配置压过本机遗留配置（spike S5 验证）。
- 现有 `settings.agentEngine`（CLI 路径/超时/extraEnv）保留，extraEnv 仍最后展开（用户显式覆盖平台注入的逃生门）。
- 会话绑定规则不变（会话绑引擎不绑模型）；落盘 `appendModelChange("claude-code", modelId)` 已支持记录模型变更。

### 2.3 前端会话发起（conversation.vue / modelPopover.vue）

- 删除硬编码 `claudeChoice`；引擎判定改为 `providerId ∈ 内置 engine id 集合`（定义从 `@toonflow/providers` import，前后端同源）。
- 发送 body：engine 供应商也传 `providerId + modelId`（现方案只传 engine）；`thinkingLevel` 照常传（现在是省略的）。
- `routes/agent.ts` 分流条件：`engine === "claude-code"` 或 `providerId` 是引擎型 → claudeCode 分支（从 providerId 解析 modelId）。
- codex 选中时：发送前前端拦截提示"Codex 引擎将在下期支持"（或后端拒绝，取后端，前端只做禁用态）。
- 推理等级 UI 对引擎供应商照常可用；`contextWindow` 显示：内置定义 models 补 contextWindow 字段（claude 4.5 系 200k/1m），无则沿用默认 262144。

### 2.4 生效与切换语义汇总

| 变更 | 生效时机 |
| --- | --- |
| API Key / API 地址 | 下一条消息（spawn 现读 settings） |
| 模型（下拉切换） | 立即（下一消息 --model 新值；同一引擎会话中途换模型由 --resume 天然支持） |
| 思考强度（档位切换） | 下一条消息 |
| CLI 路径/超时/extraEnv（官方引擎面板） | 下一条消息 |
| 已在运行中的一轮 | 不受影响（进程已起，结束后按新配置） |

## 3. Spike 清单（实现前验证，低成本）

| # | 验证项 | 方法 | 成本 |
| --- | --- | --- | --- |
| S5 | 平台注入覆盖用户 settings：`--settings '{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:9"}}'` + 现有 ~/.claude 配置 → 若报连接错误（打到 9 端口）证明 `--settings env` 赢 | 一次 `-p "回复ok"` | 极低（连接拒绝则 0 token） |
| S6 | 进程 env 是否也被 settings env 覆盖（决定是否需要 fallback） | 同 S5 对照组：去掉 --settings 只传进程 env | 同上 |
| S7 | MAX_THINKING_TOKENS 档位效果 | 同一问题 low/high 各一次，对比 thinking 块长度 | 2 次小请求（可并入实现期） |
| S8 | codex exec --json 事件协议 | 装 codex 后跑一次 | 二期前 |

S5/S6 一次对话内即可完成（两条短消息），符合"不烧钱"约束。

## 4. 改动文件清单

| 位置 | 改动 |
| --- | --- |
| `packages/providers/src/language/claudeCode.ts`、`codex.ts`（新） | 内置定义（kind/engine 字段扩展进 ProviderDefinition 类型） |
| `packages/providers/package.json` | exports 加两个语言供应商 |
| `apps/server/src/utils/ai/index.ts` | providerSchema 放宽（apiUrl/protocol 可选）；getConfiguredModel 拒绝 engine 型 |
| `apps/server/src/agent/engines/claudeEnv.ts` | prepareEngineSpawn：合并供应商 apiKey/apiUrl/thinking 到 --settings JSON |
| `apps/server/src/agent/engines/claudeCode.ts` | resolveEngineProvider（含内置回退）；--model/--settings 由 provider 配置驱动 |
| `apps/server/src/agent/engines/builtin.ts`（新，或放 claudeEnv） | 内置引擎清单与回退解析（server import @toonflow/providers） |
| `apps/server/src/routes/agent.ts` | 分流条件扩展（providerId 引擎型） |
| `apps/web/src/stores/settings.ts` | modelChoices 合成未添加的内置引擎条目 |
| `apps/web/src/components/agent/conversation.vue` | 删硬编码 claudeChoice；engine 判定；providerId/modelId/thinkingLevel 传参 |
| `apps/web/src/components/modelPopover.vue` | 删硬编码分组；engine 分组来自内置定义 |
| `apps/web/src/components/settings/panels/languageModel/*` | 引擎卡片合成显示（未添加态）；apiKey/apiUrl 非必填校验 |
| `apps/web/src/components/settings/panels/agentEngine.vue` | 保留（CLI 路径/超时/extraEnv 全局项）；模型字段移除（由供应商管理） |

## 5. 风险与边界

- **S5 若 `--settings env` 不生效**：fallback = 让用户清 ~/.claude/settings.json 的 env（文档说明），或平台侧写 `--append-system-prompt` 无法解决认证——最终手段是生成临时 `CLAUDE_CONFIG_DIR`（隔离 claude 配置目录，平台完全接管配置），改动可控但涉及 CLI 配置目录语义，先 spike 再定。
- **用户编辑引擎供应商模型列表填了非法模型名**：CLI 报错如实回传（error 事件），与手填 --model 行为一致。
- **codex 一期不可用但卡片可见**：卡片 readme 与发送拦截都注明"二期"，避免"配置了不能用"的困惑。
- **thinking 档位映射值**是启发式（ACT 注释），S7 校准后调。

## 6. 工作量

定义 + schema + server 映射约 0.5 天；前端（下拉/面板/发送）约 0.5 天；S5–S7 验证 0.5 天内。合计 1–1.5 天。
