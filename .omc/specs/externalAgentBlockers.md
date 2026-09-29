# 外部 Agent 操作画布：两次真实使用的阻塞点分析

- 日期：2026-09-28
- 样本：
  - 会话 A（本机）：`sess_32b14309-50b8-4e9c-83c4-58bb4972fca0`，GLM-5.3-Flash，任务《中秋团圆》60 秒分镜导入 + mock 生成，总耗时 45 分钟（14:06→14:51）
  - 会话 B（另一台电脑）：ZCode 分享 `ok0Bk8chXoyTeJSSHA9YumtFg728609t`，同任务，总耗时 32 分 27 秒
- 结论：两次任务均最终完成（15 资产图 + 10 分镜视频全部生成落盘），但约六成时间消耗在排雷上，且多数雷来自本项目自身缺陷，而非 agent 不会用。

## 一、期望流程（设计意图）

除用户手动启动 Toonflow 外，其余全部由外部 Agent 自主完成：

1. 用户启动 Toonflow，从首页/欢迎区复制引导语粘贴给本机任意 Agent（Claude Code / Codex / ZCode 等）；
2. Agent 连接 `http://127.0.0.1:10588/mcp`（免鉴权，连不上按 10589、10590…顺延探测）；
3. Agent 读 tudodo-center 的 AGENTS.md 学习用法，按 manifest 比对版本、安装 canvasOperation 技能与 mockProvider；
4. `getAppState` 确认连接 → 无页面连接则 `openApp` 唤起 → `openProject` 打开/创建工作区 → 画布就绪；
5. 高风险操作（删节点、覆盖文件、批量消耗额度）先给用户选项确认；
6. 按技能教程执行：导入分镜标准 JSON → 配 mock 模型 → 批量生图 → 批量生视频 → 查验落盘结果，前端全程回显。

理想路径（连接 → 装插件 → 开工作区 → 导入 → 生图 → 生视频 → 查验）本身约 12~15 分钟可走完。

## 二、阻塞点清单（按严重程度）

### P0-1 前后端 MCP 开关默认值相反 —— 新机器页面永不连接（会话 B 最大阻塞）

- 服务端 `apps/server/src/utils/mcp/control.ts:27`：`enabled: value?.enabled !== false` → **字段缺失 = 开**；
- 前端 `apps/web/src/lib/mcpControl.ts:59`：`if (config?.enabled !== true) return ""` → **字段缺失 = 关**。
- 会话 B 的机器 `data/settings.json` 从未保存过 mcp 配置，导致：10588 上 46 个 MCP 工具全部可调，但页面永远不注册控制连接，`getAppState` 永远返回空。
- agent 排查无果后读前后端源码定位到此开关，手工写入 `mcp.enabled: true` 并刷新页面才连上，耗时约 10 分钟。
- 影响：「默认开启 MCP」的承诺在存量/新机器上不成立。

### P0-2 Windows 文件锁 EPERM → 403，且"部分成功"不透明 —— 会话 A 最大阻塞（约 17 分钟）

- 现象：`importStoryboard`、`addNode` 一律 403，`getCanvas` 正常。
- 根因链：
  1. 每个画布操作后 `await flushSave()`（`useCanvasTools.ts:107`），保存走「写临时文件 + rename 替换」；
  2. Windows 上新建的 `画布1.json` 被外部进程（杀毒/索引）短暂持锁时 rename 报 EPERM，`app.ts:81` 将 EPERM/EACCES 映射为 403；
  3. MCP 链路把错误传回 agent 时只剩 "403 Forbidden"——`app.ts:89` 其实有中文文案（"文件可能正在被其他程序使用"），但没有穿透到 agent 眼前；403 的第一联想是鉴权，agent 往鉴权方向查了十几轮（x-toonflow-local-client、Origin 校验、节点资源接口、模型接口……），最后自己 curl 复现 PUT + 手动 mv 才定位。
