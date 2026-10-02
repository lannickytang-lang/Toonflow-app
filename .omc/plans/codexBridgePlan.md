# Codex 引擎桥接实施方案（二期，exec 优先）

> 更新日期：2026-10-02。状态：exec 实现已完成；验证结果及未验证项见第 13 节。
> 用户最新决定：第一版先沿用 exec，降低接入与验证复杂度；app-server 留到后续。
> 本文是当前实施依据；[codexBridgeReview.md](codexBridgeReview.md) 保存调研证据及 claudecodeui 源码对照。
> 本轮已实施并使用指定的 Luna 模型完成隔离验证，未发布、未修改或重启用户正在使用的实例。

## 0. 交付目标与明确取舍

第一版将本机 Codex CLI 作为第二个官方引擎接入 Toonflow，沿用 Claude 的“一条平台消息启动一次 CLI”结构。Codex 管完整推理循环，平台管理配置注入、过程投影、问答、展示历史和原生会话映射。内置 Agent 保留并仍为默认。

必须交付：

- 问答、命令执行、MCP 工具调用及其结果正确显示。
- 多轮与重启后按原生 thread ID 续接，逐消息选择模型。
- 原生图片附件、平台 askUser 答题闭环、停止与超时处理。
- 项目技能链接到统一源，清单隔离，清理只删链接本身。
- 平台 Codex 地址/key/模型配置、CLI 路径与状态探测。
- 成功/失败/中断区分，历史保存与 token 统计正确，Claude 和内置 Agent 无回归。

接受的第一版边界：

- 正文按 CLI 实际 item 粒度出现，不承诺逐字/token 实时输出。
- 命令、MCP、计划过程按 exec 实际 started/updated/completed 事件更新；有更新才展示，不伪造进度。
- 推理摘要只显示 CLI 实际公开的内容；不是“必定没有 thinking”，也不承诺私有推理全文。
- 原生子代理/压缩可以在引擎内部发生，第一版不承诺完整实时展示其内部活动。
- 提问使用 Toonflow MCP askUser；不承诺 Codex 原生交互界面的输入/审批桥。
- 不做 app-server 双驱动、原生分叉/编辑历史、进程池、远程服务、会话迁移、全局技能链接、新权限面板。

## 1. 证据与当前源码基线

首轮探测实际使用工具 PATH 中的 codex-cli 0.159.0-alpha.12.1；原方案记录的 0.160.0 问答/续接样例属于另一组证据。实施先核对 Toonflow 实际 codexPath 与版本，不以此工具环境代替桌面宿主。

已验证：exec/resume 帮助；Windows 参数数组能正确注入 MCP 与配置；当前 CLI 拒绝 chat 协议、要求 responses；不存在的 thread 在开始回合前明确报 no rollout found；项目 junction 技能可发现；Node 浅删除链接不穿透源。真实 exec 推理、Bun 边界、桌面 UI 仍需实施验证。

本地 claudecodeui（提交 dc7cb6c，2026-09-28）的日常对话同样使用 TypeScript SDK 的 startThread/resumeThread/runStreamed，SDK 底层走 exec；app-server 仅用于 thread/fork 与编辑历史。可借鉴事件投影、会话 ID 映射及错误去重，不能把它的 fork-only RPC 客户端当完整聊天驱动。

Claude 当前 syncClaudeSkills 已从复制改为链接，记录见 agentBridgeDecisions.md D11。接手时阅读最新 claudeEnv.ts；其中普通目录递归清理、清单错误吞掉、用户同名目录归属仍需核对，不能原样复制到 Codex。

## 2. 真实链路与复用位置

    modelPopover / conversation
      → POST /api/agent
      → isEngineProvider / getEngineKind
      → runCodexCode
      → codex exec / exec resume + Toonflow HTTP MCP
      → AgentEvent NDJSON + 平台 SessionManager 展示历史
      → 原生 thread 映射供下一轮续接

复用：

