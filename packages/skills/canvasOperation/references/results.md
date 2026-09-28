# 结果查验

生成完成后,AI 需要判断结果是否满足要求。平台只负责**告诉你文件在哪**,查看与质量判断由你自行完成(读图、抽帧等用自己的能力)。

## 定位生成文件

`node:getGenerationStatus` 返回:

- `outputs`:当前输出,`value.url` 为**工作区相对路径**(如 `assets/<nodeId>/image918f630d.png`)
- `workspaceDirectory`:工作目录绝对路径

**绝对路径 = workspaceDirectory + 相对路径**。相对路径统一使用 `/` 分隔。

## 取回与查看

| 方式 | 适用 | 说明 |
| --- | --- | --- |
| agent 本地读路径 | 本机 agent(推荐) | 直接用绝对路径读文件,无大小限制 |
| MCP `workspaceFiles`(action=readBinary) | 远程 agent | base64 返回,单文件 ≤ 20MB |

## 枚举与挑选候选

`outputs` 记录的是节点**当前输出**(单文件)。候选的登记与挑选:

1. **看历史**:`getGenerationStatus` 的 `history` 每条带该轮全部产出 `files`(多轮累积、单次多产出都在内),以及当时的提示词、模型、参考文件
2. **取回查看**:对每个 file 按「绝对路径 = workspaceDirectory + url」取回(本机 agent 直接读;远程用 `workspaceFiles` action=readBinary,≤ 20MB)
3. **选定启用**:`nodeTools`(name=`node:selectOutput`,args=`{url}`)把选定文件设为**当前输出**,下游连线立即引用;用户也可在节点 UI 点「生成历史」图标在弹框中点选
4. 超出历史保留条数(50)的老产出:文件仍在 `assets/<nodeId>/` 目录,用 `workspaceFiles`(action=list)枚举后同样可 `selectOutput`(限定该目录内文件)

## 判断与调整

1. 取回图片(直接读)或视频(抽帧)查看内容
2. 与任务要求比对:构图、主体、风格是否满足
3. 不满足 → `node:setPrompt` 调整提示词(必要时 `node:setConfig` 换模型/参数)→ 重新生成 → 再次查验
4. 满意 → 继续下一个任务节点

多候选场景(一次生成多个文件或多次生成多版):列全目录文件、逐一查看、择优保留;需要清理时用 `workspaceFiles`(action=remove)并遵循 safety.md 的确认规则。