- 连带后果：**节点已建到内存画布、只是保存失败**，工具却报整单失败 → agent 重试 → 画布堆了 3 组重复节点（76 个）→ 又触发一轮高风险删除确认与清理。
- 修复方向：错误透传（文件路径 + EPERM 语义 + 已建节点数）；保存失败与节点创建的原子性/幂等处理。

### P0-3 `autoGenerateImages` 边建节点边触发生图，模型未配 —— 导入中断留半成品（会话 B）

- `useCanvasTools.ts:324`：循环里每建好一个资产节点就立即 `node:generateImage`，此时节点模型仍是默认值（该机器为 grsai 旧模型）→ 第一个节点即报「请先选择图片模型」→ 整个导入中断，画布留下 1 个半成品节点，agent 删除后重来。
- 工具描述写了「提供 options 前先用 listMediaProviders 查询」，但没说模型必须在导入前/导入时配置好，否则 `autoGenerateImages` 必炸。
- 修复方向：先全部建完节点并配好模型，再统一触发生成；或导入参数直接支持模型配置。

### P1-4 dev 多实例并存，引导语固定指向 10588 —— 会话 A 约 6 分钟

- 本机同时跑 10588、10589、10590、3000 四个 server 实例，全部响应 MCP；页面经 vite 代理把 `/api` 指向 `127.0.0.1:3000`，控制连接注册在 3000 实例上。
- agent 按引导语连 10588 → `connections: []` → `openApp` 在独立 dev server 下报错（只说「不托管前端，用 vite 地址」）→ agent 手动开 5173 页面 → 页面还是连 3000，10588 依然空 → 只好读 `mcpControl.ts` + `vite.config.ts` 反推出该用 3000。
- `openApp` 的 dev 报错没有告诉 agent 关键事实：「页面会注册到另一个实例，去那里找它」。

### P1-5 mockVideo 不支持多参考，导入与教程均无预警 —— 两次会话都踩

- 分镜 cast 有 2~7 个出镜资产，`importStoryboard` 照单全连；mockVideo 只有纯文本/单图/首尾帧模式（无 multiReference）→ `node:getConfig` 的 matchingModes 为空，触发时 9~10 个分镜集体报「当前模型没有适合这些参考素材的生成模式」。
- 会话 A：agent 停下 AskUserQuestion，用户 3 分钟后回复，按「起始画面」每分镜保留 1 条参考连线（删 36 条）+ singleImage 模式后成功；
- 会话 B：**用户不在线，agent 以「完全可逆」为由自主删除 26 条连线**——理由成立但违反引导语「高风险操作先确认」的约定。该违约是工具能力不透明逼出来的：导入时若有 cast 数量 vs 模型模式的校验警告，根本走不到这一步。
- 修复方向：`importStoryboard` 导入前校验 cast 数量与所选视频模式支持度，提前警告或降级提示。

### P1-6 mock 素材库需要预置，任何文档都没写（会话 B）

- mockProvider 从 `data/assets/mock/images/9x16-N.png`、`videos/5s-N.mp4` 读取素材，**安装时不附带、教程不提及**。
- agent 首次生图报「素材为空」后，读 provider 源码找到目录约定，再用 ffmpeg 现做 5 张渐变图 + 3 个彩条视频放入素材目录。
- 本机没踩仅因此前会话手工准备过素材。
- 修复方向：mockProvider 安装时附带最小素材集，或技能/中心文档写明素材目录与命名约定。

### P1-7 引导语没教「注册原生 MCP server」，agent 全程自写 Bash 客户端 —— 两次会话共同的持续摩擦

