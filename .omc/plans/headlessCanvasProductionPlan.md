# 技术方案：Headless 画布生产体系

- 依据规格：`.omc/specs/deep-interview-headless-canvas-production.md`（8 轮访谈，歧义 11%，8 条 AC）
- 日期：2026-09-29
- 状态：**已全部实施并通过验收（2026-09-29，P1~P4）**

## 0. 代码事实基础（已核实）

| 事实 | 位置 | 对方案的意义 |
| --- | --- | --- |
| 画布文档结构 `{toonflowCanvas, nodes, edges, viewport}`，node.data 含 prompt/model/size/ratio/handles/outputs/generationHistory | 工作区 `画布N.json` | 结构/配置/历史/产物引用全在文档，后端可完整读写；**无版本号字段，需新增** |
| model 存储为 `JSON.stringify([providerId, modelId])` 字符串 | node.data.model | 队列组装请求时解析 |
| generationHistory 记录 `{id, startedAt, finishedAt, status, prompt, model, files}` | node.data | 重建任务的判定依据 |
| 媒体生成原语 `generateMedia(cwd, mediaType, request, signal)` 完整在 server（读参考→调供应商→落盘） | `apps/server/src/utils/media/generation.ts:129` | 队列执行直接复用，无需改供应商层 |
| 画布校验 schema 为纯函数 | `packages/tools/canvas/src/runtime.ts` | 可 Bun/浏览器同构复用 |
| 结构操作与节点函数实现在页面 | `apps/web/.../useCanvasTools.ts` | 本方案要抽取/等价迁移的主体 |
| arrangeCanvas 依赖 Vue Flow 实测 DOM 尺寸（node.dimensions） | `arrangeCanvas.ts:19` | headless 需按类型默认尺寸估算（见 §6 风险） |
| 节点类型全集 7 种，生成类为 imageGenerationNode / videoGenerationNode | `packages/nodes/` | 队列第一版覆盖图/视频两类 |
| 写文件已有原子写+瞬时锁重试 | `apps/server/src/utils/workspace/files.ts` | Repository 复用 |
| MCP 46 工具在 server，画布类经控制通道转发页面 | `apps/server/src/utils/mcp/tools.ts` | 改造点 |

## 1. 总体架构

```
┌─────────────── 门面层（同一语义，三个入口）───────────────┐
│  MCP 工具（改造现有 46 个，agent 零感知） │  CLI（toonflow 命令） │  HTTP（/api/canvas/*） │
└──────────────┬──────────────────┬─────────────────┬──────┘
               └──────────────────┼─────────────────┘
┌───────────────────────── 核心层（server 进程）────────────┐
│  canvasOps 共享操作核（纯函数，Bun/浏览器同构）              │
│  CanvasRepository（文档读写 + revision 乐观锁 + 写串行化）  │
│  GenerationQueue（内存队列：依赖编排/并发/退避/失败3跳/重建）│
└────────────────────────────┬─────────────────────────────┘
┌───────────────────────── 存储层 ──────────────────────────┐
│  画布 JSON 文档（+revision） │  assets 产物  │  队列状态（内存，重启即空，按决策）│
└───────────────────────────────────────────────────────────┘
页面（Vue Flow 编辑器）：打开时读文档+记录 revision；保存带 revision（冲突 409+提示重载）；检测外部修改提示重载。不再是画布操作的执行者。
```

## 2. 组件一：后端画布引擎

### 2.1 canvasOps 共享操作核（新包 `packages/canvasOps`）

从 `useCanvasTools.ts` 的 execute switch 抽取**纯数据操作**，统一形态：

```ts
// 每个操作: (doc: CanvasDocument, args) => { doc: CanvasDocument, result: unknown }
applyAddNode / applyDeleteNodes / applyMoveNodes / applyRenameNodes /
applyConnectNodes / applyDeleteEdges / applyArrange / applyImportStoryboard / readCanvas
```

