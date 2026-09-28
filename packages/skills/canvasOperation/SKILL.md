---
name: canvasOperation
description: 操作 Toonflow 画布完成 AI 视频制作:分镜导入、节点编排、生成执行、失败排查、结果查验。适用于内置对话 AI 与外部 MCP Agent。
---

# Toonflow 画布操作

通过 Toonflow 的 MCP 工具自如操作画布,完成 AI 视频制作全流程。所有操作通过画布操作工具执行,**不直接修改画布 JSON 文件**。

## 核心工作流

```
getAppState(确认连接与画布)
  → getCanvas(查询节点类型/节点 ID/端口/节点函数)
  → listMediaProviders(查询模型与可选的 duration/resolution,不猜参数)
  → [可选] workspaceFiles 写入资产文件
  → importStoryboard(分镜 JSON 一次导入)
  → 资产图:setPrompt → setConfig → generateImage → 轮询(可多节点并行)
  → 资产图全部 succeeded 后:批量对分镜节点 generateVideo(逐个触发立即返回)→ getGenerationStatuses 一次查询全部状态
  → 失败:读 error + history 排查 → 修正 → 重试
  → 查验视频(outputs 路径抽帧)→ 不满意:setPrompt/setConfig 调整 → 同节点重新 generateVideo(历史版本不丢,可用 selectOutput 回选)
```

## 详细参考(按需阅读)

| 场景 | 文档 |
| --- | --- |
| 连接与状态 | references/connect.md |
| 画布操作 | references/canvasOperations.md |
| 分镜导入 | references/importStoryboard.md |
| 生成与排查 | references/generation.md |
| 结果查验 | references/results.md |
| 风险分级 | references/safety.md |

## 每次操作前

1. `getCanvas` 先行:节点 ID、端口、节点函数随时可能变化,以查询结果为准
2. 批量操作(删节点/连线/移动)合并为一次调用;任一项校验失败则整体不执行,按返回错误修正后重新提交整批
3. 每次操作等待返回并核对结果,再进行下一步