- 两个 agent 都未把 Toonflow 配置为宿主的原生 MCP 集成，而是自写 `/tmp` 下的 Streamable HTTP 客户端脚本走 Bash 调用。代价：
  - 每次调用 = 新进程 + initialize + call，慢且脆；
  - Git Bash (msys) 层破坏中文与反斜杠转义：printf 构造含中文路径的 JSON 报 `Invalid escape character`，agent 连续 4 轮折腾后改为 Write 精确写 UTF-8 JSON 文件 + `@file` 传参；
  - 终端管道中文乱码，被迫所有响应落盘后用 Read 读取；
  - `openApp`、`listAppOperations` 等无参工具首次调用报 `data must have required property 'args'`——MCP 工具统一入参里 args 必填，无参也要显式传 `{}`，两个会话都踩了一遍；
  - MCP 结果包着 `items[0].parsed`，agent 每次都要写解包脚本。
- 修复方向：引导语补一步「先把 MCP 注册进宿主（ZCode / Claude Code / Codex 的配置方法）」，原生集成后上述坑大部分自动消失。

### P1-8 `getGenerationStatuses` 轮询口径不明确 —— 会话 A 假超时（自述补充）

- agent 轮询图片生成时查询了全部节点，把 10 个尚未触发的视频节点（idle）计入「未完成」，打满 60 轮都显示 15/25；图片其实早已全部成功。后续改为只统计分镜节点才正确。
- 根因：状态结果里 idle（未触发）与 running/succeeded 混在一起，教程未写「轮询应按节点类型/已触发集合过滤」；或工具应支持只返回已触发节点。
- 修复方向：`getGenerationStatuses` 结果区分「未触发」与「进行中」，或文档明确轮询口径。

### P2 次要问题

- **技能安装态版本为空**：两台机器上 agent 都发现本地 canvasOperation「版本为空」≠ manifest 1.2.0，于是每次冷启动 force 重装一遍——版本 meta 未写入或未读到；
- `deleteNodes` 单批上限 64，清空 76 个节点需分批（有明确报错，可接受，但教程可提前说明）；
- `importStoryboard` 返回的 `assetNodeIds` 是 `[{name, nodeId}]` 数组而非映射，agent 第一版按映射提取导致保留集为空，发现后修正——返回结构应在教程中写明；
- manifest 经 gitee raw 有 302 跳转，curl 不带 `-L` 会失败一次；
- 多页面/多实例时 `getAppState` 不提示「哪个实例上有页面连接」，agent 只能枚举端口；
- 宿主 Write 工具对已存在文件要求先 Read（环境摩擦，非本项目问题，记录备查）。

## 三、会话行为评价

两次会话的 agent 行为本身是 compliant 的：按教程授权范围行动、高风险操作主动停下确认（会话 B 的自主删边是被工具不透明逼出的例外，且选择了最小可逆方案并在汇报中说明明细）。卡住的原因不是 agent 不会用，而是**工具的错误信息和默认值没把真相告诉它们**。

## 四、修复优先级建议

| 优先级 | 项 | 动作 |
| --- | --- | --- |
| P0 | 前后端 enabled 默认值对齐 | 前端缺省视为开，或首启写入默认 settings（一行级改动） |
| P0 | 403/EPERM 错误透传 + 导入幂等 | flushSave 失败时返回文件路径、EPERM 语义、已建节点数；考虑保存失败回滚或重试 |
| P0 | autoGenerateImages 触发时序 | 全部建完 + 配好模型后再统一触发；导入参数支持模型配置 |
| P1 | openApp dev 报错指路 | 报错时告知「页面注册在哪个实例/端口」，或 dev 下自动路由 |
| P1 | 导入前校验 cast 数量 vs 模式 | importStoryboard 提前警告多参考不匹配 |
| P1 | mock 素材随装附带 | mockProvider 安装时放置最小素材集 |
| P1 | 引导语补「注册原生 MCP」 | 各宿主配置方法写入引导语/中心文档 |
| P1 | 轮询口径 | getGenerationStatuses 区分未触发/进行中，教程写明 |
| P2 | 技能版本 meta 写入 | 安装态写入并读回版本，避免每次 force 重装 |

## 五、第二批改造项（2026-09-28 追加，已实施并验证）

### 5.1 页面打开策略：优先宿主内嵌浏览器 + suggestedPageUrl + 127.0.0.1

