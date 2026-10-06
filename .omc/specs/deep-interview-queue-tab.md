# Deep Interview Spec: 队列 Tab（生成任务队列视图与操作）

## Metadata
- Interview ID: queue-tab-20261006
- Rounds: 5
- Final Ambiguity Score: 15.5%
- Type: brownfield
- Generated: 2026-10-06
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 0.35 | 0.315 |
| Constraint Clarity | 0.83 | 0.25 | 0.208 |
| Success Criteria | 0.75 | 0.25 | 0.188 |
| Context Clarity | 0.90 | 0.15 | 0.135 |
| **Total Clarity** | | | **0.845** |
| **Ambiguity** | | | **15.5%** |

## Topology

| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| queueTab 队列入口 | active | 顶部居中"画布、文档"后新增"队列"tab（el-segmented），新建 panels/queue 面板 | R1-R5 全覆盖 |
| queueTable 表格视图 | active | el-table 呈现任务 + 状态/画布/媒体类型/关键字四维过滤 + 轮询自动刷新 | R4 定范围、R5 定过滤维度 |
| taskOps 任务操作 | active | 日志查看、取消、失败重做、成功重新生成、编辑定位节点 | R1 定编辑、R3 定重做 |
| manualVisibility 手动任务可见 | deferred | 手动点击生成的任务在队列中展示与取消 | R2 用户确认本期不做：手动生成本就即时执行不经队列，硬塞无意义；后续有需要再立项 |

## Goal
在工作区页面顶部居中的"画布、文档"分段控制器后新增"队列"入口，打开后以表格总览 **server 内存生成队列**（CLI/MCP/自动提交链路）的任务：默认展示当前工作区全部画布的任务，支持按状态、画布、媒体类型过滤与关键字搜索，自动轮询刷新；对任务提供日志查看、取消、失败重做、成功重新生成、编辑（定位到画布节点）五类操作。页面上手动点击节点的生成不进队列、本期不在表格中呈现。

## Constraints
- 数据源仅限现有 server 内存队列（`/api/queue/status|logs|cancel|submit`），不展示手动直连生成的任务
- 队列任务本身仍是纯内存态（server 重启清空），表格如实反映，不做任务持久化
- 默认聚合当前工作区所有画布（`canvasId` 逗号分隔查询），提供画布筛选
- 手动生成的即时直连链路保持现状，不改节点组件的生成行为
- 不引入 WebSocket/SSE，沿用项目 setInterval + axios 轮询模式（页面不可见时暂停）
- 后端仅允许一处小改动：submit 增加 force 参数（绕过"产物在盘跳过"过滤），其余零后端改动

## Non-Goals
- 不做手动生成任务的展示/取消（用户确认延后）
- 不做任务持久化、历史归档、跨 server 重启的任务恢复
- 不做表格内直接编辑提示词/参数（编辑=定位到节点）
- 不做任务备注/标签、优先级调整、并发数在线调节
- 不做拖拽排序、批量操作（本期操作均为单行）

## Acceptance Criteria
- [ ] 顶部居中出现"队列"tab，与画布/文档同级，点击切换到队列面板，再点可切回
- [ ] 默认展示当前工作区全部画布的队列任务，含画布列；画布下拉可筛选单个画布
- [ ] 状态筛选（pending/backoff/running/succeeded/failed/skipped/cancelled）、媒体类型（图片/视频）、关键字（匹配节点名/画布名）过滤均生效，可与画布筛选叠加
- [ ] 表格自动轮询刷新（间隔约 3 秒，页面不可见暂停、恢复可见立即刷一次），并提供手动刷新；有轮询暂停开关
- [ ] 汇总条展示各状态任务计数与当前并发（running/maxConcurrent）
- [ ] 对 running/pending/backoff 任务可取消，取消后状态变为 cancelled
- [ ] 对 failed/skipped/cancelled 任务可"重做"：重新入队并出现在表格中（状态回到 pending/running）
- [ ] 对 succeeded 任务可"重新生成"：携带 force 重新入队，绕过"产物在盘跳过"保护，覆盖旧产物
- [ ] "编辑"跳转到任务对应画布 tab 并选中该节点（打开节点面板可改提示词）
- [ ] 每行可打开日志弹窗，展示该任务最近日志（`/api/queue/logs`）
- [ ] MCP `switchPanel` 可切换到队列面板（AI 可主动打开队列视图）

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| 表格能看到所有生成任务 | 代码调研发现两条链路割裂：手动点击不进队列 | R2 确认本期只呈现 server 队列任务，手动任务延后 |
| "编辑"= 改任务参数 | 任务只带 canvasId+nodeId，参数在节点 data 里 | R1 确认编辑=定位到节点，复用节点编辑能力 |
| 取消可以跨页面执行 | 生成请求由页面持有（后确认：仅手动链路如此，队列任务在 server） | 手动任务不进表格后此约束消解；队列任务取消走 server API 无限制 |
| 重做对所有状态可用 | 现有 submit 会跳过"已成功且产物在盘"的节点 | R3 确认失败可重做（零后端）+ 成功可重新生成（submit 加 force 参数） |
| 表格默认单画布视角 | status 接口按画布查询，聚合非现成能力 | R4 确认默认全工作区聚合（前端拼多画布参数），可按画布筛选 |