- 校验直接复用 `canvasSchemas`（zod）；连线端口校验改为对 `node.data.handles`（文档已有）的纯函数匹配，逻辑对齐 `validateConnection`；
- 页面端后续同样改为"应用 canvasOps 结果到 Vue Flow"（消除双实现漂移，属阶段 1 的页面配合项，可后置）；
- arrangeCanvas 见 §6 风险对策。

### 2.2 CanvasRepository（`apps/server/src/utils/canvas/repository.ts`）

```ts
readDocument(directory, canvasId): Promise<{ doc, revision }>
mutateDocument(directory, canvasId, expectedRevision, mutator): Promise<{ doc, revision }>  // 冲突抛 CanvasConflictError
```

- **文档格式扩展**：顶层新增 `revision: number`（首次由 Repository 初始化为 0，旧文档无字段视为 0，页面端容忍读取）；
- 写入路径：进程内 per-canvas 互斥队列（串行化）→ 变更 `revision` → `writeWorkspaceFile`（复用原子写+重试）；
- **页面写入同样经此通道**：页面 flushSave 改为带 revision 调用写接口，冲突返回 409 + 当前文档（页面提示重载）——这同时给了我们"页面写与 AI 写统一排队"的串行点。

### 2.3 MCP 工具改造（同名义同语义，agent 与技能文档零改动）

改造发生在 `wrapTool` 的执行分发处：画布类工具的 `execute` 从 `callControl(页面)` 改为直接调核心层。

| 工具组 | 新执行方式 |
| --- | --- |
| getCanvas / addCanvas / switchCanvas / renameCanvas | Repository 读写 |
| addNode / deleteNodes / moveNodes / renameNodes / connectNodes / deleteEdges / arrangeCanvas / importStoryboard | canvasOps + Repository |
| nodeTools:getConfig | 从文档读 node.data + 服务端模型能力表（listMediaProviders 数据源） |
| nodeTools:setPrompt / setConfig | 改 node.data（校验规则从各节点组件的 zod 迁移到 canvasOps，见 §6 清单） |
| nodeTools:generateImage / generateVideo / cancelGeneration | 入队 / 取消队列任务 |
| nodeTools:getGenerationStatus | 队列实时态 + 文档 generationHistory 合成 |
| getGenerationStatuses | 同上批量 + summary（已有口径） |
| selectNodes / fitCanvas | 纯 UI：有页面连接时转发页面执行；无页面时 no-op 返回说明（不报错，AC-7） |
| openProject / openApp / getSettings / updateSettings / refreshResources | 保留页面通道（页面编排职责） |

### 2.4 乐观锁与页面共存（AC-3）

1. 页面打开画布：读文档（含 revision）存内存；
2. 页面保存（flushSave）：携带 revision 调写接口；`revision` 不匹配 → 409「画布已被外部修改」→ 页面弹提示「AI 已修改画布，重载将丢弃本地未保存改动」+ 确认重载；
3. 页面检测外部修改：每 5 秒（可见时）比对文件 `revision`/mtime，变化即顶部提示条「画布已被 AI 修改，点击重载」；
4. AI 读始终从磁盘取最新 → 用户在页面的调整（保存成功后）立即对 AI 可见；
5. 冲突窗口 = 用户编辑未保存期间 AI 写入：用户保存时被 409 拦下（不静默覆盖，符合"互不覆盖"）。

### 2.5 GenerationQueue（`apps/server/src/utils/canvas/queue.ts`）

```ts
type QueueTask = {
  id: string; workspace: string; canvasId: string; nodeId: string; label: string;
  mediaType: "image" | "video";
  request: MediaGenerationRequest;     // 从 node.data 组装
  deps: string[];                       // 上游节点 id（cast 连线 + 参考端口）
  status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";
  attempt: number; error?: string; logs: { at: number; level: string; message: string }[];
};
```

