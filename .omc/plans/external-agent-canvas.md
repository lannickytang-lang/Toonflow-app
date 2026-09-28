# 实施计划:开放画布能力——任意 AI Agent 自如制作视频

依据:.omc/specs/deep-interview-external-agent-canvas.md(歧义 18%,PASSED)
日期:2026-09-27 | 状态:已实施(2026-09-28 完成 B1/B2/B3/A/C,冷启动验收通过)

## 已确认的机制事实(调研结论,计划的立足点)

1. **新画布操作 = 自动获得 MCP 暴露**:`apps/server/src/utils/mcp/tools.ts:117-138` 把 `createAgentTools` 产出的全部工具 wrapTool 进 MCP;画布操作定义于 `packages/tools/canvas/src/runtime.ts` 的 `canvasOperations`。
2. **MCP → 前端执行链路零接线**:前端 `apps/web/src/lib/mcpControl.ts:139-144` 的 `execute()` 把画布类命令交给 `workspaceControl.call` → `CanvasContext.call` → `apps/web/src/pages/workspace/panels/canvas/useCanvasTools.ts` 的 `execute()`。新增操作只需改 canvas 定义与 useCanvasTools 两处。
3. **展开逻辑已存在**:`apps/web/src/pages/workspace/panels/canvas/components/storyboardImportDialog.vue:461` 的 `runImport()` 已实现"标准 JSON(assets/scenes)→ 节点+连线+排列"的完整展开(经 `callCanvas` 循环调用),下沉为原子操作即可。
4. **`getGenerationStatus` 由 `packages/nodeScaffold/src/useNodeGeneration.ts` 统一注册**,返回 `{ status, outputs, error? }`;三个生成节点(imageGeneration/videoGeneration/audio)共用,增强一次全部生效。
5. **appOrigin 可用**:`apps/server/src/utils/mcp/operations.ts` 已使用 `getMcpRuntime().appOrigin`,openApp 的打开地址来源现成。

## 阶段与文件级改动

### B1:importStoryboard 原子画布操作(最大件,先做)

| 文件 | 改动 |
| --- | --- |
| `packages/tools/canvas/src/runtime.ts` | `canvasSchemas` 新增 `importStoryboard`:`strictObject({ assets: array(strictObject({ name, imagePrompt?, filePath?, videoPath? })).max(200), scenes: array(strictObject({ sortNum, videoPrompt, cast: array(string) })).max(500), options: strictObject({ autoGenerateImages: boolean().optional(), videoModel: strictObject({ providerId, modelId, duration?, resolution? }).optional() }).optional() })`(对齐 storyboardImport 标准 JSON 契约);`canvasOperations` 新增操作项,label"批量导入分镜",description 写明契约、行为(有 filePath→图片节点引用;否则→图片生成节点;分镜→视频生成节点;cast 连线;自动排列)与返回结构 |
| `apps/web/src/pages/workspace/panels/canvas/useCanvasTools.ts` | `execute()` 新增 `case "importStoryboard"`:移植 `runImport` 展开逻辑(findType 支持 `remote-` 前缀;资产节点→分镜节点→连线→`arrangeCanvas` 收尾);内部**递归调用本文件 `execute()`** 复用 addNode/nodeTools/connectNodes 的既有校验;整体纳入自动保存 flush;返回 `{ assetNodeIds, sceneNodeIds, edgeIds, arrangedNodeIds }`。历史批次接入:通过现有 `provide("batchCanvasHistory")` 机制包裹(canvas/index.vue 已 provide,注入方式实现期确认) |
| `apps/web/src/pages/workspace/panels/canvas/components/storyboardImportDialog.vue` | `runImport` 改为单次 `callCanvas("importStoryboard", { assets, scenes, options })`,删除本地展开循环(约 -100 行);对话框 UI 与模板逻辑不动 |

- MCP 暴露:零改动(机制事实 1)。
- 验证:`bun run typecheck`(web、server 分别);启动后经 MCP 调 `importStoryboard` 建测试画布核对节点/连线/排列;导入对话框"确认导入"回归;`/skill:storyboardImport` 流程回归(共用同一操作)。
- 协同风险:`storyboardImportDialog.vue` 为在途开发文件,动手前与在途改动对齐,避免冲突。

