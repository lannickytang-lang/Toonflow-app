# Deep Interview Spec: tdd 体验优化方案 + tdd-import 技能

## Metadata
- Interview ID: tdd-import-2026-10-06
- Rounds: 8（R0 拓扑 + R1-R7 访谈）
- Final Ambiguity Score: 17%（组件 B： tdd-import）/ 18%（组件 A： 优化方案）
- Type: brownfield
- Generated: 2026-10-06
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no（初始输入未超预算；两份子代理调研报告作为外部上下文引用，不内联）
- Status: PASSED

## Clarity Breakdown

组件 B（tdd-import 技能，本次唯一代码落地物）：

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 0.35 | 0.315 |
| Constraint Clarity | 0.80 | 0.25 | 0.200 |
| Success Criteria | 0.80 | 0.25 | 0.200 |
| Context Clarity | 0.75 | 0.15 | 0.113 |
| **Total Clarity** | | | **0.828** |
| **Ambiguity** | | | **17%** |

组件 A（CLI 体验优化方案）：

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 0.35 | 0.315 |
| Constraint Clarity | 0.75 | 0.25 | 0.188 |
| Success Criteria | 0.75 | 0.25 | 0.188 |
| Context Clarity | 0.85 | 0.15 | 0.128 |
| **Total Clarity** | | | **0.818** |
| **Ambiguity** | | | **18%** |

## Topology

| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| tdd-import 技能 | active | 新增 skill：拆解各种格式输入→确认分隔规律→模板库复用→python 转换 tdd-import.json→tdd-viewer.html 预览 | 验收标准 AC1-AC8 全覆盖 |
| CLI 体验优化方案 | active | 针对调研发现的 5 类阻力产出结构化建议清单，只出方案不改代码 | 验收标准 AC9-AC10 覆盖 |

## Goal

1. **新增 tdd-import 技能**（源码 `tdd-prompt/.agents/skills/tdd-import/`，按仓库惯例经 `tdd install` 分发到 `~/.agents/skills/`）：把 4 种输入形态（粘贴大段文本 / 文件路径 / 自家产线中间产物 / 目录+图片素材）转换成合法 `tdd-import.json`，并用 tdd-viewer.html 预览。流程遵循用户 3.1–3.5 设想：
   - **3.1 拆解**：先量输入素材大小；超过阈值时禁止整体加入上下文，只抽样头部/尾部/中段片段识别"资产图、分镜如何分隔"的规律。
   - **3.2 确认门**：向用户输出识别到的分隔规律 + 前 3 个资产与前 3 个分镜的解析样本，等待确认后才继续。
   - **3.3 模板库**：用户主目录全局库（`~/.agents/tdd-import-templates/`，具体目录名实现时定），含索引文件；模板为**指纹+脚本双层**——索引按格式指纹匹配，命中直接执行历史转换脚本（零成本），失配现场写新脚本并作为新模板入库。跨项目复用，技能升级不丢模板。
   - **3.4 转换**：python 转换脚本产出 `tdd-import.json`；`options` 完整确定所有可选项；模型定值机制：每次转换都交互询问（`tdd models` 实查清单），选项包含**用户场景推荐项 + 历史最近一次选择**。
   - **3.5 预览**：优先用宿主内嵌浏览器（browser-use）打开生成的 tdd-viewer.html；模板复用 `pipeline-report.mjs` 的 `renderTddViewer`。
   - **3.6 执行导入**：预览确认后执行 `tdd canvas import`（可先 `--check` 干跑比对）；导入成功 ≠ 完成。
   - **3.7 双层复查**：① 确定性脚本复查——`tdd --json --canvas <名> canvas get --nodes` 导出画布全量配置，对照 tdd-import.json 逐项核对（资产/分镜节点数、每个分镜入边数=cast 列表、ratio/model/duration/resolution 逐节点核对）；② AI 语义复查——读导出的画布配置查结构性核对覆盖不到的语义问题（图节点比例 vs 视频比例一致性、孤立参考图等）。两层问题合并成复查报告呈现给用户，发现问题不自动修复，等用户决定。
2. **产出 CLI 体验优化方案**：落盘 `tdd-prompt/docs/` 的结构化清单文档，覆盖调研发现的全部 5 类阻力，每条含：现象 → 根因 → 建议（改哪里/怎么改/工作量估）→ 优先级。

## Constraints

