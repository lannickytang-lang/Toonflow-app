# Codex 桥接调研与源码复核记录

> 日期：2026-10-02。性质：证据记录，当前实施依据见 [codexBridgePlan.md](codexBridgePlan.md)。
> 用户最新决定：第一版先用 exec，接受正文按段出现；app-server 留到后续。
> 本次只更新方案文档，没有改桥接实现、启动付费模型或修改参考仓库。

## 1. 选型结论

app-server 提供文本/命令日志 delta、更细的原生活动与双向输入，但需要额外处理握手、RPC 响应匹配、服务端请求、取消、终态和版本 schema。不能据此断言它必定“不稳定”，可以确认它比当前 exec 路线增加实现与验证工作。

第一版采用 exec，延续 Toonflow 现有一轮一进程结构。按用户接受的粒度展示正文和实际工具过程，先完成问答、图片、原生续接、错误与停止。完整实时文本、原生输入/审批、压缩与子代理活动展示不作为本期承诺。

资料与源码依据已分别核对。SDK 的 runStreamed 表示事件流，不自动等于“回答逐字输出”；最终体验取决于 CLI 发出的事件和应用是否转发。

## 2. 本机无模型探测

首轮调研全部用命令帮助或隔离临时 Codex home；未复制用户认证文件，未发起模型推理，未创建测试代码文件。临时目录及其链接已清理，仓库技能源仍存在。

| 探测 | 实际结果 | 限制 |
| --- | --- | --- |
| 工具环境 CLI | C:\Users\oyl\AppData\Local\OpenAI\Codex\bin\be3fd7e5c1969ff6\codex.exe，0.159.0-alpha.12.1 | 不代表 Toonflow 桌面宿主 PATH；也不证明机器没有其它版本 |
| exec/resume help | 两者有 json、model、config、skip-git-repo-check；resume 没有 cd/sandbox 简写 | 参数以实施所选路径为准 |
| Windows 参数数组 | MCP HTTP/Bearer 环境变量名与 tool_timeout_sec=1800 正确回读 | 只证明参数/config 解析，没证明 MCP 实际连接 |
| 第三方协议 | wire_api="chat" 退出 1，明确要求 responses | 失败发生在请求之前，无推理用量 |
| 平台说明 | app-server config/read 正确回读 developer_instructions 的中文/换行 | 模型遵守、exec/resume 生效与用户说明合并尚需验证 |
| app-server stdio | initialize → initialized → config/read 正常 | 真实 turn/MCP/停止未验证 |
| 错误 thread | exec resume：退出 1、stdout 空、stderr 为 no rollout found；app-server 返回同语义 RPC 错误 -32600 | -32600 不只代表缺失会话，必须结合操作和执行阶段 |
| junction 删除 | Node v24.19.0 删除临时 junction，源及源内子目录完整 | 不代替 Toonflow Bun 的验证 |
| junction 发现 | app-server skills/list 分别发现 .agents/skills/workflow 与 .codex/skills/workflow 的跨盘链接技能，无加载错误 | 只证明发现/读取，未验证模型自然触发与源变更重新加载 |

原方案记录过 0.160.0 的真实 exec 问答/事件样例、暗号续接、项目技能发现，属于另一个 agent 的历史证据，不与本轮混称“全部实测”。本轮 shell 未发现 Bun，没有宣称 Bun 检查或构建完成。

正式实施 M0 仍须小范围验证：真实宿主 CLI/Bun、中文 stdin、说明与认证覆盖、事件完整字段、图片、问答、正常/停止后续接、端点工具循环及桌面窗口。

## 3. 本地 claudecodeui 现在怎么接 Codex

### 3.1 检查范围与版本

检查目录 D:\tjs\tys\claudecodeui，源码提交 dc7cb6c，提交日期 2026-09-28。Git 状态有 package-lock.json 修改，未改该仓库。

package.json 声明 @openai/codex 0.156.1、@openai/codex-sdk ^0.156.0；本地安装的 SDK 是 0.156.1。以下是本地源码/依赖的静态结论，没有运行界面或付费模型，也不宣称代表 GitHub 最新版本。

### 3.2 主聊天链路：SDK → exec

[Codex runtime](D:/tjs/tys/claudecodeui/server/modules/providers/list/codex/codex-runtime.provider.ts:313)：

    new Codex()
      → startThread / resumeThread
      → runStreamed(input, { signal })
      → 遍历 item/turn/thread 事件
      → transformCodexEvent
      → provider.sessions.normalizeMessage
      → WebSocket/writer
      → 前端消息/工具卡片

本地 [SDK 实现](D:/tjs/tys/claudecodeui/node_modules/@openai/codex-sdk/dist/index.js:177) 的参数起始为 ["exec", "--experimental-json"]；通过 stdin.write/end 输入文本，经 readline 解析事件，AbortSignal 传给子进程。该具体 flag 是此依赖版本的实现，不建议 Toonflow未经验证照抄；我们已探测的 CLI 支持 --json。

续接使用数据库中的 app session ID → providerSessionId 映射，再 resumeThread(nativeId)，新 thread ID 从 thread.started 捕获。历史扫描 ~/.codex/sessions 的原生 rollout，并把工作区/cwd 与会话索引关联；子代理 rollout 不作为普通主会话塞进侧栏。

### 3.3 过程卡片：部分 item 进度转发