- **提交**：`submitCanvas(workspace, canvasId, { scope: "missing" | "all" | nodeIds, concurrency? })` → 扫描生成类节点组装任务；`missing` 判定 = `!outputs 或 history 末条 status !== "succeeded" 或产物文件缺失（stat 校验）`——即 AC-2 的重建幂等口径，重启后同一命令直接复用；
- **依赖编排**：按 edges（资产 image 输出 → 视频 in 输入）拓扑分层，上游 succeeded 才调度下游；上游 skipped 时下游标记 skipped（原因"上游失败"）；
- **请求组装**：node.data 解析（model 字符串→[providerId, modelId]、prompt、duration、resolution、ratio、mode）+ 上游产物 `outputs.*.url`（工作区相对路径）→ MediaReference；
- **并发**：全局 `maxConcurrent`（默认 3，提交时可覆盖），per-provider 计数上限（可配）；
- **执行**：复用 `generateMedia(cwd, mediaType, request, signal)`；成功后经 Repository 回写 node.data.outputs + generationHistory（revision 冲突时重读重试一次）；
- **限流**：供应商错误分类（限流/429/超时类）→ 指数退避重入队，**不计入**失败次数（AC-8）；
- **失败**：非限流错误重试 3 次（attempt 计数）→ `skipped` + error 全文入 logs（AC-4）；队列继续；
- **取消**：cancelGeneration → 队列任务 abort；
- **查询**：`queueStatus(workspace, canvasId?)` → 各任务状态/错误/进度汇总；`taskLogs(taskId)` → 失败原因原文（如提示词敏感被拒）。

### 2.6 MCP 新增语义（不新增工具，扩展 importStoryboard）

- `importStoryboard` 增加 `options.autoSubmit: boolean`：导入后立即按 missing 语义入队（agent 一步完成导入+提交）；
- `node:generateVideo/Image` 语义从"页面即时执行"变为"入队"（返回 queued + taskId）——**语义微变**，技能文档 generation.md 相应更新（触发即入队，状态用 getGenerationStatuses 查）。

## 3. 组件三：CLI（`apps/server/src/cli.ts` + `bun scripts/toonflow.ts`）

- 传输：HTTP 调本机 server（自动探测 3000 → 失败则提示启动 Toonflow），token/端口可配；
- 命令组（与 MCP 同语义，借鉴 CLI-Anything 规范）：

```
toonflow project list / open <directory>
toonflow canvas list / get [--canvas id] / import <file.json> [--canvas id] [--auto-submit]
toonflow queue submit [--canvas id] [--scope missing|all|<nodeIds>] [--concurrency N]
toonflow queue status [--canvas id] [--watch]
toonflow queue logs <taskId>
toonflow queue retry <nodeId> [--edit file.json]     # 改 prompt/配置后重入队
toonflow install [--hosts dir1,dir2] [--force]        # 组件四
```

- 规范：POSIX 风格、`--help` 全量自发现（含示例）、`--json` 结构化输出、退出码（0 成功 / 2 参数错误 / 3 版本冲突 / 4 目标不存在 / 5 完成但存在失败任务）、管道友好；
- `--watch`：轮询 status 直到全部终态（挂机盯进度用）；
- HTTP 端点 `/api/canvas/*`、`/api/queue/*` 为 CLI 的传输层（实现复用核心层，不构成第二套语义）；
- SKILL.md：新写 `toonflowCli` 技能文档（命令清单 + 示例 + 退出码），由安装脚本装入宿主目录。

## 4. 组件四：安装脚本（`scripts/installExtensions.ts`）

```
toonflow install            # 或 bun scripts/installExtensions.ts
```

流程（幂等，秒级）：
1. **宿主探测**（零参）：按固定约定检查 `~/.zcode`、`~/.claude`、`~/.codex`、`~/.agents` 等目录存在性 → 每个存在的宿主安装技能副本（`canvasOperation` zip 内容 + `toonflowCli` 技能）到其 skills 目录；`--hosts` 显式覆盖；
2. **Toonflow 侧全量拉取**：下载中心 `manifest.json`（`curl -L` 语义）→ 逐项拉 dist（技能 zip 解压 `data/skills/`、供应商 `data/providers/`、工具 `data/tools/`）；版本一致跳过，`--force` 覆盖；
3. **报告**：`--json` 输出 `{ installed, skipped, hosts }`；
4. 参数：`--hosts`、`--force`、`--mirror <center-url>`、`--toonflow-only` / `--hosts-only`。