- 不修改 tdd CLI / Toonflow server / web 端任何源码（优化只出方案）。
- 技能实现遵循仓库既有生态：`SKILL.md`（frontmatter：name/version/description，对齐 tdd-auto 风格）+ `references/` + `scripts/`；小驼峰命名规范；SKILL.md 编写遵循 skill-creator 技能的规范（用户指定参考）。
- python 转换脚本零第三方依赖（标准库），Windows（Git Bash）环境可跑。
- tdd-import.json 必须过权威 schema：`packages/tools/canvas/src/runtime.ts` 的 `canvasSchemas.importStoryboard`（assets≤200，每项 name+imagePrompt/filePath 二选一；scenes≤500，每项 sortNum/videoPrompt 必填、cast≤64；options 全字段见技术调研报告 §1.2）。
- 大文件阈值由技能定义并写明（实现自决，建议：文本 >64KB 或分镜条目疑似 >200 时切换抽样模式）。
- 预览页零外部资源、file:// 直开（沿用 viewer 模板约定：内嵌 JS 单引号拼接、禁反引号与 `${`、`</` 转义）。
- 模板库存"格式指纹 + python 转换脚本 + 上次 options 选择"，不存用户内容数据。

## Non-Goals

- 不改 tdd CLI 命令集（connectNodes CLI 化、queue watch 等只作为优化建议输出）。
- 不做 web 端 storyboardImportDialog 的任何改动。
- 不执行导入后的生成任务（autoSubmit 后的批量生产、比例校验归 tdd-auto 技能）。
- 不修复 mySeed 供应商比例问题（已在别处处理）。
- 不为视频生成/生图做提示词创作（输入里没有的提示词内容不凭空造，转换只做结构映射）。

## Acceptance Criteria

**组件 B： tdd-import 技能**
- [ ] AC1: 技能落盘 `tdd-prompt/.agents/skills/tdd-import/`（SKILL.md + references/ + scripts/），结构与 tdd-auto/novel-pipeline 范式对齐，description 写清"做什么+何时触发"。
- [ ] AC2: 粘贴大段文本样例跑通全链路：量大小 → 规律识别 → 前 3 样本确认 → 转换 → `tdd canvas import --check` 干跑零错 → viewer 预览打开。
- [ ] AC3: 文件路径样例（json/xlsx/csv 任一）跑通同链路。
- [ ] AC4: 自家产线中间产物样例（novel-storyboard 的 storyboard.json 或 tddExport 产物）跑通同链路。
- [ ] AC5: 目录+图片素材样例跑通（图片经 filePath 相对路径引用，不重复生图）。
- [ ] AC6: 超大输入（> 阈值）时上下文只见抽样片段，不见全文（会话记录可证）。
- [ ] AC7: 模板库双层机制生效：首次入库 → 同格式二次导入指纹命中 → 直接复用历史脚本完成转换。
- [ ] AC8: options 交互每次出现，选项含场景推荐项与历史最近一次；自带自测脚本（selftest）可无外部依赖跑通全部样例。
- [ ] AC8b: 至少一个样例完整走到真实导入（--new-canvas）后的双层复查：导出画布配置 → 脚本核对零缺失（节点/边/cast/ratio/model）→ AI 语义复查报告产出；构造一处已知问题（如少一条 cast 边）能被复查报告捕获。

**组件 A： 优化方案**
- [ ] AC9: `tdd-prompt/docs/` 落盘优化方案文档，覆盖调研报告 5 类阻力（静默失败/命令缺口/语义摸索/Windows 坑/长阻塞轮询）每条现象→根因→建议→优先级。
- [ ] AC10: 建议标注落点（CLI 源码 `packages/cli` / server / tdd-auto 文档 / tdd-import 技能规避）与工作量估；其中"导入不建参考图连线""--size 顶 ratio"等已在 tdd-import 技能内规避的项明确标注。

## Assumptions Exposed & Resolved

| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "各种场景的导入"范围不明 | R1 直接问输入形态 | 4 种形态全适配：粘贴文本/文件/产线产物/图片目录 |
| 模板库位置（3.3"某个目录"留白） | R3 全局 vs 项目内权衡 | 用户主目录全局库，跨项目复用、升级不丢 |
| 模板里存什么才值得（历史命中率存疑） | R5 Contrarian 反向挑战 | 指纹+脚本双层：命中直接执行、失配现场写新入库 |
| options 定值 | R6 Simplifier 探最简（"不写模型"选项） | 每次都问，但带场景推荐+历史最近一次；不采纳"问一次不再问"与"不写模型" |
| 优化是否落码 | R0 拓扑门 | 只出方案，代码落地仅 tdd-import 技能 |
| 技能放置位置 | 未问（仓库惯例已明确） | 源 `tdd-prompt/.agents/skills/tdd-import/` + tdd install 分发（tdd-auto 同款双位置模式） |