[运行中的过滤](D:/tjs/tys/claudecodeui/server/modules/providers/list/codex/codex-runtime.provider.ts:390) 仅放行 command_execution、mcp_tool_call、todo_list 的 started/updated，其余 mid-flight item 跳过。随后按稳定 itemId 转发。

[事件投影](D:/tjs/tys/claudecodeui/server/modules/providers/list/codex/codex-sessions.provider.ts:2125)：

- command_execution → Bash tool_use + 配对 tool_result；aggregated_output 作为当前快照。
- mcp_tool_call → MCP 工具名、arguments、result/error 与状态。
- todo_list → 共用 TodoWrite 卡。
- file_change → Write/Edit 记录，历史读取另解析 patch_apply_end 的真实差异。
- reasoning → thinking，agent_message → 完整 assistant text。

稳定 itemId 是它合并进度的设计意图；Toonflow 应直接验证同卡更新与历史一致，不能仅靠源码注释就认定所有 UI 去重边界都解决了。

### 3.4 是否解决了实时正文

该 runtime 的一条注释称“正文走独立 streaming path”。但实际追踪发现：

- Codex 的 agent_message started/updated 被上述过滤跳过。
- Codex normalizeMessage 产出完整 text，没有产出 stream_delta/stream_end。
- SDK 类型只有 thread/turn/item 事件，未声明文本 delta 事件。
- 前端确有共用 stream_delta 接收和约 100 ms 缓冲，但在这条 Codex 主链路没有查到对应生产者。
- 会话目录 watcher 做索引刷新/会话更新；它本身不是正文 token delta 通道。

因此按本地源码，不能把它称为已经接好了 app-server 实时正文。它解决了 exec 的问答、工具卡和部分过程更新；没有证据证明完整逐字流式闭环。

### 3.5 app-server 只做分叉/编辑历史

[app-server client](D:/tjs/tys/claudecodeui/server/modules/providers/list/codex/codex-app-server.client.ts:65) 明确写为 SDK 能力之外的第二种 transport：

- 从 node_modules 解析固定版本 CLI launcher，不使用可能更旧的 PATH。
- 一次操作启动一个 app-server，完成 initialize/initialized。
- pending map + 数字请求 ID、30 秒请求超时、有限 stderr、管道错误处理。
- 执行 thread/fork，返回真实新 threadId 与 rollout path，并检查文件存在。
- finally 关闭读取并终止进程。

[分叉 provider](D:/tjs/tys/claudecodeui/server/modules/providers/list/codex/codex-fork.provider.ts:29) 与 [历史编辑入口](D:/tjs/tys/claudecodeui/server/modules/providers/list/codex/codex-sessions.provider.ts:1919) 使用它。此次 Codex 目录搜索未见 turn/start、turn/interrupt、item/agentMessage/delta 或 requestUserInput 的聊天适配。

此客户端忽略无数字 ID 的通知，只处理请求响应，没有完整的服务端请求应答。可借鉴短操作隔离、版本绑定和 pending 清理；不能直接拿来做长时间双向聊天。

### 3.6 停止与交互能力

[停止](D:/tjs/tys/claudecodeui/server/modules/providers/list/codex/codex-runtime.provider.ts:509) 标记 aborted，再 abortController.abort，SDK 取消 exec 子进程，不是 turn/interrupt。

[能力声明](D:/tjs/tys/claudecodeui/server/modules/providers/services/provider-capabilities.service.ts:74) 中 Codex supportsPermissionRequests=false。这里没有 Toonflow askUser 的现成实现，不能拿它解决我们的问题 ID/工具卡关联。

MCP 管理通过 TOML 库读写用户或项目 config.toml。该项目有配置中心职责，Toonflow 本期保持运行时注入，不照搬用户配置写回。

## 4. 对 Toonflow 的落实

适合借鉴：

1. 最新消息 + 原生 thread 续接，平台 ID 与原生 ID 分开。
2. 独立事件投影，item ID 稳定，输出快照覆盖而非重复追加。
3. turn.failed 与最终子进程异常的错误去重，避免正文后再堆无关 stderr。
4. 原生图片输入、AbortSignal、失败/中断后的统一收尾。
5. 版本与可执行路径一起诊断，防止 PATH 与所需协议不匹配。

本期不照搬：

- SDK + app-server 分叉的双驱动及原生历史编辑；当前需求不含分叉。
- 它的 fork-only RPC 客户端作为完整 app-server 聊天客户端。
- 未找到生产者的“独立文本流”注释作为实时能力证据。
- 配置中心 TOML 整体写回、全局会话扫描或新的数据层。
- 测试文件和第三方框架；Toonflow 的仓库规范继续生效。

当前计划已落实 exec 优先，并保留 Responses、说明注入、有限重跑、统计换算、图片、问题卡关联、项目级链接安全等必要修正。app-server 是明确的后续升级项，不是第一版隐藏实现。

## 5. 官方依据

首轮及后续说明均打开官方页面核对：

- [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)：exec JSONL、原生认证、续接与终态。
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)：双向 JSONL、delta、输入请求、interrupt、skills/list 与活动。
- [Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)：Responses、developer instructions、MCP 与超时。
- [Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)：HTTP MCP 和鉴权。
- [Build skills](https://learn.chatgpt.com/docs/build-skills)：技能目录与链接发现。

资料与本地静态分析不等于真实 HTTP/UI 验证。实施结果只在实际验证后填写。
