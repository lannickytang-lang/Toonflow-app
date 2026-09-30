# server 画布操作能力清单（权威提取）

> 本文件由权威注册表自动生成，**勿手改**，发布门禁会校验一致性。
> 这是 MCP 与 CLI 共用的操作全集——据此可发现 CLI 尚未暴露的能力。
> 逃生通道：CLI 未暴露的操作可直接 `POST http://127.0.0.1:3000/api/canvas/operation`，
> body {"directory": "<工作区>", "name": "<操作名>", "args": {…}}，请求头须带 `Origin: http://127.0.0.1:3000` 与 `x-toonflow-workspace: 1`；
> args 结构按下方各操作的字段。除画布操作外 server 还有队列（/api/queue/*）、设置（/api/settings/*）、项目（/api/projects/*）等接口，CLI 命令即其封装。

## getCanvas

获取当前工作区的 canvases 列表及激活画布的 id、nodes、edges、viewport、availableNodeTypes 和各节点注册的 nodeTools。操作前先查询实际节点 ID、端口和节点类型；不要通过修改画布 JSON 控制激活的画布。

字段：

## addCanvas

在当前工作区创建空白画布 JSON 并切换到新画布。name 可选且不含 .json 扩展名；省略时自动使用未占用的画布N，同名文件不会被覆盖。返回新画布状态，本轮后续调用可继续新增节点。

字段：
- name:
  - string（可选）

## switchCanvas

先从 getCanvas 的 canvases 列表获取 canvasId，再切换激活画布。等待当前修改保存，返回新画布状态，本轮后续操作继续作用于新画布。

字段：
- canvasId:
  - string

## renameCanvas

重命名当前工作区画布，同时修改对应 JSON 文件名。省略 canvasId 时重命名激活画布；name 不含 .json 扩展名。不会覆盖已有文件，返回操作后的激活画布与 canvases 列表。

字段：
- canvasId:
  - string（可选）
- name:
  - string

## addNode

在激活画布的画布坐标 position 新增节点，type 必须来自 getCanvas 的 availableNodeTypes。返回新增节点详情和注册的 nodeTools。

字段：
- type:
  - string
- position:
  - object
- label:
  - string（可选）

## deleteNodes

从激活画布批量删除指定 nodeIds 的节点及其连接边；同一批次内的父子节点可以一起删除，任一节点校验失败则整体不执行。

字段：
- nodeIds:
  - array

## moveNodes

将激活画布指定节点批量移动到各自的画布坐标 position，一次可传入多个节点，任一项校验失败则整体不执行。

字段：
- moves:
  - array

## renameNodes

批量修改激活画布指定节点的显示名称，一次可传入多个节点，任一项校验失败则整体不执行。

字段：
- renames:
  - array

## connectNodes

批量连接激活画布的输出端口 sourceHandle 和输入端口 targetHandle，一次可传入多组连接。先用 getCanvas 确认节点与端口；沿用画布和节点的连接校验，任一项校验失败则整体不执行。

字段：
- connections:
  - array

## deleteEdges

从激活画布批量删除指定 edgeIds 的连线，任一项校验失败则整体不执行。

字段：
- edgeIds:
  - array

## selectNodes

选择激活画布中指定 nodeIds 的节点；传空数组取消节点选择。

字段：
- nodeIds:
  - array

## arrangeCanvas

根据节点实际尺寸和连线，将激活画布的全部顶层节点从左到右自动排列，并适应视图。子节点保持相对位置，不修改内容、连线或选择，不触发生成。返回 arrangedNodeIds 和 viewport；节点尺寸未就绪或存在不可移动节点时拒绝整理。仅在需要整理整幅画布时调用；局部调整使用 moveNodes，单纯查看使用 fitCanvas。

字段：

## fitCanvas

调整激活画布视口以展示 nodeIds 指定的节点；省略 nodeIds 则展示全部节点。

字段：
- nodeIds:
  - array（可选）

## nodeTools

调用激活画布节点注册的 node:functionName。nodeId 和 name 可从 getCanvas 或 addNode 的 nodeTools 获取，args 按该函数的 parameters 填写。新建节点可在同轮调用；不要通过修改画布 JSON 代替节点函数。

字段：
- nodeId:
  - string
- name:
  - template_literal
- args:
  - record

## getGenerationStatuses

一次查询画布上多个生成类节点的状态,适合批量触发生成后统一轮询。nodeIds 省略时查询全部注册了 node:getGenerationStatus 的节点(图片/视频/音频生成节点);返回 nodes: [{nodeId, label, status(idle/running/succeeded/failed/unknown), error(最近一次错误), outputs(当前输出)}] 与 summary: {total, succeeded, failed, running, idle, unknown}。轮询完成判定:目标集合内 succeeded+failed 之和等于目标数即结束;idle 表示尚未触发生成,不计入等待。单节点的完整生成历史用 nodeTools 调用 node:getGenerationStatus。

字段：
- nodeIds:
  - array（可选）

## importStoryboard

按标准 JSON 一次创建分镜画布。assets 每项建一个资产节点：有 filePath（工作区相对路径，需先用文件工具写入）且图片节点可用时建图片节点直接引用，否则建图片生成节点（prompt=imagePrompt，缺省时注明参考图 filePath），options.imageModel（providerId+modelId）会同步配置到图片生成节点。scenes 按 sortNum 升序每项建一个视频生成节点（prompt=videoPrompt），options 提供 videoModel（providerId+modelId）、duration、resolution 时同步配置，未提供则用节点默认；scenes[].duration 可为单个分镜指定时长，优先于 options.duration。cast 为出镜资产 name 列表，建完后从资产节点 image 端口连线到视频节点 in 端口，最后自动排列并适应视图；导入完成、画布就绪后，options.autoGenerateImages 为 true 时才统一对有 imagePrompt 的资产节点触发生图（入队，生成失败不影响已建好的画布结构）；导入为幂等语义：与存量同 label 且参数一致的资产/分镜自动跳过（返回 skippedAssets/skippedScenes），同名但不一致的默认跳过并记入 conflicts（返回差异明细，可据此 node set 修改后重试或用 options.forceAdd 强制追加新节点），全部一致时零副作用（不写画布）；options.check 为 true 时干跑——只返回 assets/scenes 的比对结果（skip/conflict/new 判定与差异明细）不建任何节点。options.autoSubmit 为 true 时导入后立即把画布上全部未完成生成任务提交到队列（scope=missing，幂等，可用于断点重建）。导入前会用首个视频节点的模型能力校验各分镜 cast 数量：超出模型最大图片参考数（text=0、单图=1、首尾帧=2、多参考按声明上限）会在建边前报错并列出冲突分镜。返回 assetNodeIds（[{name, nodeId}]，含跳过项登记的现有节点供连线）、sceneNodeIds（新增）、edgeIds（新增）、arrangedNodeIds、skippedAssets、skippedScenes、conflicts、importedCount。提供 options 前必须先用 listMediaProviders（或节点 node:getConfig）查询模型与可选项，duration/resolution 需匹配模型的 durationResolutionMap，参数不符会导致导入中途失败。

字段：
- assets:
  - array
- scenes:
  - array
- options:
  - object（可选）