## Technical Context

- 调研报告一：`.omc/state/cli-experience-report.md`（会话 CLI 阻力全量证据）。
- 调研报告二：`.omc/state/tdd-import-tech-context.md`（schema 三层定义、viewer 模板复用要点、技能组织范式、预览三选一、web 端同构参考）。
- 关键落点：schema 权威 `packages/tools/canvas/src/runtime.ts`；语义权威 `apps/server/src/utils/canvas/ops.ts`（cast 顺序=参考图传递顺序、filePath 工作区相对路径、幂等 diff）；CLI 校验+示例 `packages/cli/agent-harness/cli_tdd/toonflow/core/canvas.py`；viewer 模板 `tdd-prompt/.agents/skills/novel-pipeline/scripts/pipeline-report.mjs` renderTddViewer（第 276 行起）。
- 技能须内置规避已知坑：`--json`/`--canvas` 全局选项位置、节点类型长名、`--size` 只认档位且会顶 ratio、导入器不建参考图连线（确认门要提醒检查 cast）、Windows curl 内联 JSON 转义。

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| 用户输入 | core domain | 形态（文本/文件/产物/目录）、大小 | 拆解出分隔规律 |
| 分隔规律 | core domain | 资产分隔特征、分镜分隔特征、字段映射 | 由输入识别；等用户确认 |
| 导入模板 | core domain | 格式指纹、python 脚本、上次 options | 存于模板库；命中则复用脚本 |
| 模板索引 | supporting | 指纹→模板映射 | 查找入口 |
| 转换脚本 | core domain | 输入解析、tdd-import.json 产出 | 模板的核心载荷 |
| tdd-import.json | external system | assets/scenes/options | 转换产物；tdd canvas import 的输入 |
| tdd-viewer.html | external system | DATA 内嵌、零依赖 | 预览产物 |
| options 配置 | core domain | imageModel/videoModel/resolution/duration/... | 每次交互定值（推荐+历史） |

## Ontology Convergence

| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 8 | 8 | - | - | N/A |
| 2 | 8 | 0 | 0 | 8 | 100% |
| 5 | 8 | 0 | 0 | 8 | 100%（导入模板实体完成定义） |
| 6 | 8 | 0 | 0 | 8 | 100% —— 已收敛 |

## Interview Transcript
<details>
<summary>Full Q&A（7 rounds）</summary>

### Round 0（拓扑确认）
**Q:** 2 个顶层组件（CLI 体验优化 / tdd-import 技能），拓扑对吗？优化的交付形态？
**A:** 两组件，优化只出方案。
**Ambiguity:** 未评分

### Round 1
**Q:** tdd-import 要适配的用户输入，具体是哪些形态？（多选）
**A:** 粘贴的大段文本、文件路径、自家产线中间产物、目录+图片素材（全选）。
**Ambiguity:** 48%（Goal 0.70 / Constraints 0.40 / Criteria 0.30 / Context 0.70）

### Round 2
**Q:** 用什么标准验收"能用"？
**A:** 4 形态样例全跑通（含自测脚本）。
**Ambiguity:** 35%（Criteria ↑0.75）

### Round 3
**Q:** 导入模板库（模板+索引）放在哪里？
**A:** 用户主目录全局库。
**Ambiguity:** 30%（B）/ 33%（A）

### Round 4（轮转组件 A）
**Q:** 优化方案以什么形态交付？
**A:** 结构化清单落盘 tdd-prompt/docs/（现象→根因→建议→优先级）。
**Ambiguity:** 30%（B）/ 22%（A ↓）

### Round 5（Contrarian）
**Q:** 如果每次输入格式都有细微差别，模板库里存什么才真正值得？
**A:** 指纹+脚本双层。
**Ambiguity:** 24%（B ↓）

### Round 6（Simplifier）
**Q:** options 里的 imageModel/videoModel 怎么定值？
**A:** 选"首次选+模板记忆"但修正为：每次都需要问，选项给出用户场景的推荐项和历史最近一次。
**Ambiguity:** 19.5%（B）/ 18%（A）

### Round 7（用户主动补充流程缺口后细化）
**Q:** 导入后的复查怎么做？（教训：参考图孤立、比例被顶都靠事后人工发现）
**A:** 脚本+AI 双层复查（脚本对照核对结构，AI 读导出配置查语义问题，合并报告不自动修复）。
**Ambiguity:** 17%（B）/ 18%（A）—— 最终达标

</details>