## Technical Context
- 队列核心：`apps/server/src/utils/canvas/queue.ts`（内存 Map、并发 3、依赖编排、退避重试、取消）
- 队列路由：`apps/server/src/routes/queue/{submit,status,logs,cancel}.ts`（前端目前零消费）
- 顶部入口：`apps/web/src/pages/workspace/index.vue:21-28`（el-segmented panelSwitcher）、`:59`（activePanel ref）、`:62-65`（panelOptions）、`:94-99`（MCP switchPanel 校验）
- 轮询参照：`apps/web/src/pages/workspace/panels/canvas/index.vue:799-876`（5s revision 轮询 + visibilitychange + 防重入）
- 表格参照：`apps/web/src/pages/home/workspacePicker.vue`、`storyboardImportDialog.vue`（el-table 用法）
- 画布列表获取：复用 canvasMenu 的 listCanvases 逻辑（useWorkspaceFiles.list + isCanvasFile）
- 画布定位选中：activateCanvas 已有；选中节点需在画布面板暴露定位方法（flow 节点选中 + 视图聚焦）

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| QueueTask | core domain | id, canvasId, nodeId, label, mediaType, status(7态), attempt, error, logs[], deps[], submittedAt/startedAt/finishedAt | 属于一个画布、指向一个节点；依赖同批上游任务 |
| 队列面板 | supporting | 筛选器、汇总条、表格、操作 | 消费 server 队列模块的 HTTP 接口 |
| 画布节点 | supporting | id, data(生成参数), generationHistory | 被任务引用；编辑操作定位目标 |
| server 队列模块 | external system | tasks Map, maxConcurrent=3, pump 调度 | 队列面板的唯一数据源 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 5 | 5 | - | - | N/A |
| 2 | 4 | 0 | 0 | 4 | 80%（ManualGeneration 移除） |
| 3 | 4 | 0 | 0 | 4 | 100% |
| 4 | 4 | 0 | 0 | 4 | 100% |
| 5 | 4 | 0 | 0 | 4 | 100% |

## Interview Transcript
<details>
<summary>Full Q&A (5 rounds + Round 0)</summary>

### Round 0（拓扑确认）
**Q:** 队列表格的数据源范围怎么定？当前只有 headless 链路任务在 server 内存队列，页面手动点击生成不经过队列。
**A:** 可以看到所有，但是手动生成的特殊处理，不用排队啥的，而是只是支持看+取消即可。（后续 R2 收敛为不展示）
**补充追问（R2）:** 现在的队列是存到前端的吗？→ 已解释：server 进程内存，前端仅 HTTP 查询。
**补充追问（R2）:** 手动点击后是立刻调用接口开始生成了吗？→ 已解释：是，无排队；用户据此确认手动任务暂不进表格。

### Round 1（taskOps/Goal：编辑语义）
**Q:** 队列表格里的"编辑"具体指什么？
**A:** A：定位到节点编辑——切到画布、选中并打开对应节点，在节点里改参数。
**Ambiguity:** 45%

### Round 2（manualVisibility/Constraints：可见范围）
**Q:** 手动生成的记录登记在哪、什么可见范围？
**A:** 先问队列现状 → 解释后用户判断手动生成即时执行、暂不需要放队列 → 确认 A：不展示手动任务（最简）。
**Ambiguity:** 30%

### Round 3（taskOps/Goal：重做语义）
**Q:** "重做"的确切范围？
**A:** B：失败可重做 + 成功可重新生成（后端 submit 加 force 参数）。
**Ambiguity:** 27%

### Round 4（queueTable/Constraints：数据范围，Contrarian 模式）
**Q:** 队列表格默认展示哪个范围的任务？
**A:** 支持画布筛选，默认当前工作区。
**Ambiguity:** 22%

### Round 5（queueTable/Goal：过滤维度）
**Q:** 需要哪些查询过滤维度？
**A:** 状态筛选、画布筛选、媒体类型、关键字搜索（全选）。
**Ambiguity:** 15.5%（低于阈值 20%，收敛）
</details>
