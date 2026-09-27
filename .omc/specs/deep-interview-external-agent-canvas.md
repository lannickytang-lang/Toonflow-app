# Deep Interview Spec: 开放画布能力——任意 AI Agent 自如制作视频

## Metadata
- Interview ID: external-agent-canvas-20260927
- Rounds: 8(Round 0 拓扑确认 + 7 轮)
- Final Ambiguity Score: 18%
- Type: brownfield
- Generated: 2026-09-27
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 35% | 0.315 |
| Constraint Clarity | 0.78 | 25% | 0.195 |
| Success Criteria | 0.75 | 25% | 0.188 |
| Context Clarity | 0.80 | 15% | 0.120 |
| **Total Clarity** | | | **0.818** |
| **Ambiguity** | | | **18%** |

## Topology

| Component | Status | Description | Coverage |
|-----------|--------|-------------|----------|
| ① 技能/文档分发渠道 | active | 远程仓库 tudodo-center 为唯一分发源;技能双轨(可安装进 Toonflow 全局 + 可被外部 agent 直读) | AC-1、AC-2 |
| ② 画布操作接口 | active | 以现有 MCP 为基座,补齐批量导入原子操作、openApp 唤起;执行保持前端 | AC-3、AC-8、AC-9 |
| ③ 前端事件回显 | active(消解) | 执行架构决策后消解:外部操作经 callControl 转发前端执行,画布刷新是天然副产物;server 侧操作沿用 refreshResources | AC-7 |
| ④ 任务生命周期(节点级) | active | 不加平台任务实体;节点函数增强:状态/错误详情/候选文件绝对路径枚举 | AC-4、AC-5、AC-6 |

无推迟组件。

## Goal

把 Toonflow 的画布能力**系统化、自解释地开放**给任意外部 AI agent:任意 MCP 兼容客户端(以 Claude Code 为代表)从 tudodo-center 分发仓库获取技能与教程(安装或直读),经现有 MCP 通道自如操作画布,覆盖 AI 视频制作全场景——分镜导入、任务规划、生成执行、失败排查、结果查验、调整重执行,直至产出视频。平台侧工作的重心是**能力开放的完整性与文档的自解释性**;总验收为**冷启动全流程测试**:新开一个全新 agent 对话,从拉取资料开始,到导入画布、生成、查验、交付,全程无人工编码介入。

## 六项核心决策(访谈锁定)

1. **执行架构**:沿用"前端执行"(Vue Flow 持有画布真相)。外部 agent 经 MCP `callControl` 转发已连接前端执行,复用全部校验/网格吸附/撤销/自动保存。**不**做 server 端 headless 执行引擎。窗口打开即可;未打开时 agent 收到明确提示,调用 `openApp` 工具由 server 唤起系统默认浏览器打开 Toonflow 后重试。
2. **分发源**:远程 git 仓库 `tudodo-center`(gitee 已建空仓)为唯一分发源;仓库内同时承载"可安装技能包"与"可直读文档"双形态 + 版本清单 manifest。
3. **任务本体**:不新增平台任务实体。任务 = 节点执行;查询 = 节点函数增强(`getGenerationStatus` 扩展:错误详情、尝试历史、候选输出枚举、文件绝对路径)。
4. **结果自查**:平台只返回资产文件的绝对路径;看图、抽帧、质量判断由外部 agent 用自身能力解决。
5. **分镜导入**:把批量导入下沉为平台原子操作(画布操作 + MCP 暴露,入参对齐 storyboardImport 已定的 assets/scenes 标准 JSON);内置 AI(`/skill:storyboardImport`)、导入对话框、外部 agent **三方共用**;单点微调用现有单节点工具。
6. **自动化程度**:风险分级——低风险操作(建节点、连线、触发生成、查询)agent 自主推进;高风险操作(删除节点、覆盖文件、大额生成消耗)前 agent 给出选项让用户决定。

## AI 视频制作场景 → 能力映射

| # | 场景 | 现有能力 | 缺口 | 本方案补齐 |
|---|------|---------|------|-----------|
| 1 | 冷启动接入(全新 agent) | MCP getAppState | 发现引导与教程 | tudodo-center 教程(连接指引、状态认知) |
| 2 | 技能安装与更新 | installSkill(url/base64)、listSkills | 版本清单+比对更新 | manifest + 教程编排更新流程 |
| 3 | 分镜导入建画布 | 逐节点 14 操作 | 原子批量导入 | importStoryboard 原子操作 + MCP 暴露 |
| 4 | 资产准备 | workspaceFiles、素材库 appOperation、mediaGeneration | — | 教程说明用法 |
| 5 | 生成执行 | node:generateImage / generateVideo 等 | — | 教程说明依赖顺序(先资产后视频) |
| 6 | 失败排查 | getGenerationStatus(基础) | 错误详情、尝试历史 | 节点查询增强 |
| 7 | 结果查验 | 输出文件在工作区 | 候选枚举 + 绝对路径返回 | 节点查询增强(返回路径,agent 自查) |
| 8 | 调整重执行 | node:setPrompt/setConfig + generateImage + cancelGeneration | — | 教程说明重试流程 |
| 9 | 画布整理 | arrangeCanvas / fitCanvas | — | 已覆盖 |
| 10 | 窗口未打开 | 报错"页面未连接" | 自动唤起 | openApp MCP 工具 |
| 11 | 多项目/多画布定位 | target.directory / canvasId / getAppState | — | 教程说明 |

