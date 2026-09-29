# 画布控制架构稳定性评估与演进方案

- 日期：2026-09-29
- 背景：外部 agent 经 MCP → server → SSE 控制通道 → 页面执行的方式操作画布，三次实测（45/32/74 分钟）暴露稳定性问题，评估是否需要架构级方案。

## 一、当前架构的稳定性评估（基于实测证据）

### 结论

**"用户在场"场景：修完实现层缺陷后已可用**；**"无人值守/长任务"场景：结构性不稳**。不稳的来源要分两层看——三次实测的阻塞大头是**实现层缺陷**（已修）：错误信息不透明、默认值不一致、多实例残留、旧 bundle、坏源码发布。修完后剩下的才是**架构固有风险**：

| # | 固有风险 | 实测证据 | 已做缓解 | 剩余风险 |
| --- | --- | --- | --- | --- |
| 1 | 页面必须在场且活跃：浏览器后台标签节流会冻结事件循环与 SSE 读循环 | 第三次实测 45 分钟卡死（页面存活、state 正常、call 无响应） | 超时报错带 lastStateAt 可诊断；文档引导优先内嵌浏览器 | 冻结本身无法根治（浏览器行为），只能诊断+规避 |
| 2 | 两跳链路（agent→server→页面）超时语义混杂 | 120 秒超时是"页面可能死了"的猜测 | lastStateAt 区分页面冻结/通道故障 | 页面执行中的长操作（生图轮询被页面阻断）仍受页面调度 |
| 3 | 页面刷新/关闭即丢执行中的命令 | — | SSE close 时 pending 报"页面已断开" | 命令不可恢复、不可重放 |
| 4 | 节点逻辑闭包在组件内：模型配置校验、生成触发、状态查询只能在页面进程跑 | getGenerationStatuses 必须 page hop | — | headless 不可能；节点插件升级即需页面刷新 |
| 5 | 内存画布与磁盘文档的弱一致 | EPERM 部分成功 → 3 组重复节点 | rename 重试 + 错误带进度 | 本质是"页面内存为真相、磁盘为投影"，与无人值守诉求相反 |

### 判断依据

当前架构 = **"控制真实实例"模式**（同 Chrome DevTools Protocol、Blender MCP、VSCode Agent）。它的优点真实存在：UI 与 AI 操作同一真相（回显免费）、复用画布校验（做不出非法状态）、server 无画布状态。对"AI 辅助一个正在看画布的用户"这个场景，它是合理选择。问题出在产品诉求已经超出这个场景——外部 agent 无人值守地长流程干活（导入→生成→轮询→查验动辄几十分钟），任何一环页面冻结/刷新/关闭都会中断。

## 二、业界调研

| 产品 | 画布真相 | 执行真相 | 外部自动化方式 | 稳定性表现 |
| --- | --- | --- | --- | --- |
| **ComfyUI** | 前端（LiteGraph） | **server**（执行引擎） | 前端把图序列化为 workflow JSON，POST `/prompt` 提交，server 校验建执行图异步跑，WebSocket 回进度 | 无人值守成熟；SwarmUI 甚至把 ComfyUI 当纯后端引擎（前后端完全解耦）；官方已出 Comfy MCP |
| **n8n** | **server**（DB） | server | API 直改工作流，前端是投影 | 无人值守成熟 |
| **Figma** | **核心引擎**（非前端 DOM） | 引擎 | 插件 API 操作文档模型，多端 CRDT 同步 | 多人实时稳定，重引擎 |
| **Blender MCP / CDP / VSCode Agent** | 真实实例 | 实例内 | 注入代码控制实例 | 共识：**headless 优先，GUI/实例控制只作 fallback**；后台/节流/实例必须在场是公认痛点 |

关键启示：**ComfyUI 与 Toonflow 形态最像（节点画布 + 媒体生成），它把"画布编辑"和"画布执行"彻底分离**——画布 JSON 是可提交的文档，执行引擎独立于页面。业界没有产品用"远端控制页面"的方式支撑无人值守自动化。

## 三、Toonflow 的有利条件（执行上移比想象中近）

盘点现状，"执行真相"其实大半已在 server：

- **画布文档已在 server 磁盘**（工作区 画布N.json，含 nodes/edges/viewport，节点配置 prompt/model/duration/resolution 在 node.data 里）；
- **媒体生成已在 server**（/api/ai/generate → 供应商调用 → 产物落盘 工作区/assets/<nodeId>/）；
- **生成历史也在文档里**（node.data.generationHistory 随画布 JSON 持久化）；
- **校验规则是纯函数**（canvasSchemas zod + 连线端口校验，不依赖 Vue Flow 运行时）。