**需求**：大部分 agent 宿主（ZCode 等）都有内嵌浏览器（右侧网页面板），打开画布页面应优先用它（agent 可直接看到页面、截图核验），没有该能力再用系统默认浏览器；地址一律 127.0.0.1，禁止 localhost。

**实施**（server 无法直接操控宿主面板，「优先右侧」落在工具描述与文档引导上，server 侧提供权威地址）：

- `apps/server/src/utils/mcp/tools.ts`：
  - 新增 `resolvePageUrl()`：桌面/生产返回 `${appOrigin}/#/workspace`；dev 探测 vite 5173（1.5 秒超时）返回 `http://127.0.0.1:5173/#/workspace`，探测不到返回 undefined；
  - `getAppState` 返回新增 `suggestedPageUrl`，描述写明「优先用宿主内嵌浏览器打开 suggestedPageUrl，无该能力再调用 openApp」；
  - `openApp` dev 分支从**报错**改为**真打开**（原来只提示"用 vite 地址"，现在直接 `cmd /c start`/`open`/`xdg-open` 打开 5173）；vite 未启动时报错「前端 dev server 未启动」；dev 下返回附 `hint`：「页面经 vite 代理注册在主服务实例上；若本 MCP 实例 getAppState 仍无连接，请改连主服务 MCP（默认 http://127.0.0.1:3000/mcp）」——直指会话 A 的多实例找错端口问题。
- `apps/web/src/lib/agentGuide.ts`：引导语第 3 条改为「无页面连接时优先用你宿主的内嵌浏览器（右侧网页面板）打开返回的 suggestedPageUrl（地址一律用 127.0.0.1，勿用 localhost），无内嵌浏览器再调 openApp」。
- `tudodo-center/AGENTS.md`：接入流程同步更新 + 补充「dev 多实例场景改连 3000/mcp」说明。

**验证**：MCP 实测 `getAppState` 返回 `suggestedPageUrl: http://127.0.0.1:5173/#/workspace`；页面连接恢复后 connections=1。

### 5.2 mock 能力增强：任意时长 + 多参考（含音频）

**需求**：mockVideo 秒数支持自定义任意值；支持多参考输入，包括音频参考。

**实施**（`packages/providers/src/media/mockProvider.ts`，version 2.0.0 → 2.1.0）：

- `durationResolutionMap.duration` 从 `[5, 10]` 扩为 **1～60 全枚举**（60 个整数；节点端时长校验完全由该列表驱动，枚举即"任意"）；
- `mode` 增加多参考数组条目 `["imageReference:10", "videoReference:5", "audioReference:5"]`（grsai.ts:77 同款先例）：最多 10 图 + 5 视频 + 5 音频任意组合，各类型数量 ≤ 上限即匹配——会话 A/B 的「cast 2~7 图被拒：没有适合的生成模式」在 mock 上直接消失；
- readme 更新：任意时长素材按命名优先（`5s-1.mp4`），目录未覆盖的时长随机回退；参考输入接收但不影响结果。

**验证**：MCP `listMediaProviders` 实测 `mockProvider@2.1.0`，`mockVideo mode` 含多参考数组条目，durations 共 60 项（1…60）。多参考端到端生成待与 P1-5 一并回归。

### 5.3 实施过程中新发现的问题（待办）

- **autoInstallProviders 白名单缺 mockProvider.ts**：`app.ts` 的白名单当前只有 `["tfRouter.ts", "grsai.ts"]`，导致 a) 新机器首启不会自动安装 mockProvider（会话 B 全靠 agent 手动从中心安装）；b) `dev:restart` 的供应商强制刷新跳过 mockProvider（本次验证时 data/ 仍是 2.0.0，靠手动拷贝才同步）。建议将 `mockProvider.ts` 加入白名单，并考虑白名单机制改为「packages/providers/src/media 目录全量」以绝后患。（已修复：白名单已加 mockProvider.ts）
- **本机残留实例现场**：验证时 netstat 显示 10589（PID 49984）、10590（PID 15468）仍被两个旧 dev 进程监听——正是 P1-4 多实例问题的活体证据，`restartDev` 的 `devPorts = [3000, 5173]` 不含 MCP 端口范围，清理方案（扩为 10588～10599）实施后即绝迹。（已修复：devPorts 已扩至 10588~10599 并实测清净）