- utils/ai 的引擎注册与分类，packages/providers 已有的 codex 定义。
- runtime/sessions 的 SessionManager、文件校验、锁与展示历史。
- bridge/question 的回答/取消通道、HTTP MCP 端点。
- 现有正文、thinking、工具、问题卡片；按需求做必要适配，不新增面板。
- loadAgentSkills、原子写文件、供应商解析与引擎设置。

当前问题注册/设置读取在 Claude 文件里，killProcessTree 尚为私有函数；确有共享需要时再提取小函数，不建通用引擎框架，不“照抄三件套”连已有边界错误一起带过来。

## 3. exec 调用、续接和输入

每轮启动一个进程，windowsHide=true，cwd 为本轮规范化工作区目录的快照。

    新会话：codex exec --json --skip-git-repo-check [覆盖配置] -
    续接：  codex exec resume --json --skip-git-repo-check [覆盖配置] <threadId> -

- prompt 统一走 stdin：stdio=["pipe","pipe","pipe"]，写完整文本后 end，避免参数长度和特殊字符问题。
- stdin 一直不 end 会阻塞；此处与 app-server 长期保持 stdin 开放的规则不同。
- resume 没有 -C/--cd 和 -s/--sandbox；cwd 用进程选项，权限用实际版本支持的配置/共同参数。
- 模型及权限参数以该实际路径的 help 为准；不要混用 exec 与 app-server 的字段/方法。
- 参数数组传递，字符串使用正确 TOML 编码；不拼 shell 命令、不把 key 放在参数中。
- 正式执行不带 ephemeral，复用用户 CLI 默认 home、认证与原生持久化；不人工改 config.toml/auth.json/rollout。
- 图片通过 exec/resume 的 --image 参数传已经校验的绝对路径，原生多图形式在 M0 核对；纯文字描述路径不算原生图片输入。
- 校验图片 MIME、普通文件、非空、现有 100 MB 上限和工作区边界。视频仍明确拒绝，不扩展处理功能。
- Windows 启动实际 exe 或明确的 Node CLI 入口，不能把 npm cmd shim 当成任意直接可执行文件；不为传 prompt 启用 shell 拼接。

## 4. provider、模型与平台说明

### 4.1 配置矩阵

独立 provider 名为 toonflow，wire_api="responses"，requires_openai_auth=false。第三方服务必须支持 Responses 流与工具循环，仅有 chat/completions 不够。

| 平台填写 | 行为 |
| --- | --- |
| 地址/key 都空 | 不覆盖 provider，CLI 自身配置/认证 |
| 仅 key | 独立 provider，官方 base URL https://api.openai.com/v1，使用该 key |
| 地址/key 都填 | 自定义 Responses provider 与该 key |
| 仅地址 | 不要求 OpenAI 认证，不配置缺值必需 env_key；允许无鉴权服务，端点需要 key 则明确失败 |

密钥经子进程环境 TOONFLOW_PROVIDER_KEY 和 env_key 注入，不能进入日志、平台事件、原生消息正文或临时 MCP 文件。端点错误不回退官方账号重试。

模型覆盖独立于地址/key：未指定 modelId 不传 -m，不意味着忽略平台地址/key；指定时校验条目并传 -m，避免错误选择偷偷落到更贵的 CLI 默认模型。默认模型不被新端点接受时如实报错，不暗换模型。

补充（用户要求自动列表）：设置及下拉由 /api/agentEngine/models 自动加载本机 Codex debug models 可见目录，合并手动模型；未覆盖 provider 时允许选择目录模型，覆盖地址/key 时仅使用平台条目。跟随本机项显示 TOML 中全局/profile 默认模型名；未读到默认配置时保留 CLI 默认标签，不猜测。只发现目录，不进行模型调用，也不将目录当作权限验证。

用户后续要求已更新：按模型目录声明动态显示思考档位，显式选择逐轮透传 model_reasoning_effort；默认不覆盖 CLI 配置。

### 4.2 运行时说明与 MCP

