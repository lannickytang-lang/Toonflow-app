# Deep Interview Spec: 分镜脚本导入(Storyboard Import)

## Metadata
- Interview ID: storyboard-import-20260927
- Rounds: 5(Round 0 拓扑确认 + 5 轮)
- Final Ambiguity Score: 18%
- Type: brownfield
- Generated: 2026-09-27
- Threshold: 0.2
- Threshold Source: default
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.88 | 35% | 0.308 |
| Constraint Clarity | 0.80 | 25% | 0.200 |
| Success Criteria | 0.72 | 25% | 0.180 |
| Context Clarity | 0.85 | 15% | 0.128 |
| **Total Clarity** | | | **0.816** |
| **Ambiguity** | | | **18%** |

## Topology

| Component | Status | Description | Coverage |
|-----------|--------|-------------|----------|
| ① `/命令` 技能 | active | SKILL.md 指令文件,编排 AI:读原文→找规律→前 3 条确认→生成解析脚本并存模板→指引使用导入组件 | AC-1~3 |
| ② 解析脚本与模板系统 | active | AI 按规律生成的可执行 JS 解析脚本;存全局模板库,组件内执行;改名在组件做,改脚本走 AI 对话 | AC-3~5 |
| ③ 工具栏导入入口 + 导入对话框 | active | 画布左下角工具栏新增导入图标,弹框含双 tab 表格(资产/分镜)、手动调整、选模板、解析、确认 | AC-4~6 |
| ④ 导入执行 | active | 确认后按 JSON 生成画布节点(资产图节点/图片生成节点 + 视频生成节点)并连线、排列;自动生图可选 | AC-6~8 |

无推迟组件。

## Goal

为 Toonflow 新增"分镜脚本批量导入"能力:用户以 `/命令` 或画布工具栏入口发起,AI 理解任意格式的分镜脚本并提炼规律(资产生图指令、视频指令、出镜关系),先展示前 3 条解析结果向用户确认;确认后 AI 生成一段**可复用的 JS 解析脚本**存为**全局模板**;导入对话框(画布工具栏入口)加载模板脚本 + 分镜原文,**在组件内执行**得出标准 JSON,以双 tab 表格回供用户手动调整;确认后一键生成画布节点结构与连线。全部能力以平台外部化通道(技能文件、`.tool.js` 工具、新增 server 路由、自增前端组件)实现,与上游核心代码几乎零冲突。

## 标准 JSON 契约(用户定义,字段名实现时定英文标识)

```
资产集合 assets[]:  { name, imagePrompt(生图指令), filePath?(已有参考图), videoPath?(已有参考音频) }
分镜集合 scenes[]:  { sortNum(序号), videoPrompt(视频指令), cast[](出镜资产 name 列表) }
```

## Constraints(解耦纪律,最高优先级)

1. **不修改** `packages/nodes/*`、`packages/tools/*`(上游插件)源码
2. `apps/web/src` 仅允许**一处行级挂载点**:画布工具栏(`canvasControls` 所在文件)插入一个按钮 + 引入自增对话框组件;其余全部为**自增新文件**
3. `apps/server/src/routes/` 仅**新增**子目录与文件(自动扫描注册,不改既有文件);`src/router.ts` 为生成器产物,跑 `bun run routes` 再生成
4. 新增能力全部走外部化通道:全局技能(`data/skills/`)、工具插件(`data/tools/`)、新增路由 + `data/` 存储
5. 上游合并策略:合并冲突预期仅出现在工具栏挂载点一行;其余文件为纯新增,零冲突

## Non-Goals

- 不做视频自动生成(视频一律手动/AI 触发;资产图生成由用户在对话框勾选,默认不生成)
- 不做组件内模板脚本编辑器(改脚本走 AI 对话,由 AI 通过模板工具写回)
- 不做模板市场、导入导出、模板版本历史(后续迭代)
- 解析脚本不做沙箱隔离(本地可信环境,代码中 `ACT:` 注释标注信任边界)
- 不改动现有 `/skill:canvas`、`/skill:workflow` 及任何已安装节点

## Acceptance Criteria

- [ ] AC-1 放置技能文件后,对话面板技能菜单出现新 `/命令`,无需改前端代码
- [ ] AC-2 `/命令` 支持:消息正文直接粘贴原文,或给出工作区文件路径让 AI 读文件(两者兼容)
- [ ] AC-3 AI 先输出**前 3 条**的规律解读(每条:出镜资产、生图指令、视频指令)并停下询问用户确认;用户否定时按反馈修正规律再确认
- [ ] AC-4 确认后 AI 生成解析脚本并调用模板工具存为全局模板(可命名);模板含脚本代码 + 规律说明元数据
- [ ] AC-5 画布工具栏出现导入图标,点击弹出导入对话框:双 tab 表格(资产表 / 分镜表)
- [ ] AC-6 对话框内:可选历史模板 → 粘贴原文或选工作区文件 → 执行脚本 → 表格回显 → 单元格可编辑(增删行、改字段)→ 可勾选"导入后自动生成缺失资产图"
- [ ] AC-7 对话框内可对模板改名;模板脚本修改由 AI 在对话中完成并写回模板库
- [ ] AC-8 确认导入后画布出现:有 `filePath` 的资产 → 图片节点直接引用;无 `filePath` 的资产 → 图片生成节点(prompt=imagePrompt),勾选自动生成则导入后立即开始生成;每个分镜 → 视频生成节点(prompt=videoPrompt);出镜资产连线到对应视频节点;自动排列;模型参数默认 grsai minimax-h3(可调)
- [ ] AC-9 端到端验收数据:用户提供一份真实分镜脚本跑通全流程(验收前补充)

