# 风险分级:何时必须让用户决定

外部 Agent 以低风险自主推进 + 高风险用户确认为原则。**关键决策点给出选项,让用户决定后继续**。

## 低风险:自主推进,不必打断用户

- 全部查询类操作:getAppState、getCanvas、node:getConfig、node:getGenerationStatus、workspaceFiles list/readBinary
- 创建类:addNode、connectNodes、moveNodes、renameNodes、importStoryboard、addCanvas
- 触发生成(使用用户已配置的模型)
- arrangeCanvas、fitCanvas、selectNodes

## 高风险:先给选项让用户决定

| 操作 | 风险 | 建议询问方式 |
| --- | --- | --- |
| `deleteNodes` / `deleteEdges` | 不可逆(虽有撤销) | "将删除节点 A、B(含 N 条连线),是否继续?" |
| `renameCanvas` / 删除画布文件 | 影响文件名与引用 | "将把画布 X 改名为 Y,是否继续?" |
| `workspaceFiles` writeBinary 覆盖、remove | 覆盖/删除用户文件 | "将覆盖/删除 <路径>,是否继续?" |
| 安装/卸载节点、工具、技能(installSkill/uninstall 等 appOperation) | 改变环境 | 列出来源与影响,经确认后执行 |
| 大额生成(真实付费模型、批量多节点) | 消耗费用 | 预估节点数与模型,经确认后执行;测试用 mock 模型不必询问 |

询问时**给出具体选项**(如"A/B/C"或"继续/取消"),不要开放式提问。用户选择后按选择执行;用户不在线时跳过高风险步骤并在总结中说明。

## 其他边界

- **不直接修改画布 JSON 文件**:画布正在 Toonflow 中打开;画布/文档文件只能通过画布与文档工具修改(`workspaceFiles` 对打开中的文件会直接拒绝)
- **不猜测**:节点函数、端口、参数枚举一律先查询(getCanvas/getConfig);参数错误会得到明确报错,照错误信息修正
- **脚本与模板**:`importStoryboard` 的入参是你产出的 JSON,经画布层校验,非法数据整体拒绝——不会损坏画布
- **多页面/多项目**:多连接时必须用 `target.connectionId` 明确目标;操作前重新 `getAppState` 确认工作区未切换
