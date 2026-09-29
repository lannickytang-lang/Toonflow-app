# Deep Interview Spec: Headless 画布生产体系（后端直操作 + 批量挂机 + CLI + 零参安装）

## Metadata
- Interview ID: headless-canvas-production-20260929
- Rounds: 8（Round 0 拓扑确认 + 8 轮）
- Final Ambiguity Score: 11%
- Type: brownfield
- Generated: 2026-09-29
- Threshold: 0.2
- Threshold Source: default
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.95 | 35% | 0.3325 |
| Constraint Clarity | 0.88 | 25% | 0.2200 |
| Success Criteria | 0.85 | 25% | 0.2125 |
| Context Clarity | 0.85 | 15% | 0.1275 |
| **Total Clarity** | | | **0.8925** |
| **Ambiguity** | | | **11%** |

## Topology

| Component | Status | Description | Coverage |
|-----------|--------|-------------|----------|
| 后端画布 API（文档模式） | active | AI 直接调 server 接口完成画布结构操作/节点配置/触发生成/查状态，不依赖页面在场；含人机共存与冲突策略 | AC-1/3/7 |
| 挂机批量生产能力 | active | 内存队列：并发控制、限流退避、进度查询；不做持久化恢复，支持从画布重建未完成任务 | AC-2/4 |
| CLI 命令层 | active | 手写薄 CLI 包装（与 MCP 同语义同后端），遵循 agent-friendly CLI 规范（借鉴 CLI-Anything） | AC-1/5 |
| 一键安装脚本 | active | 零参数自动探测 agent 宿主并装技能目录 + 全量拉取 Toonflow 侧插件 | AC-6 |

## Goal

为 Toonflow 构建 headless 画布生产体系：外部 agent 不依赖前端页面，通过后端 API（及同语义的 CLI）直接操作画布完成分镜导入、配置与批量生成提交；几百个视频任务（单任务约 15 分钟）在 server 内存队列中挂机多天执行，server 重启后队列可丢但 AI 能从画布文档幂等重建未完成任务；生产期间用户可打开画布页面查看并手动调整，双方修改互可见且互不覆盖（文档级版本乐观锁）；插件安装由零参数脚本一条命令完成，agent 不再逐条推理安装。

## Constraints

1. **演进策略（改造现有工具）**：现有 46 个 MCP 画布工具**同名同语义**改为后端执行（复用共享校验 + 直接写画布文档）；agent 与 canvasOperation 技能文档零改动；无页面时直接可用，有页面时也走后端（页面靠版本锁共存）。不新增平行 API，页面控制通道的画布职责自然萎缩。
2. **冲突策略（文档级，不做节点级合并）**：后端写画布带文档版本号；页面保存时版本不匹配则拒绝写入并提示重载（防页面旧内存覆盖 AI 写入）；AI 读操作始终从磁盘取最新（AI 能看到用户调整）；页面检测到画布文件被外部修改时提示重载（用户能看到 AI 调整）。
3. **队列无状态可重建**：内存队列不持久化；重启后从画布文档扫描"无产物/未成功"节点即可重建，重建幂等（已 succeeded 且产物在盘的节点跳过）。
4. **失败模型**：单任务失败重试 3 次即跳过（不暂停整个队列）；每次失败可查日志与原因（如提示词敏感）；跳过的任务保留，agent 调整（改提示词等）后可重新入队。不设成本/任务总数上限。
5. **并发与限流**：并发数可配（默认保守）；供应商 429/限流按退避重试（不计入失败 3 次）。
6. **CLI 规范**（借鉴 CLI-Anything 设计而非其生成流水线）：POSIX 风格命令组、`--help` 自发现、`--json` 结构化输出、退出码语义、SKILL.md 供宿主发现；与 MCP 工具同语义同后端，一套实现两个门面。
7. **安装零参**：自动探测 zcode/claude/codex 等宿主技能目录（固定路径约定），支持显式覆盖；同时全量拉取中心 manifest 收录的 Toonflow 侧插件（技能/供应商/工具）。
8. **交付边界**：产物落盘（尺寸/时长可抽查）+ 路径清单即交付；成片合成不进本期（agent 自行 ffmpeg）。
9. **多窗口免疫**：后端 API 不依赖页面连接，多个页面开同一画布不再引起 MCP 连接路由混乱（现状痛点根源）。

## Non-Goals