- 平台说明仅拼接到新原生会话首次 stdin 输入。续接只发最新用户消息；刷新、宿主重启、切换模型均不重复注入。原生会话丢失并重建时重新告知。
- 平台历史保存用户原始输入，不展示附带说明；不覆盖 developer_instructions、不修改用户配置或 AGENTS.md。
- thread.started 可能早于首轮输入提交。映射同时记录 codexInstructionsSent；首轮立即停止时只读原生记录核对是否提交，未提交则在下一轮新输入中补说明，不重放已取消任务。旧映射无该字段时视为已提交，以兼容已有正常会话。
- 说明明确本轮 cwd、业务 MCP 显式 target.directory、缺资源如实停止、askUser 指引和 Codex 自身技能用法；不照搬 Claude 的 Read/Skill 工具名。
- MCP 使用 HTTP url，鉴权时 bearer_token_env_var="TOONFLOW_MCP_TOKEN"。
- 运行时配置 required=true、tool_timeout_sec=1800，MCP 未启用/不可连接时明确失败；不要照搬 Claude 的 MCP_TOOL_TIMEOUT 环境变量当作 Codex 超时控制。
- 单轮默认 10 分钟仍会覆盖更长的答题等待，保持既有时限语义。暂停答题计时属于后续需求。
- windowsHide 不能保证 CLI 内部工具/插件不弹窗；notify、hooks、用户 stdio MCP 的覆盖按实际版本验证，不破坏 CLI 默认配置语义。

## 5. 会话与失败判定

toonflowEngine 保留 claudeSessionId，增加 codexThreadId。读取 engine/原生 ID 使用现有 Zod 校验；平台 sessionFile 不等于原生 threadId。

- thread.started 后立即保存映射，不等首条回复；正文前停止也可继续。
- 只发最新一条消息，原生上下文由 resume 管理，不重放平台历史。
- 有正文的会话只能属于同一引擎；切 Claude/Codex/内置 Agent 需要新对话。
- 部分失败/停止内容与有效映射照常保存，平台展示历史不是原生上下文真相。
- 原生会话由 CLI 正常落盘；“不手工改 sessions”不意味着禁止正常持久化。
- CLI/home 变化后续接失败要诊断来源，不承诺任意跨机器续接。

终态：

| 条件 | 平台收尾 |
| --- | --- |
| 收到合法 turn.completed、无最终失败，进程正常退出 | 保存，发送 stats/done |
| turn.failed 或异常退出 | 保存已收到部分，发 error，不发 done |
| 用户停止 | 取消问题等待、终止进程树、保存可用部分，明确停止 |
| 总时限到达 | 同样清理，但明确超时 |
| 有正文但 EOF 前无合法终态 | 异常退出，不能当成功 |
| stderr warning 或恢复中 error 后正常完成 | 不单独当失败，以最终协议状态为准 |

降级仅允许：明确“resume 的原生 rollout 不存在”，且尚未开始模型回合/工具时，新建一次。-32600 本身不等于失效会话。401/429、provider、MCP、损坏文件、泛化“无回复”均不自动重跑。

重试创建全新解析器和状态；清空旧 thread ID、块、工具、usage 与终态，不能把旧 ID 沿用到新会话。

## 6. 事件投影、统计与历史一致

解析完整 JSONL，流式 UTF-8 解码，支持中文跨 chunk、CRLF、末行无换行。实际事件字段在 M0 核对；新协议消息有限诊断，不能把原始整条含密钥数据发往 UI。

| exec item/event | 投影 |
| --- | --- |
| thread.started | 保存 threadId |
| item.completed: agent_message | text 完整块，有多段就按顺序显示 |
| reasoning | 公开摘要 thinking，未返回则无 |
| command_execution | running 卡片、可获得的输出快照、exitCode/终态 |
| mcp_tool_call | server/tool、完整入参、结果/错误、生命周期 |
| file_change、web_search | 既有工具卡显示实际变更/检索信息 |
| todo_list 或计划 item | 复用计划/工具投影，不另建面板 |
| turn.completed / turn.failed | usage 与最终成功/失败 |