## 技术方案(基于代码探索的设计)

**探索结论**(依据:`apps/server/src/agent/skills/index.ts`、`packages/nodeScaffold/readme.md`、`packages/toolScaffold/readme.md`、`apps/web/src/components/agent/skillMenu.vue`):
- 技能列表动态加载,新增 `/命令` = 放置 SKILL.md(name/description frontmatter),零前端改动
- `.tool.js` 工具运行在 server 进程、非沙箱,可用 node:fs 写全局 `data/` 目录
- server 路由按 `routes/**/*.ts` 自动扫描,新增子目录零冲突

| 组件 | 落地方式 | 新增文件(全部自增) |
| --- | --- | --- |
| ① `/命令` | 全局技能 | `data/skills/storyboardImport/SKILL.md`(开发期源文件放仓库,经安装接口或直接放置) |
| ② 模板系统 | server 新路由 + 全局存储 | `apps/server/src/routes/storyboardTemplates/{list,get,save,rename,delete}.ts`;存储 `data/storyboardTemplates/<name>/{script.js,meta.json}` |
| ② AI 模板管理 | 工具插件 | `packages-ext/storyboardTemplateTool/`(或直接安装)`*.tool.js`:list/save/rename/delete,供 AI 对话调用 |
| ③ 导入对话框 | 前端自增组件 | `apps/web/src/pages/workspace/panels/canvas/storyboardImport/`(对话框 + 资产表 + 分景表 + 模板选择);上游仅 `canvasControls` 一行挂载 |
| ③ 脚本执行 | 浏览器内执行 | `new Function` 封装解析脚本,输入 `{ raw(原文) }`,输出标准 JSON;异常以行内错误提示呈现 |
| ④ 导入执行 | 复用 AI 画布工具链 | 对话框确认 → 自动向对话面板发送预填导入指令(附 JSON)→ AI 按 `canvas` 工具(getCanvas→addNode→setImage/setPrompt/setConfig→connectNodes→arrangeCanvas)建图;技能中固化该流程规范 |

**AI → 组件的数据流**:模板生成/修改由 AI 经模板工具直接落库;导入对话框是自主入口(选模板 + 原文 → 解析 → 确认),不依赖对话中转。确认导入通过自动发送的编排消息交给 AI 执行(复用平台画布校验,零新增画布前端逻辑)。

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| StoryboardImportSkill | core domain | name, workflow 指令 | 编排 ParseScript/ImportDialog/ImportExecution |
| ParseTemplate | core domain | name, script(JS), meta(规律说明) | 属全局模板库;被 ImportDialog 执行 |
| StoryboardData | core domain | assets[], scenes[] | ParseTemplate 的输出;ImportExecution 的输入 |
| ImportDialog | supporting | 双 tab,模板选择,编辑,确认 | 挂载于画布工具栏 |
| ImportOptions | supporting | autoGenerateImages(默认 false) | ImportDialog 的确认参数 |
| ImportExecution | core domain | 节点创建+连线+排列 | 消费 StoryboardData,产出画布节点 |
| TemplateStore | supporting | 全局 data/storyboardTemplates/ | 存放 ParseTemplate |

Ontology Convergence:R1 起 7 实体,R2 新增 ImportOptions 后连续 4 轮 100% 稳定。

## Interview Transcript
<details>
<summary>Q&A(5 轮)</summary>

### Round 0(拓扑确认)
**Q:** 4 组件拓扑(命令技能/解析脚本与模板/画布导入组件/导入执行)符合意图吗?
**A:** 需要调整——导入组件不做画布节点,改为画布左下角工具栏图标 + 弹框(已按此锁定,组件③形态变更)。

### Round 1
**Q:** AI 生成的解析脚本后续怎么被使用?
**A:** 组件内执行脚本(浏览器加载脚本+原文直接跑出 JSON,不耗 AI 额度;换格式让 AI 重写新模板)。

### Round 2
**Q:** 确认导入后画布上出现什么?无 filePath 资产的 imagePrompt 怎么落地?要不要自动生成?
**A:** 可选是否生成,让用户选择(对话框勾选;有 filePath 引用,无 filePath 建图片生成节点)。

### Round 3
**Q:** 分镜脚本原文以什么形式存在?AI 从哪拿到?
**A:** 两者兼容(工作区文件路径读文件,或消息正文直接粘贴)。

### Round 4(Contrarian)
**Q:** 挑战假设:模板需要全局共享吗?
**A:** 全局共享(多种固定格式分镜来源,跨项目复用)。

### Round 5(Simplifier)
**Q:** 模板脚本"修改"的交互形态?
**A:** AI 对话改脚本(组件内只做选模板+改名,不做 UI 编辑器)。
</details>