配套：canvasOperation 技能教程增加一行「或使用 `toonflow install` 一键安装」。

## 5. 分期计划（映射 AC）

| 阶段 | 内容 | 验收 | 验证方式 |
| --- | --- | --- | --- |
| **P1 画布引擎**（核心，最大） | canvasOps 抽取 + Repository（revision 乐观锁）+ MCP 画布工具后端化 + 页面 revision 检测/409/重载提示 | AC-1(无页面导入/配置)、AC-3、AC-7 | mock 供应商：关页面完成导入+配置；开页面改 prompt→AI 读到；页面保存遇 AI 写入得 409；双窗口无 connectionId 阻塞 |
| **P2 生成队列** | GenerationQueue（依赖编排/并发/退避/失败3跳）+ 重建命令 + getGenerationStatuses 合成 + autoSubmit | AC-1(全流程)、AC-2、AC-4、AC-8 | mock 批量 25 节点全流程；杀 server 重启→重建跳过已完成；构造敏感词失败→3 次跳过+日志可查+改后重提；模拟 429 退避不计失败 |
| **P3 CLI** | /api/canvas、/api/queue 端点 + toonflow CLI + toonflowCli 技能 | AC-5 | 新会话 agent 零文档仅 --help/--json 跑全流程（子代理实测） |
| **P4 安装脚本** | installExtensions + 宿主探测 + 中心配套 | AC-6 | 清空 data/skills+宿主目录→一条命令装齐；计时对比 |
| 每阶段收尾 | typecheck + dev:restart + 中心发布（如涉及收录内容变更）+ 阻塞点文档更新 | — | — |

## 6. 风险与决策点（需在实施中确认）

1. **arrangeCanvas 无 DOM**：页面算法依赖实测节点尺寸。headless 版按节点类型默认尺寸（7 类型固定估算值）分层排布——视觉上与页面排列可能略有差异，功能等价；文档记录 `lastKnownSize`（页面排列后回写）供后续精确化。`ACT:` 标注上限。
2. **节点 setConfig 校验迁移清单**：image/video 生成节点的 zod 校验（duration/resolution 枚举、mode 匹配、providerId+modelId 成对）逐条迁到 canvasOps 并保持报错文案不变（技能文档引用了这些文案）。
3. **语义微变**：`node:generate*` 即时执行 → 入队。页面内手动点击生成按钮**不变**（仍走页面即时链路）；仅 MCP/CLI 语义变为入队。技能文档 generation.md 更新。
4. **大画布性能**：几百节点 JSON 全量读写（产物为 url 引用非 base64）单文件数 MB 内，可接受；若超预期，P2 后再考虑增量写。
5. **页面双写过渡期**：阶段 1 上线后页面手动编辑与 AI 写入共用 Repository 写接口（带 revision），旧页面（未刷新）直写文件的窗口由 mtime/revision 检测兜底提示。
6. **audioNode / director3dNode / textNode / imageNode / videoNode**：引用/展示类节点无生成语义，队列不涉及；后续新增音频生成节点按同模式扩展。

## 7. 交付物清单

- `packages/canvasOps/`（共享操作核）
- `apps/server/src/utils/canvas/{repository,queue}.ts`
- `apps/server/src/routes/canvas/*`、`apps/server/src/routes/queue/*`（CLI 传输层端点）
- `apps/server/src/cli.ts` + `scripts/toonflow.ts`
- `scripts/installExtensions.ts`
- 页面改动：`useCanvasTools`（保存带 revision、外部变更检测）、画布面板（409/重载提示）
- 技能文档更新：`generation.md`（入队语义）、`connect.md`（无页面说明）、新增 `toonflowCli` 技能
- 中心：收录 `toonflowCli` 技能（sync.py 配置区登记）