同一 item.started/updated/completed 必须使用稳定 item ID，更新同一张卡。完整快照覆盖，真实 delta 才追加；不能把整份 aggregated_output 当增量重复拼。只有 completed 的内容不能伪装“执行中日志”。

平台累计 input 会与 cacheRead 相加，因此：

    cacheRead = 本轮 cached_input_tokens
    input = max(0, input_tokens - cacheRead)
    output = output_tokens
    cacheWrite = 协议有字段且核对语义后才填，否则 0
    total = input + cacheRead + output + cacheWrite

reasoning_output_tokens 不未经确认再加到 output。数字必须有限非负，缓存不能大于输入。没有可靠 decodeMs 时不填 tokensPerSecond；整轮时长含工具和答题，不冒充解码速度。

历史保存 tool/result 配对与同轮顺序；不能只在 UI 正确、刷新后又丢工具结果。

## 7. askUser 的共享修复

当前 MCP askUser 创建随机 toolCallId，前端 replyStream 查不到同 ID 工具卡会抛错。这条链路必须先修复，不能直接声明复用即生效。

- 提取两引擎共用 registerEngineQuestions/getEngineQuestionContext，复用现有问题表与回答/取消接口。
- 平台在 context.ask 前发同 ID 的 running 问答工具卡；作答/跳过/失败/停止均发对应终态。
- 合成工具与结果通过统一事件收集落盘，CLI 原生 askUser 工具卡去重，不靠猜“最后一个工具”配对。
- 规范化 cwd 作为路由。第一版同工作区一次只允许运行一个官方引擎回合，第二个报占用。
- 未给 directory，仅全局恰好一个活跃官方回合时兜底；多个不能取最后注册者。
- 停止、断线、超时与 CLI 结束均取消问题等待、释放注册与占用。

Codex 原生输入/审批不在 exec 第一版交付范围。系统说明引导使用 Toonflow askUser；不能把未实现的原生交互等待伪装成平台问答。

## 8. 项目级技能链接

唯一源码在 packages/skills；运行时链接来源由 loadAgentSkills 返回：cwd/skill 优先，再取平台 dataDirectory/skills 的安装态。平台安装态不作为另一份源码维护。

- Claude 目标 cwd/.claude/skills；Codex 延续已定 cwd/.codex/skills。当前版本已验证；.agents/skills 是官方新路径参考，本期不双写。
- 从当前 Claude 链接逻辑提取共用工具，Windows junction 指向绝对源目录，其他系统用目录 symlink。
- 默认不写用户全局 .claude/.codex/.agents 技能目录；全局链接需要另外明确需求。
- 清单记录 name 与预期源；只管理可证明归属的平台链接。
- lstat 区分普通目录、平台链接、用户链接、失效链接；父目录也不能是指向外部的链接。
- 同名用户目录或链接保留并报告冲突，不覆盖、不认领、不假称注入成功。
- 目标正确跳过；源移除只清理属于平台的链接；漂移无法证明归属则保留。
- 清单损坏/读取失败不能吞掉变空数组；原子写并给同步目录加锁。
- 删除只删链接节点，禁止把 realpath 的源路径交给删除函数；不得递归删除普通目录作为自动迁移。
- 旧复制目录证明内容未被用户改过才可迁移，无法证明则保留；不能仅凭旧 string[] 清单就认定可删。
- Node 浅删除已验证，Bun 的创建、浅删除、失效链接与跨盘须实施前复测。
- 源更新下一轮实际技能加载必须验证，不能只验证链接读文件正确。
- 不放宽普通工作区文件接口的链接/越界限制。

## 9. 实施顺序与文件范围

### M0：补齐小范围验证

核对真正宿主的 CLI/Bun 路径与版本、exec/resume 参数、中文 stdin、默认/覆盖配置、说明合并、MCP required/timeout、多图形式。