## 风险与边界问题(访谈中显式想清楚)

1. **并发冲突**:外部 agent 与用户同时操作同一画布。缓解:前端执行的串行队列已保证操作顺序;教程要求 agent 每次 `getCanvas` 先行,避免基于过期状态操作。
2. **窗口依赖**:agent 操作时窗口被用户关闭 → `callControl` 报"页面未连接",教程编排:捕获后调 `openApp` 唤起,重试一次,仍失败则停下询问用户。
3. **异步生成**:生成是后台任务,`generateImage` 立即返回。教程固化轮询模式(定时 `getGenerationStatus`),避免 agent 死等或遗漏完成事件。
4. **token 效率**:`getCanvas` 全量返回画布 JSON,大画布下 token 压力大(已知上限,`ACT:` 注释标注,后续可做字段裁剪);批量导入把几十次调用压缩为一次,是主要节省点。
5. **节点类型差异**:不同节点注册的 nodeTools 不同,且随节点增删变化。教程固化"以 getCanvas 返回为准",不假设函数存在。
6. **幂等恢复**:agent 会话中断后重开,教程第一步永远是 `getAppState` + `getCanvas` 对齐真实状态,不依赖记忆。
7. **安全边界**:MCP 凭证(Bearer)已有;工作区路径校验已有;导入 JSON 由 agent 产出但经画布层 Zod 校验,非法数据整体拒绝;批量导入执行沿用前端画布校验,不新开信任边界。
8. **大文件**:MCP `readBinary` 20MB 上限不影响"路径返回"模式(大视频由 agent 本地读路径,不受此限);生成文件始终落在工作区内。

## Acceptance Criteria(冷启动全流程金路径)

- [ ] AC-1 全新 agent 会话(零 Toonflow 知识)按 tudodo-center 文档完成:发现连接地址、配置 MCP、调用 getAppState 获取连接与画布状态
- [ ] AC-2 agent 完成技能获取:经 installSkill 安装(或 clone 直读),获得画布操作教程;有新版本时可按 manifest 比对更新
- [ ] AC-3 agent 用批量导入原子操作把标准 JSON(assets/scenes)导入画布:节点、连线、排列一次成形;微调时用单节点工具
- [ ] AC-4 agent 自主规划执行顺序(先资产图、后视频,遵循连线依赖),逐节点触发生成并轮询状态
- [ ] AC-5 生成失败:agent 查回错误详情,调整提示词/参数后重试直至成功
- [ ] AC-6 生成成功:agent 枚举候选资产(绝对路径),自行取回查看并判断是否满足;不满足时调整重生成
- [ ] AC-7 全程打开的 Toonflow 界面实时回显 agent 的所有画布操作
- [ ] AC-8 窗口未打开时:agent 收到明确提示,调用 openApp 唤起默认浏览器后继续完成全流程
- [ ] AC-9 内置 AI(/skill:storyboardImport)与外部 agent 共用同一批量导入底层操作(代码级复用,非两套实现)

## Non-Goals

- 不做 server 端 headless 画布执行引擎(执行保持在前端)
- 不做平台任务实体、任务队列或任务管理界面
- 不做平台侧视频抽帧/视觉审查工具
- 不重做 storyboardImport(仅把其导入执行下沉为共用原子操作,其对话框/技能/模板系统不动)
- 不做模板市场、模板版本历史(沿用 storyboardImport spec 的 non-goals)
- 不改 MCP 认证方式与端口管理机制

## Assumptions Exposed & Resolved

| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| 需要 server 端 headless 执行 | Round 1:执行方放哪一端? | 不需要;前端执行 + 窗口打开可接受 + 自动唤起 |
| "任务"是平台实体 | Round 3:任务指什么? | 不是;节点级增强,查询走节点函数 |
| 技能必须安装进 Toonflow | Round 4 Contrarian | 双轨:安装 + 直读 |
| 需要 AI 视觉审查工具链 | Round 6 Simplifier | 不需要;返回绝对路径,agent 自理 |
| 分镜导入要逐节点调用 | Round 7 | 下沉为共用原子批量操作 |
| 自动化程度越高越好 | Round 5 | 风险分级,关键决策点给选项让用户决定 |