- 不做实时双向同步（OT/CRDT/操作补丁推送流）——文档级乐观锁 + 重载提示足够；
- 不做队列持久化与断点自动恢复——靠画布重建代替；
- 不做成本/次数总熔断——按用户决策，仅失败 3 次跳过；
- 不采用 CLI-Anything 的自动生成流水线（质量不可控、语义与现有 MCP/技能文档不一致）；
- 不做页面实时回显 AI 的每步操作；
- 不做成片合成/转场；
- 不改动现有页面手动编辑体验的核心交互（仅加版本冲突检测与外部变更提示）。

## Acceptance Criteria

- [ ] AC-1 全程无页面：外部 agent 不开任何 Toonflow 页面，仅凭 CLI（或 MCP/HTTP，三者同语义）完成 分镜导入 → 配置 → 批量提交 → 进度查询 → 产物查验（落盘 + 路径清单）全流程
- [ ] AC-2 重建能力：几百任务挂机中杀掉 server 重启，队列清空；AI 用一条命令从画布重建未完成任务（已 succeeded 且产物在盘的跳过，不重复生成）
- [ ] AC-3 人机共存：挂机期间用户打开画布查看并调整（改 prompt/配置），AI 后续读操作能看到用户修改；页面后续保存不覆盖 AI 已写入的画布变更（版本冲突时页面拒绝写入并提示重载）
- [ ] AC-4 失败模型：单任务失败 3 次自动跳过且不拖垮队列；每次失败的原因/日志可查（MCP/CLI 均可）；调整后重新入队成功
- [ ] AC-5 CLI 零文档可用：新会话 agent 不读任何文档，仅凭 `--help` 与 `--json` 完成 AC-1 全流程
- [ ] AC-6 零参安装：一条命令装齐中心收录的插件 + 自动探测到的宿主技能目录；安装时间从 AI 逐条推理的 8~10 分钟降到脚本秒级
- [ ] AC-7 多窗口免疫：同一画布开多个页面窗口时，后端 API 操作不受影响，不出现"存在多个页面须指定 connectionId"类阻塞（该限制仅存在于保留的页面编排工具）
- [ ] AC-8 限流韧性：供应商 429/限流退避重试不计入失败次数；并发可配置生效

## Assumptions Exposed & Resolved

| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| 回显需要实时同步 | Round 1 三选项成本差一个量级 | 不强求实时；Round 5 精化为"双方可见+互不覆盖"（乐观锁） |
| CLI-Anything 可直接采用 | Round 2 调研：它是源码→CLI 生成流水线，非 NL 解析器 | 手写薄包装，只借鉴其 CLI 设计规范 |
| 队列需要持久化断点续跑 | Round 5 | 降级：内存队列 + 画布重建（无状态派生），更简单且幂等 |
| 安装需要 AI 传参 | Round 4 Contrarian | 零参自动探测宿主目录 |
| 任务挂在独立任务单系统 | Round 3 本体论 | 画布即生产单元，队列是画布的无状态派生物 |
| 后端 API 需要新增一套平行接口 | Round 6 Simplifier | 改造现有 46 个 MCP 工具为后端执行，零新增概念 |
| 队列需要成本/次数熔断 | Round 7 | 不要总熔断；单任务失败 3 次跳过 + 可查原因 + 调整后重提 |
| 交付需要成片合成 | Round 8 | 落盘 + 清单即交付，合成由 agent 自行 ffmpeg |

## Assumptions Exposed & Resolved

| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| 回显需要实时同步 | Round 1 三选项成本差一个量级 | 不强求实时；Round 5 精化为"双方可见+互不覆盖"（乐观锁） |
| CLI-Anything 可直接采用 | Round 2 调研：它是源码→CLI 生成流水线，非 NL 解析器 | 手写薄包装，只借鉴其 CLI 设计规范 |
| 队列需要持久化断点续跑 | Round 5 Contrarian | 降级：内存队列 + 画布重建（无状态派生），更简单且幂等 |
| 安装需要 AI 传参 | Round 4 Contrarian | 零参自动探测宿主目录 |
| 任务挂在独立任务单系统 | Round 3 本体论 | 画布即生产单元，队列是画布的无状态派生物 |

## Technical Context（brownfield 事实）

