# 画布操作

所有画布操作共用入参结构 `{ target: {...}, args: {...} }`,参数不符合 schema 时整体拒绝。**每次操作等待返回并核对结果**,再进行下一步。

## getCanvas:唯一真相源

`getCanvas`(args: `{}`)返回当前画布全量状态:

- `id`:画布 id;`canvases`:工作区全部画布列表
- `nodes` / `edges`:节点与连线(节点位置、data.label 等)
- `availableNodeTypes`:[{ type, label }] —— **addNode 的 type 必须来自这里**(注意可能带 `remote-` 前缀,如 `remote-imageGenerationNode`)
- `nodeTools`:各节点注册的函数清单(nodeId、name、description、parameters)
- `workspaceDirectory`:工作目录绝对路径(用于定位生成文件)
- `selectedNodeIds` / `viewport`

**操作前先 getCanvas**:节点 ID、端口、节点函数随时可能因用户编辑而变化,不把旧快照当当前状态。

## 画布级操作

| 操作 | args | 说明 |
| --- | --- | --- |
| `addCanvas` | `{name?}` | 新建画布并切换;name 不含 .json;同名不覆盖 |
| `switchCanvas` | `{canvasId}` | 切换画布(先从 getCanvas 的 canvases 拿 id) |
| `renameCanvas` | `{canvasId?, name}` | 重命名,同时改文件名 |
| `arrangeCanvas` | `{}` | 全部顶层节点按连线自动排列并适应视图 |
| `fitCanvas` | `{nodeIds?}` | 视口聚焦指定节点 |

## 节点与连线操作(均支持批量)

| 操作 | args | 说明 |
| --- | --- | --- |
| `addNode` | `{type, position, label?}` | type 必须来自 availableNodeTypes;返回节点详情与注册的 nodeTools |
| `deleteNodes` | `{nodeIds}` | 连同相连的边删除;先删子节点;任一失败整体不执行 |
| `moveNodes` | `{moves: [{nodeId, position}]}` | position 为画布坐标;自动网格吸附 |
| `renameNodes` | `{renames: [{nodeId, label}]}` | 改显示名 |
| `connectNodes` | `{connections: [{source, sourceHandle, target, targetHandle}]}` | 连线前核对端口方向与数据类型;已存在的连接返回原边 id |
| `deleteEdges` | `{edgeIds}` | 批量删连线 |
| `getGenerationStatuses` | `{nodeIds?}` | 一次查询多个生成类节点状态(省略 nodeIds 查全部);批量生成后统一轮询用 |
| `selectNodes` | `{nodeIds}` | 选择节点(空数组取消选择) |

## 校验规则(任一失败,整批不执行)

- 节点存在性:`节点不存在:<nodeId>`
- 删除保护:`节点不允许删除`、`请先删除此节点的子节点`、`节点存在不可删除的连接`
- 移动保护:`节点不允许移动`
- 连接保护:`节点不允许连接`、`连接无效:...请检查端口方向、数据类型以及目标节点的连接规则`

收到校验错误后:按错误指出的具体节点/连线修正参数,**重新提交整批**。

## 节点函数(nodeTools)

节点注册的业务函数通过 `nodeTools` 调用,args: `{nodeId, name: "node:<函数名>", args: {...}}`:

- 函数清单以 `getCanvas` 或 `addNode` 返回的 `nodeTools` 为准,**不猜测未注册的函数或字段**
- 常见函数(以节点实际注册为准):`node:getConfig`、`node:setConfig`、`node:setPrompt`、`node:generateImage`、`node:getGenerationStatus`、`node:cancelGeneration`
- 新建节点可在同轮立即调用其函数
- 每个函数的 parameters 是 JSON Schema,按 schema 填 args

## 已知上限

- `getCanvas` 返回画布全量 JSON,超大画布下返回体积大;尽量在导入选定画布后减少不必要的全量查询
- 画布操作非事务性:批量导入等复合操作中途失败会保留已完成的部分(可按返回信息继续或清理),详见 importStoryboard.md