先无推理探测；随后用用户指定便宜模型的小任务取得文本、命令、MCP、askUser、图片、正常续接与正文前停止的样例。只运行必要次数，禁止付费大生成。实际版本无相应 updated 事件时如实记录粒度。

验证 Bun 链接边界、用户同名目录与旧副本保护；真实桌面宿主下观察工具子进程窗口。原生 UUID 缺失判定已在首轮验证，实际版本不同则复核。

### M1：服务端

候选新增文件均小驼峰，只按实际需要创建：

- engines/codexCode.ts：exec 驱动、平台会话、终态、保存、取消。
- engines/codexStream.ts：exec 事件归一化、工具快照与统计。
- engines/codexEnv.ts：provider/MCP/平台说明与参数。
- engines/engineRuntime.ts：确实共享的设置/问答/进程树/供应商小函数。
- engines/skillLinks.ts：已存在 Claude 逻辑的安全公共化。

修改 agent/index.ts 出口、runtime/sessions.ts 映射校验、routes/agent.ts 分流、utils/mcp/tools.ts 问答入口及必要的现有事件接收逻辑。不新增 codexClient/RPC 层，不安装 SDK 仅为包装已有 spawn。

顺序：共享问答/占用 → Codex exec/终态 → 映射/历史 → MCP/图片 → 链接同步。隔离服务端跑通后再开放前端入口。

### M2：设置与 UI

- 增加 codexPath，保存保留 Claude 路径/超时/extraEnv。
- status 探测两个 CLI，兼容当前消费者；区分 stdout/stderr，提取版本行，不把 warning 当版本。
- Claude localEnv 读取、预填、提示和写回仅限 Claude；Codex 回读平台条目，不能被 Claude key/地址覆盖。
- 修正 provider 源码说明：接入状态、Responses、整段回复、实际支持的能力。
- 最后在 implementedEngines 解禁 Codex，保留 CLI 默认模型合成、内置 Agent 默认。
- 浏览器实际核对问答、工具卡、停止、历史恢复和图片；构建成功不代替 UI 验证。

### M3：验证与文档

在 apps/server 路由文件变更后先 bun run routes，按需 server/web typecheck、build、HTTP 与浏览器验证。web 输出在 build/web。使用隔离 createApp/临时数据目录和未占用端口，不动知识库记录的真实 3000 实例。

更新 knowledge/agent、实际决策与本方案实施结果。根 dev:plugins 当前只构建 tools/nodes；provider 文案更新须检查实际 providers 构建/安装路径，不能手改 data 或分发产物。发布留在后续明确阶段。

## 10. 验收清单

- [ ] 基础问答：session/userMessage/text/stats/done 正确；无回复或失败没有伪成功。
- [ ] 多轮：暗号小任务、刷新、重启后续接；正文前停止保留映射；不同引擎不能接管。
- [ ] 失效映射：只在明确 rollout 不存在且未开始回合时新建一次，其它错误不重跑。
- [ ] 工具：命令/MCP/计划按实际事件更新同一张卡，完整快照不重复拼接；文件/搜索信息正确。
- [ ] 问答：选择、自由回答、跳过、取消均闭环；卡片关联与历史结果正确，停止后无残留问题。
- [ ] 图片：新会话与续接原生输入正常；越界/视频/非法附件明确拒绝。
- [ ] 配置：CLI 默认、key-only、URL-only、自定义 URL+key，模型独立切换均符合语义。
- [ ] 统计：cached input 不双计、reasoning output 不重复加，不造解码速度。
- [ ] 停止/超时：进程及子进程清理、注册/锁释放、可继续对话，错误来源明确。
- [ ] 技能：发现与更新加载正确、源删除只删链接、用户目录/旧修改副本保持、清单损坏显式失败。
- [ ] 并行/目标：同工作区不串答，多工作区缺 directory 不误路由；页面切换不漂移目标。
- [ ] Windows：真实宿主无多余窗口，探测版本与实际启动路径一致。
- [ ] 回归：Claude、内置 Agent、普通 provider 设置正常，类型/构建与真实 HTTP/UI 分别记录。