- 画布文档（画布N.json）已在 server 磁盘，节点配置（prompt/model/duration/resolution）与生成历史（generationHistory）都在 node.data 内；媒体生成链路已在 server（/api/ai/generate → 供应商 → 产物落盘 工作区/assets/<nodeId>/）。
- 现有画布操作校验为纯函数（canvasSchemas zod，packages/tools/canvas/src/runtime.ts），可 Bun/浏览器同构复用。
- 依赖页面执行的部分：useCanvasTools 的 execute switch（校验+应用到 Vue Flow）、nodeTools 闭包（节点组件内 setConfig/generate/getStatus）、每操作后 flushSave（页面内存→磁盘，存在覆盖外部写入的冲突窗口，useCanvasTools.ts:107 附近）。
- MCP 46 个工具已在 server（10588/主端口），其中画布类经 SSE 控制通道转发页面执行——为多窗口/后台节流/页面在场依赖的痛点根源（三次实测证据：45/32/74 分钟，架构类阻塞占 6 成）。
- 分发中心（Gitee tudodo-center）已发布 manifest（canvasOperation 1.3.0、grsai 1.1.0、mockProvider 2.1.0）与 sync.py 门禁；agent 安装走 appOperation 逐条推理（实测 8~10 分钟）。
- CLI-Anything 调研结论：7 阶段源码→CLI 生成流水线，供 AI agent 消费（--help/--json/SKILL.md/REPL），不做自然语言解析；对其"借鉴规范、不采用生成"。

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Canvas | core domain | 节点/连线/视口/文档版本号 | 生产单元；派生 Task；页面与后端 API 共写（乐观锁） |
| Task | core domain | 节点引用、依赖（cast 连线）、状态、重试计数 | 从 Canvas 节点派生；进内存 Queue |
| Queue | supporting | 并发上限、退避策略、进度汇总 | 无状态派生物，可从 Canvas 重建 |
| BackendCanvasApi | core domain | 结构操作/配置/生成触发/状态查询 | 与 MCP 同语义；CLI 的后端 |
| Cli | supporting | 命令组、--help、--json、SKILL.md | BackendCanvasApi 的门面 |
| Installer | supporting | manifest、宿主探测路径 | 拉取中心；写 Toonflow data/ 与宿主技能目录 |
| Page | supporting | 画布编辑器、版本检测、变更提示 | Canvas 的观察者+手动编辑方 |

## Ontology Convergence

| Round | Entity Count | New | Changed | Stable | Stability |
|-------|-------------|-----|---------|--------|-----------|
| 1 | 5 | 5 | - | - | N/A |
| 3 | 7 | 2 | 0 | 5 | 71% |
| 5 | 7 | 0 | 0 | 7 | 100%（连续稳定） |

## Interview Transcript
<details>
<summary>Q&A（8 轮）</summary>

### Round 0（拓扑确认）
**Q:** 4 个顶层组件（后端画布 API / 挂机批量 / CLI 层 / 一键安装脚本）是否符合意图？
**A:** 都对，但 CLI 后端化后要思考前端回显、部分画布功能是否能正常。

### Round 1
**Q:** 后端 API 修改画布时，已打开的前端页面如何表现？
**A:** 不强求（headless 优先，回显后续再说）。

### Round 2
**Q:** CLI 层的真实意图？
**A:** 手写薄 CLI 包装，但学习 CLI-Anything 的规范，确保 AI 能准确流畅使用。

### Round 3
**Q:** 几百个视频任务的数据模型挂在哪里？
**A:** 画布即生产单元。

### Round 4（Contrarian）
**Q:** 全量安装为什么还需要 AI 传参？能否零参数自动探测？
**A:** 自动探测 + 零参。

### Round 5
**Q:** 哪些是必须达成的验收标准？
**A:** server 重启丢了就丢了，要提供 AI 重新创建未完成任务的能力；agent 执行期间用户也能打开画布查看或操作调整，AI 要能看到最新调整，思考冲突处理。

### Round 6（Simplifier）
**Q:** 后端 API 与现有 46 个 MCP 工具/技能文档的关系？
**A:** 改造现有工具（同名同语义后端执行，零新增概念）。

### Round 7
**Q:** 几百次真实 API 调用的挂机场景，队列层要不要保险丝？
**A:** 单任务失败 3 次跳过；每次失败可查日志/原因（可能提示词敏感）；agent 调整后重试。

### Round 8
**Q:** 几百个分镜视频生成完，"交付"的边界到哪？
**A:** 落盘 + 清单即交付（合成 agent 自行 ffmpeg）。
</details>
