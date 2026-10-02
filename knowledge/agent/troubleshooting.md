# 故障定位速查（现象 → 根因 → 处置）

每条都是真实踩过/修过的坑。先对现象，再用"定位"列的锚点进代码确认。

## 对话与流渲染

| 现象 | 根因 | 定位与处置 |
| --- | --- | --- |
| 对话完全无回复、CLI 卡住无输出 | 先怀疑**服务端模型供应商故障**，再查本地 | Spike 教训：曾两次错误归因（窗口强制/env 注入），真实原因是 DeepSeek flash 服务端故障。先换便宜模型 curl 直测端点，再查 `GET /api/agentEngine/status`（CLI 探测）|
| 引擎报"没有可用模型"或模型不对 | `--model` 传了本机端点不认的 id | `resolveEngineProvider().modelIds` 来自平台条目 models；现状是"不在列表就不传 --model 用 CLI 默认"，若仍报错查条目里存的 id 与本机端点是否匹配 |
| 文本/思考块错乱、重复或互相覆盖 | claudeStream 块索引机制被改动 | assistant 完整消息 **content 数组不含 thinking**，索引与 content_block 序列错位——blockId 必须按 `content_block_start` 原始索引分配，assistant 只补 tool_use 入参。改前通读 `claudeStream.ts` 头部注释 |
| 工具卡片重复/不闭合 | tool_result 的 blockId 没映射回 tool_use | `toolBlockIds` Map（claudeStream.ts） |
| 续接丢上下文 / 报 is_error 无正文 | 引擎会话文件被删或不兼容 | 降级重跑逻辑（claudeCode.ts `execute(resume)`）会自动换新会话重跑一次；手动核对转义路径：cwd 所有非 `[a-zA-Z0-9-]` 字符（含 `.`）各转一个 `-` |
| 前端渲染了 hooks/插件噪音 | `disableAllHooks` 或 type 白名单失效 | `--settings` 里的 `disableAllHooks:true` + claudeStream type 白名单 |

## 弹窗（Windows）

| 现象 | 根因 | 处置 |
| --- | --- | --- |
| 对话时弹出大量 cmd 窗口 | 宿主无 console 时，claude 内部 spawn 的子进程（hooks/插件 MCP/stdio 桥）各弹一个窗口 | 防弹窗三件套是否都在：`--strict-mcp-config` + `--settings disableAllHooks:true` + HTTP MCP 直连（`prepareMcpConfig`，不是 stdio 桥）；spawn `windowsHide:true` |

## 配置与写回

| 现象 | 根因 | 定位与处置 |
| --- | --- | --- |
| 引擎 key/地址改了不生效 | 优先级链搞错 | **`--settings` env > 用户 `~/.claude/settings.json` env > 进程 env**（实测）。平台注入走 `--settings`；平台条目 apiUrl/apiKey 恒空串，真相源是本机文件 |
| 平台改 key 覆盖了别人 / 本机改动没进平台 | 配置中心语义误解 | 平台保存 = 写回本机文件（只动两键，`.bak` 备份）；反过来用户手改本机文件，平台**下次打开对话框**回显新值；进行中会话不受影响 |
| 对话框地址/密钥没预填本机值 | localEnv 异步竞态 | `openEngine`/`openCustomProvider` 必须**先 `await ensureClaudeLocalEnv()` 再开框**（index.vue）——这是修过的 bug，别退回"开框后顺便拉取" |
| 密钥框看不到真实值 / 留空行为困惑 | D10 之前是打码 + 留空保留 | 现状：明文回显可直接编辑；**清空保存 = 删键**（地址回官方默认、密钥回 CLI 登录），写回始终传 apiKey（`PUT /api/agentEngine/localEnv`） |
| 写回后 hooks/permissions 丢失 | `writeClaudeLocalEnv` 被改成整体覆盖 | 必须合并写：读原 config → 只增删 env 两键 → 写回 + `.bak`。有隔离 HOME 回归脚本思路（伪造 settings.json 断言其余键保留） |

## 模型下拉

| 现象 | 根因 | 定位与处置 |
| --- | --- | --- |
| 下拉里选不到引擎 | "开箱即见"合成链断了 | 两个数据源都要有兜底：`stores.settings` `modelChoices`（未添加引擎合成选项）+ `modelPopover` `modelGroups`（models 空补"CLI 默认模型"）。**清空内置 models 这类源头数据时，必须检查全部消费方**（D10 回归的教训） |
| 下拉出现 sonnet/opus/haiku 占位名 | 内置定义 models 被填回 / 旧条目未清洗 | 内置 `models:[]`；对话框打开时 legacy set（sonnet/opus/haiku/gpt-5.2 系）整表清洗 + 预填本机 ANTHROPIC_MODEL（addCustomProviderDialog.vue） |
| 选"CLI 默认模型"发消息 400 | 空串 modelId 撞 schema | `agent.ts` inputSchema `modelId: z.string().min(1).optional()`——前端必须**空串不传字段**（conversation.vue），server 端才走"不加 --model"分支 |
| 下拉有 Codex 但不可选 | 页面或构建版本较旧 | 当前 implementedEngines 已包含 codex，刷新并核对实际部署版本 |

## 桌面端壳层

| 现象 | 根因 | 处置 |
| --- | --- | --- |
| `Invalid guestInstanceId` / 页面加载失败（Electron IPC 文案） | Electron 壳层窗口实例失效（dev 热重启重建窗口的竞态），**不是页面代码问题** | 完全退出（任务管理器清残留 toonflow/electrobun/bun 进程）→ 重新 `bun run dev:desktop`。稳定复现再查 `apps/desktop/src/index.ts` 窗口生命周期 |
| 改了 web 源码、build 过了，桌面里没变化 | 桌面加载的是构建副本 | `electrobun.config.ts` copy `build/web → views/mainview`；重跑 dev/desktop 构建流程（build.ts dev 会重建 web 并 copy） |

## 测试与验证纪律

- **端口 3000 是用户真实实例，禁止动**。隔离测试用 `createApp` 起 3712 随机实例 + `TOONFLOW_DATA_DIR` 指临时目录；伪造 `~/.claude/settings.json` 时同时设 `USERPROFILE`/`HOME`（Windows homedir 走 USERPROFILE）。
- 真实模型验证**用 deepseek-flash 问简单问题**（用户红线：不许用贵模型测试）。
- 写回类验证必须在隔离 HOME 下做，跑完核对用户真实 `~/.claude/settings.json` 完好（历史基线：13 个 env 键）。
- 临时验证脚本跑完即删，不进仓库；禁止新增测试文件。
- 改 web 后必须 `bun run build`（输出在仓库根 `build/web/`，不是 `apps/web/dist`），只跑 typecheck 用户看不到变化。

## Codex exec 排查补充

- 先看状态中独立 codex 探测结果与 codexPath，配置原生 exe，避免命令脚本 shim。版本警告不应当作版本。
- 只有明确原生 rollout 不存在才新建一次；认证、限流、MCP、供应商错误不会重跑。模型无效应修配置，不自动换默认模型。
- 首轮立即停止后有 ID 但无输入是 CLI 初始化时序；codexInstructionsSent=false 的下一轮仅补平台说明，取消的用户任务不重放。
- 技能冲突不会自动删除用户目录或旧复制目录。损坏清单需人工确认内容及归属，不能用 recursive rm 清整片 skills。
- 自定义服务必须支持 Responses；Codex 不读取/写回 Claude 本机地址或密钥。第三方认证与打包桌面子进程窗口尚未实测，见实施计划。
