# 生成执行、失败排查与重执行

生成类节点(图片生成、视频生成)通过节点函数驱动。**经 MCP/CLI 触发生成即入队**(立即返回 queued + taskId),由 server 内置队列调度:依赖自动编排(资产图先行)、并发受控、单任务失败重试 3 次后跳过、限流退避不计失败。用 `getGenerationStatuses`(或 CLI `queue status --watch`)轮询;失败原因用 `queueLogs`(CLI `queue logs <taskId>`)查询,修正后 `queue retry` 重提。批量提交用 `submitQueue`(scope=missing 幂等,server 重启后重跑即重建未完成任务)。页面内手动点击生成仍为即时执行,不受影响。

## 标准生成流程

```
node:setPrompt(提示词)   ← 必填;提示词为空时 generateImage 会拒绝("请输入生成提示词")
node:setConfig(模型/参数) ← providerId 与 modelId 必须同时提供
node:generateImage / node:generateVideo(启动,立即返回 generating)
轮询 node:getGenerationStatus(每 2~3 秒)直到 succeeded / failed
```

- 模型与参数的可选值:先 `node:getConfig` 查询(返回当前配置与可选模型列表),不猜测
- 参数大小写必须精确:分辨率、时长等枚举以模型声明为准(如 `480P`、`720P`);传错时错误信息会列出可选项,照着改
- 节点正在生成时再次触发生成会被拒绝("节点正在生成,请等待完成");可 `node:cancelGeneration` 停止(cancellationRequested 表示已发出,之后继续轮询状态)

## getGenerationStatus 返回

```json
{
  "status": "succeeded | failed | running | idle",
  "outputs": {
    "image": { "dataType": "IMAGE", "value": { "url": "assets/<nodeId>/image<uuid>.png", "mimeType": "image/png" } }
  },
  "error": "最近一次生成的错误信息(无错时省略)",
  "history": [
    { "startedAt": "...", "finishedAt": "...", "status": "failed", "error": "..." },
    { "startedAt": "...", "finishedAt": "...", "status": "succeeded" }
  ],
  "workspaceDirectory": "C:\\...\\<项目目录>"
}
```

- `outputs` 是**当前输出**,可能来自之前的生成;`idle` 不代表没有输出,只有 `succeeded` 表示本次生成成功
- `history` 是**持久化**的生成历史(随画布 JSON 保存,重开画布仍在,每个节点独立,最多保留最近 50 条),每条含:`prompt`(当时提示词)、`model`(供应商/模型)、`inputs`(参考文件)、`files`(产出文件,**含单次多产出的全部文件,不只第一张**)、`error`(失败原因)——排查问题与挑选历史结果的第一手资料
- `workspaceDirectory` 是工作目录绝对路径,与 `outputs` 的相对路径拼出文件完整位置

**挑选历史结果(多轮生成后回选)**:`node:selectOutput`(args: `{url}`)把历史产出中的某个文件设为**当前输出**,下游连线立即引用。url 取自 `history[].files[].url`,或该节点 `assets/<nodeId>/` 目录内文件(超出 50 条保留的产出仍可枚举目录后选择)。用户也可在节点 UI 上点「生成历史」图标,在弹框里浏览每轮结果并点选。

**关于单次多产出**:个别供应商模型单次可能返回多张图片/多个视频。`outputs` 只记录**第一张**(节点当前输出为单文件),但**全部产出都登记在本次 history 条目的 `files` 里**并落盘——AI 从 history 直接取全部候选,无需再枚举目录。

## 失败排查流程

1. 读 `error` 与 `history` 中失败记录的错误信息
2. 常见原因与修正:
   - 模型/参数不支持 → `node:getConfig` 查可选值,`node:setConfig` 修正(注意大小写)
   - 提示词问题 → `node:setPrompt` 改写
   - 供应商凭证/网络问题 → 提示用户检查设置,不要盲目重试
3. 修正后重新 `node:generateImage`,轮询确认 `succeeded`
4. `history` 会保留完整尝试轨迹(失败+成功),供后续分析

## 视频批量生成与重新生成

### 引用即依赖:先资产图,后视频

分镜视频节点的参考素材来自**连线进来的资产节点**(`importStoryboard` 已按 cast 连好)。`generateVideo` 启动时校验引用内容:引用的资产节点还没有输出时直接拒绝(`引用节点暂无内容,请先补充引用内容`)——所以必须**等资产图 succeeded 后再触发视频**。资产图重新生成后,引用自动跟随其最新输出。

### 批量触发 + 统一轮询

每个节点的生成是**独立后台任务**,不同节点可并行:

1. 逐个对每个分镜节点调用 `node:generateVideo`(每次立即返回 `generating`,不等待)
2. 全部触发后,用画布操作 `getGenerationStatuses` **一次查询全部节点状态**(每 3 秒),直到目标集合内 `succeeded`+`failed` 之和等于目标数;返回 `nodes: [{nodeId, label, status, error, outputs}]` 与汇总 `summary: {total, succeeded, failed, running, idle, unknown}`。**轮询口径**:`idle` 表示尚未触发生成,不计入等待(如只触发了图片生成,视频节点保持 idle 是正常的——按目标集合过滤或只看 summary);nodeIds 可选过滤。单节点完整历史仍用 `nodeTools` 调 `node:getGenerationStatus`
3. **同一节点**生成中不可重复触发(报"节点正在生成");需要中断用 `node:cancelGeneration`
4. 某些分镜失败时:先完成成功的分镜,失败的按"失败排查流程"修正后单独重试,不必重跑整批

### 重新生成(对结果不满意时)

视频生成支持**同节点反复重做**,这是常规工作流而非异常:

1. 查验当前视频(取回 `outputs` 路径抽帧看内容)
2. 不满意 → `node:setPrompt` 调整提示词(必要时 `node:setConfig` 换模型/时长/分辨率/模式)
3. 再次 `node:generateVideo` → 轮询 → 再查验,循环到满意

重生成行为:

- 新视频成为节点**当前输出**(`outputs` 指向最新,下游连线立即引用)
- 旧视频**不丢失**:全部产出登记在 `history[].files` 并落盘于 `assets/<nodeId>/`;回选历史版本用 `node:selectOutput`(args: `{url}`)
- `history` 累计每次尝试(提示词、模型、参考、产出、错误),完整可回溯

### 模式(mode)与引用的匹配

`node:getConfig` 返回 `matchingModes`(适合当前引用的生成模式)。引用数量或类型变化后(如从多参考改为首尾帧),原模式可能不再适用——`setConfig` 设置 mode 须匹配 getConfig 返回值;普通参考素材优先作为多参考,不自动变成首尾帧。