### B2:节点查询增强(失败排查 + 结果路径)

| 文件 | 改动 |
| --- | --- |
| `packages/nodeScaffold/src/useNodeGeneration.ts` | `run()` 记录尝试历史 `{ startedAt, finishedAt, status, error? }`(ref,保留最近 10 次);`getGenerationStatus` 返回增加 `history`;description 更新(说明含历史与输出文件路径) |
| `apps/server/src/utils/mcp/tools.ts` | MCP 画布调用结果包装处:为画布操作结果附加 `workspaceDirectory`(target 解析出的绝对路径)。外部 agent 以"目录 + 节点返回的相对路径"定位文件,查看用自身能力(readBinary/本地读),不新增平台读图工具 |
| `packages/nodes/*` | 零改动(useNodeGeneration 统一生效);实现期确认 `NodeOutput`(`packages/nodeScaffold/src/values.ts`)路径字段为工作区相对路径 |

- 验证:MCP 触发生成 → `getGenerationStatus` 返回 history 与路径;人为制造失败(错误模型名)→ 能查回错误详情与历史 → 修正重试成功。

### B3:openApp 唤起浏览器

| 文件 | 改动 |
| --- | --- |
| `apps/server/src/utils/mcp/tools.ts` | 新增 MCP 工具 `openApp`(无参数):URL = `getMcpRuntime().appOrigin + "/#/workspace"`;按平台子进程唤起(win32 `cmd /c start "" <url>`、darwin `open <url>`、linux `xdg-open <url>`,Bun.spawn);返回 `{ url, opened }`。同时把"画布调用无前端连接"的报错文案追加"可调用 openApp 打开页面后重试" |
| 前端 | 零改动(`mcpControl.ts` 已有断线 3 秒自动重连) |

- 验证:关闭页面 → MCP 画布调用得到含 openApp 引导的错误 → 调 `openApp` → 默认浏览器打开 → 重试成功。

### A:tudodo-center 分发仓库与教程(在 B 完成后撰写,内容以实测行为为准)

```text
tudodo-center/
  manifest.json                     # { version, updatedAt, skills: [{ name, version }] }
  AGENTS.md                         # 直读总纲:Toonflow 是什么、能力地图、连接三步、边界
  skills/canvasOperation/
    SKILL.md                        # 可安装技能包(frontmatter + 流程总览)
    references/connect.md           # MCP 连接、getAppState、target 语义、openApp
    references/canvasOperations.md  # 画布操作详解、getCanvas 先行原则、常见校验错误
    references/importStoryboard.md  # 标准 JSON 契约、资产文件先传工作区(workspaceFiles)、导入流程
    references/generation.md        # 生成依赖顺序(先资产后视频)、轮询模式、cancel、错误排查(history)
    references/results.md           # 候选枚举、workspaceDirectory+相对路径拼绝对路径、自查建议
    references/safety.md            # 风险分级:删除/覆盖/大额生成前应询问用户
```

- 平台零改动:installSkill(url 安装)、listSkills、readSkillFile 已存在。
- 更新:agent 比对 `manifest.json` 的 version 决定是否重装。

### C:冷启动验收(收尾)

按 spec AC-1~9 执行:新开一个全新 agent 会话 → 连接 → 安装/更新技能 → 导入一份真实分镜 → 规划生成 → 人为失败一次并排查重试 → 查回结果判断 → 界面回显观察 → 关窗后 openApp 恢复。产出问题清单回填教程(references/*)。

## 执行顺序与预估

B1(约半天)→ B2(约半天)→ B3(约半天;与 B2 同文件 tools.ts,顺序做避免冲突)→ A(约一天,文档为主)→ C(约半天 + 修复)。
每阶段独立可验证;B 包完成后 MCP 能力即完整,A 只是知识层,C 是总验收。

## 明确不做(对齐 spec Non-Goals)

server 端 headless 执行引擎、平台任务实体、平台侧视觉审查工具、重做 storyboardImport、MCP 认证机制改动。