## 六、第三轮：首轮修复后的新会话实测（2026-09-28）

清理环境模拟新用户（删 settings.json / canvasOperation 技能 / 测试画布，页面重新打开）后，由子代理按 newimport.txt 全程经 MCP 执行同款《中秋团圆》任务。**结果：任务完成（15 图 + 10 视频全部 succeeded），全程 74 分钟、124 次工具调用**，验证通过的修复：P0-1（无 settings 时页面成功注册连接）、suggestPageUrl、技能远程安装 1.3.0、导入含 imageModel/scenes.duration、summary 轮询口径、cast 校验拦截、中断进度报告、restartDev 端口清理（全程无多实例干扰）。

实测新暴露的问题与处置：

| # | 问题 | 根因 | 处置 |
| --- | --- | --- | --- |
| 1 | mockProvider 2.1.0 源码语法错误，加载失败（阻塞性） | 首轮 P1-6 改造时把 const 声明与函数声明误放进 `export default {}` 对象字面量内部，且已随坏源码发布中心；providers 不在 typecheck 范围未拦住 | 已修复源码；sync.py 新增发布门禁（Bun.Transpiler 语法校验，坏文件实测拦截）；中心已重发 |
| 2 | imageModel 被页面端 zod 拒绝（unrecognized_keys），40 分钟 | 页面 bundle 为旧代码（dev 改前端后浏览器 tab 未刷新），schema 声明（server）与校验执行（页面 JS）分离 | connect.md 补排障条目：「Unrecognized key 但 schema 有该字段 → 刷新页面」 |
| 3 | 页面控制通道卡死：SSE 在、state 上报正常、call 120 秒无响应（45 分钟，最难） | agent 用 openApp 开了系统浏览器页面，聚焦别处时 Chrome 后台标签节流暂停事件循环与 SSE 读循环（页面存活但 JS 冻结） | callControl 超时报错新增「该页面最近 N 秒前有活动」（lastStateAt），一眼区分页面冻结与通道故障；connect.md 补处置指引（优先内嵌浏览器/切前台/关页重开） |
| 4 | importStoryboard 返回的分镜5 nodeId 与 getCanvas 实际不一致（一位 hex 差异），触发报「节点未注册函数」 | 一次性现象（该节点 initialized:false，疑似经历替换；ID 由页面生成后原样返回，链路本身正确） | nodeTools 报错文案补提示「节点可能未完成初始化或已被替换，重新 getCanvas 获取最新 nodeId」；若复现再深查 |
| 5 | openProject 反斜杠路径被 shell 转义破坏后报「请提供绝对工作目录」 | 校验正确但报错无格式示例 | 中心 AGENTS.md 补「directory 用正斜杠 D:/a/b 最稳」 |
| 6 | 工作区目录被外部删除后页面持有幽灵状态（25 节点 succeeded 但 0 文件） | 环境清理特有场景（真实用户不会删目录） | 不改代码；agent 自行识别处理（本次已正确处理） |

另采纳的改进：scenes[].duration 逐分镜时长（10 分镜 4~7 秒不再需要导入后逐个 setConfig）；中心 AGENTS.md 补「安装后复查 loadError」「版本为空视为不一致」「正斜杠路径」。

端到端回归（修复后）：mockProvider 2.1.0 加载健康（4 模型无 loadError）；小规模导入（imageModel + cast 2 多参考 + scene.duration=3 + autoGenerateImages）一次成功；summary `{total:3, succeeded:2, idle:1}` 口径正确；cast 11 超限在建边前拦截且报错含进度与清理指引；分镜 duration=3 视频生成 succeeded。