## Technical Context(现状盘点,两轮代码调研)

**画布操作链路**:前端 Vue Flow 持有画布真相;14 个画布操作(packages/tools/canvas)经 server 桥接(apps/server/src/agent/bridge/canvas.ts)以 canvasCall 事件 RPC 回前端执行(apps/web/src/pages/workspace/panels/canvas/useCanvasTools.ts),结果回传后 flushSave 落盘;节点函数(packages/nodeScaffold nodeTools)在浏览器节点组件实例内执行;生成算力在 server(generateMedia)。

**现有 MCP**(packages/mcp + apps/server/src/utils/mcp):`http://127.0.0.1:10588/mcp`,Bearer 凭证,Streamable HTTP + stdio。工具:getAppState、UI 工具(openProject/switchPanel/getDocument/writeDocument/getSettings/updateSettings)、画布 14 操作 + nodeTools(经 callControl 转发已连接前端)、workspaceFiles、listAppOperations/appOperation(节点/工具/技能安装卸载、媒体供应商、素材库、Agent 会话)、runAgent。

**缺口清单**(本方案要补):① importStoryboard 原子画布操作 + MCP 暴露;② 节点查询增强(getGenerationStatus:错误详情/尝试历史/候选枚举/绝对路径);③ openApp MCP 工具;④ tudodo-center 仓库结构(技能包 + 直读文档 + manifest);⑤ 外部 agent 画布操作教程(连接、状态查询、操作顺序、错误处理、风险分级决策点);⑥ installSkill 版本比对更新编排。

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| ExternalAgent | core domain | client 类型、会话 | 经 McpServer 操作画布;读 tudodoCenter 学习 |
| McpServer | supporting | 连接地址、凭证、工具集 | 转发画布操作至前端 |
| tudodoCenter | core domain | 技能包、直读文档、manifest | ExternalAgent 的知识源;安装至全局技能 |
| CanvasSkill | core domain | SKILL.md、参考文档 | 分发于 tudodoCenter;被内置 AI 与外部 agent 共用 |
| CanvasOperation | core domain | 14 操作、参数 schema | McpServer 暴露;前端执行 |
| NodeGeneration | core domain | 状态、错误详情、尝试历史 | 节点函数暴露;查询增强对象 |
| NodeResult | core domain | 候选文件、绝对路径 | NodeGeneration 的产出;ExternalAgent 自查 |
| AutoOpenBrowser | supporting | openApp 工具 | 窗口未连时的恢复通道 |

Ontology Convergence:R1 起 8 实体,R2 DistributionChannel→tudodoCenter 改名后连续 6 轮 100% 稳定。

## Interview Transcript
<details>
<summary>Q&A(Round 0 + 7 轮)</summary>

### Round 0(拓扑确认)
**Q:** 4 组件拓扑(技能分发/画布操作接口/前端事件回显/任务生命周期)是否正确?
**A:** 正确,按此推进。

### Round 1
**Q:** 外部 AI 操作画布时窗口是否必须打开?执行方放哪一端?
**A:** 沿用 MCP 即可;打开前端没关系,未打开可用默认浏览器自己打开。

### Round 2
**Q:** "一键全局安装、更新"的分发源与安装动作?
**A:** 远程仓库(已建 gitee 空仓 tudodo-center);agent 经 MCP installSkill 自装,比对版本更新。

### Round 3
**Q:** "任务"指什么?查询接口建在哪一层?
**A:** 节点级增强:不加平台任务实体,扩展 getGenerationStatus(错误详情/历史/候选),逐节点查询。

### Round 4(Contrarian)
**Q:** 技能必须"安装"进 Toonflow 吗(首轮表述未听懂,通俗复述后确认)?
**A:** A+B 都支持:装进 Toonflow 与直读远程仓库并存。

### Round 5
**Q:** 验收金路径?自动化程度?
**A:** 给出选项,让用户决定(风险分级,关键决策点人定)。

### Round 6(Simplifier)
**Q:** AI 自查生成结果的最简方式?
**A:** 返回图片/视频等资产的绝对路径,交给对方 agent 自行决定。

### Round 7
**Q:** 分镜导入形态?
**A:** 大概率批量导入;并追问 /skill:storyboardImport 是否已支持批量(澄清:其批量=内置 AI 循环调单节点工具;决定下沉为共用原子操作)。补充纠偏:本次主线=开放画布能力,满足 AI 视频制作各种场景;验收=新开对话从拉取资料到导入、生成全流程。
</details>
