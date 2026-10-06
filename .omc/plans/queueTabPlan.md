# 队列 Tab 实现计划

> 需求来源：`.omc/specs/deep-interview-queue-tab.md`（歧义 15.5%，已收敛）
> 原型：`.omc/specs/queueTabPrototype.html`
> 状态：pending approval（未批准实施）

## 架构结论

**纯前端新增 + 后端一处小改（force 参数）**。数据源全部复用现有接口：

| 接口 | 用途 |
|---|---|
| `GET /api/queue/status?directory=&canvasId=a.json,b.json` | 任务明细 + summary + 并发（canvasId 逗号分隔多画布） |
| `GET /api/queue/logs?directory=&canvasId=&taskId=` | 单任务日志 |
| `POST /api/queue/cancel` | 按 taskId 取消 |
| `POST /api/queue/submit` | 重做失败任务（scope=nodes）；成功任务重新生成（新增 force 参数） |

手动点击的生成不进队列、不在表格展示（用户确认，本期 Non-Goal）。

## 改动清单

### 后端（1 处小改）

**`apps/server/src/utils/canvas/queue.ts` + `routes/queue/submit.ts`：submit 增加 `force` 参数**
- `submitCanvasQueue` 增加可选 `force?: boolean`；为 true 时跳过"已完成且产物在盘"的过滤（`outputsOnDisk` 检查，queue.ts:62-79），其余过滤（已在队列、无提示词）保留。
- `routes/queue/submit.ts` 的 zod schema 增加 `force: z.boolean().optional()`，透传。
- 改动后按规范执行 `bun run routes`（路由文件变更时）、`bun run typecheck`、`bun run build`，并用临时目录做 HTTP 验证。

### 前端

**1. `apps/web/src/pages/workspace/index.vue`：新增"队列"入口（约 5 处小改）**
- `activePanel` 类型 `"canvas" | "document"` → 加 `"queue"`（:59）
- `panelOptions` 加 `{ label: "队列", value: "queue", icon: IconListDetails }`（:62-65）
- `switchPanel` 合法值校验加 `"queue"`（:156）
- template 加 `keep-alive + v-if` 懒挂载 `queuePanel`（仿 document 面板写法 :12-19）
- `registerWorkspaceControl` 的 switchPanel 校验加 `"queue"`（:94-99，AI 可主动打开队列视图）

**2. 新建 `apps/web/src/pages/workspace/panels/queue/index.vue`（核心，预估 300~400 行）**

结构（对照原型）：
- **数据获取**：`GET /api/queue/status`，canvasId = 当前工作区全部画布逗号拼接；画布列表复用 canvasMenu 的 listCanvases 逻辑（`useWorkspaceFiles.list()` + `isCanvasFile`）。
- **轮询**：`window.setInterval` 3 秒 + `visibilitychange` 恢复可见立即刷一次 + 防重入标志（照抄 canvas/index.vue:799-876 模式）；自动刷新开关（暂停轮询）+ 手动刷新按钮。
- **筛选**（纯前端，作用于 status 返回的 tasks 数组）：画布（下拉，默认全部）、状态（下拉/全部 7 态）、媒体类型（图片/视频）、关键字（匹配节点 label / 画布名，大小写不敏感）。四维可叠加。
- **汇总条**：用 status 返回的 summary + concurrency 渲染 6 张卡片（排队/退避/执行/成功/失败跳过/并发进度条）。
- **表格**：`el-table size="small"` 固定 height；列 = 状态 tag、画布、节点（label + nodeId 副行、失败行附错误摘要）、类型 tag、尝试次数、提交时间、耗时、操作。
- **操作列**（按状态显隐）：
  - 全部状态：`日志`（弹窗 `GET /api/queue/logs`）、`编辑`（见下）
  - pending / backoff / running：`取消`（`POST /api/queue/cancel`，确认后刷新）
  - failed / skipped / cancelled：`重做`（`POST /api/queue/submit` scope=nodes + nodeIds）
  - succeeded：`重新生成`（同上 + `force: true`，需二次确认"将覆盖旧产物"）
- **编辑定位**：调 props 回调切换 `activePanel = "canvas"` 并激活对应画布 + 选中节点。实现方式：workspace/index.vue 向 queuePanel 传 `locateNode(canvasId, nodeId)` 回调——内部用现有 `activateCanvas`（canvasHost 已有）切画布，再通过画布面板 expose 的方法（需在 canvas/index.vue 的 defineExpose 增加 `locateNode(nodeId)`：`fitView({ nodes:[id] })` + `addSelectedNodes`）完成选中与聚焦。这是唯一需要动 canvas 面板的地方（约 10 行）。

**3. `apps/web/src/pages/workspace/panels/canvas/index.vue`：defineExpose 增加 `locateNode(nodeId)`**（选中 + 视图聚焦，供队列"编辑"调用）

### 文件命名与风格
- 新目录 `panels/queue/`、组件 `index.vue`，小驼峰；模板标签小驼峰；DOM 类名小驼峰（对照原型类名：`queuePanel`、`filterBar`、`summaryCard`、`queueTable`…）
- 不新增测试文件；类型检查用 `bun run typecheck`，构建用 `bun run build`

## 实施顺序（每步可独立验证）

1. 后端 force 参数 → 验证：typecheck + build + 临时目录 HTTP 验证（force=true 对已成功节点重新入队）
2. workspace/index.vue 入口 + queuePanel 空壳 → 验证：tab 可切换、MCP switchPanel 支持
3. 队列面板数据层（轮询 + 汇总条 + 表格只读展示 + 筛选）→ 验证：tdd 提交一批任务后表格实时更新、四维过滤正确
4. 操作列（日志/取消/重做/重新生成）→ 验证：真实取消 running 任务、失败任务重做、成功任务 force 重新生成
5. 编辑定位（canvas expose locateNode + 面板切换联动）→ 验证：点编辑跳到画布且节点选中聚焦
6. 全量 typecheck + build + 浏览器端到端过一遍验收清单

## 风险与边界

- `status` 接口多画布查询为逗号分隔 canvasId，工作区画布很多时 URL 变长——画布数通常 <50，可接受；超出再改后端聚合接口
- 队列纯内存：server 重启后表格清空属预期行为（面板空态文案说明）
- 轮询与 CLI `--watch` 无冲突（均为只读 status）
- `重新生成`覆盖旧产物：二次确认弹窗拦截