真正困在页面里的只有：① execute switch 的校验+应用逻辑（写在 useCanvasTools）；② 实时生成进度/取消（闭包 AbortController）；③ UI 态（选中/撤栈/视口）。

## 四、方案

### 方案 A：加固现有通道（低成本，立即收尾）

1. 页面 SSE 看门狗：后台标签 setTimeout 虽被节流至分钟级但仍执行——"N 秒未收到 keepalive/消息 → 主动断开重连"，把冻结连接换成新连接；
2. 连接健康分级：getAppState 给每个 connection 标注 lastStateAt，agent 可先筛掉冻结页面；
3. 刷新中断语义：页面卸载前（beforeunload/pagehide）把执行中命令显式标记"页面重载中断"（已部分有）；
4. （已上线：lastStateAt 超时提示、错误透传、rename 重试、cast 前置校验。）

**效果上限**：诊断能力变强、事故变少，但"页面必须在场"的本质不变。适合作为 B/C 落地前的止血。

### 方案 B：执行上移——"ComfyUI 化"（长期目标架构）

核心反转：**画布 JSON 是文档真相（server），页面从"执行者"降级为"编辑器+观察者"**。

1. 结构操作 server 化：把 execute 的校验+应用抽成共享纯函数包（packages/canvasOps，Bun/浏览器同构），server 直接对画布 JSON 应用操作（addNode/connectNodes/deleteNodes/arrange/importStoryboard）并落盘；
2. 生成任务 server 化：触发=server 任务队列（读 node.data 配置入队，复用现有 /api/ai/generate），状态/进度由队列持有，产物与历史照旧落盘；
3. 页面订阅变更：server 推"文档版本/操作补丁"事件，页面按操作应用到 Vue Flow（复用同一 canvasOps），UI 态（选中/撤栈/视口）留在前端与文档态分离；
4. 控制通道保留但降级为"页面主动能力"（用户手动编辑仍走前端本地，agent 大流量操作走 server 文档路径）。

**收益**：无人值守稳（无页面依赖）、无两跳超时、崩溃恢复=重读文档、agent 工具全部 headless 可用。
**代价**：重构 execute 层 + 生成链路 + 页面同步机制，以周~月计；冲突合并（用户拖拽中 server 改文档）需要操作补丁而非整文档替换。

### 方案 C：双模中间态（推荐的中期落地，B 的分步实现）

保持现有通道为"交互模式"，新增"文档模式"API，按能力逐步上移：

| 阶段 | 上移内容 | 交付能力 |
| --- | --- | --- |
| C1 | 结构操作（importStoryboard/addNode/deleteNodes/connectNodes/arrange）的 server 实现 + 页面文档订阅刷新 | 导入/编排全程不依赖页面；页面开着自动回显 |
| C2 | 生成触发与状态（读 node.data 入队 + 队列状态查询） | 全流程 headless：导入→配置→生成→轮询→查验 |
| C3 | 撤销/实时进度经文档事件同步 | 交互模式与文档模式合一，控制通道退役为辅助 |

**风险控制**：双实现漂移用共享 canvasOps 包收敛（一套校验两处执行）；C1 先只读校验+导入（与现状行为一致）再放开全量写。

### 对比与推荐

| 维度 | A 加固 | C 双模 | B 全上移 |
| --- | --- | --- | --- |
| 成本 | 天 | 周级（分阶段） | 月级 |
| 无人值守稳定性 | 不解决 | C2 后解决 | 解决 |
| 页面冻结/刷新免疫 | 否 | C1 后结构操作免疫 | 是 |
| 风险 | 低 | 中（双实现需收敛） | 高（冲突合并复杂） |
| 对现有功能冲击 | 无 | 渐进 | 大 |

**推荐路线：A 立即收尾（半天内）→ C 分阶段推进（C1 最先，直击三次实测全部架构类阻塞）→ B 作为 C3 完成后的自然终态。** 判据：如果产品定位是"用户在场 AI 辅助"，停在 A+C1 即可；如果要做"后台批量生产/服务器部署多 agent"，必须走到 C2。

## 五、参考来源

- [ComfyUI 架构：前端序列化 graph POST /prompt，后端建执行图异步执行（OcDevel）](https://ocdevel.com)
- [ComfyUI 节点图引擎内部机制（aiflowlearn）](https://www.aiflowlearn.net)
- [SwarmUI 将 ComfyUI 作为纯后端引擎的解耦实践（PromptQuorum）](https://www.promptquorum.com)
- [Blender headless + MCP 架构报告（Scribd）](https://www.scrcribd.com)
- [GUI-as-Tool vs GUI-as-SubAgent 模式对比（3dvar）](https://www.3dvar.com)