正文按段出现是用户已接受的第一版取舍，不用“实时文本必过”阻塞本期；不得因为接受这个取舍就省略问答、停止、统计或安全验证。

## 11. app-server 后续升级边界

当用户明确要求逐段实时正文、命令日志 delta、可靠原生输入/审批、实时压缩与子代理过程时，再将驱动换为 app-server。届时处理：

- initialize/initialized、thread/start/resume、turn/start/interrupt 与三种终态。
- 请求 ID/pending map、通知与服务端请求的双向区分。
- agentMessage delta 与 completed 校准，thread/turn/item 归属。
- native requestUserInput/elicitation、取消应答与 unresolved 请求清理。
- 版本 schema 和实验 capability 差异、累计 usage 快照。

本期不保留第二套可执行驱动、不用 fork-only 客户端冒充完整 app-server 集成；公共 AgentEvent、平台历史与技能链接保持可复用。升级路线说明不是已实现承诺。

## 12. 依据

- [本轮复核与 claudecodeui 对照](codexBridgeReview.md)。
- [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)。
- [Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)。
- [Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。
- [Build skills](https://learn.chatgpt.com/docs/build-skills)。
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)，仅作为后续升级参考。

## 13. 实施与验证记录（2026-10-02）

实现入口为 engines/codexCode.ts、codexEnv.ts、codexStream.ts。共享问答、工作区占用、环境/超时及进程树清理由 engineRuntime.ts 提供；Claude 与 Codex 共用 skillLinks.ts。平台映射增加 codexThreadId/codexInstructionsSent；三种引擎均禁止接管已有消息的其他引擎会话。Codex 模型入口已开放，思考强度控件按模型目录声明显示并逐轮传递。

实际环境：Toonflow 已有 Bun 1.4.0，Codex 原生 exe 0.159.0-alpha.12.1，Claude 版本探测 2.1.287。验证使用临时数据目录、临时 Codex home 和独立回环端口，不写用户 CLI 配置/AGENTS.md/全局技能目录。真实推理仅使用 GPT-6-Luna、GPT-5.6-Luna。

已完成：

- server/web 类型检查与构建、路由生成，未新增测试文件、框架或依赖。
- 隔离 HTTP 首轮问答、跨模型续接记忆、命令执行、MCP askUser 回答、图片理解及历史回读。
- 原生记录核对首轮说明只出现一次；隔离服务重启后续接；首轮立即停止保存映射、记录 aborted、下一轮补发尚未提交说明并成功回答 Toonflow。
- 指定不存在的原生 UUID，收到明确缺失错误后仅新建一次并提示上下文丢失；非法模型和视频附件无 done 伪成功。
- 分块中文 UTF-8、同 item 快照覆盖、正常/失败终态、缓存输入扣除的手动验证。
- 共享问答回答/跳过/取消的手动验证；同工作区重复占用拒绝。
- Bun 项目 junction 同步/重复同步/源删除浅清理、用户普通目录冲突保留、损坏清单拒绝；技能源未损坏。
- 四种地址/key 配置组合均用 CLI mcp list 无推理验证 TOML 解析，密钥仅环境传递；Bun fs.rm recursive 对临时 junction 浅删除实测通过。
- 浏览器实际查看命令/问题/图片历史、Codex 模型列表和 CLI 默认项、独立地址配置回读，以及两个 CLI 的版本探测。

未完成实际环境验收：打包桌面宿主及 CLI 内部子进程是否弹窗；Claude/内置 Agent/普通供应商的真实模型回归；第三方 Responses 服务及真实 key-only/URL-only 认证；真实超时后的所有后代进程观察；多工作区页面切换下的真实并发问答。以上不因类型检查/构建通过而视为已验证。无可用第三方配置时不改用昂贵默认模型。

前端构建首次遇到生成声明文件暂时占用，重试完成；保留原有 Vite 配置与包体积警告。生效需要用户下一次正常重启服务并刷新页面，本轮不替用户重启生产/在用实例。
