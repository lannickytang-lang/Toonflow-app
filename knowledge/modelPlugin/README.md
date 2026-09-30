# 自定义模型插件（媒体供应商）知识库导读

面向后续接手的 AI（或人）：快速理解供应商插件从源码到画布消费的全流程、准确编写新插件、安全更改插件开发流程本身。四份文档按目的索引：

| 我想… | 读哪份 |
| --- | --- |
| 理解插件怎么运行：安装/加载/凭证/生成/调试全链路 | [runtime.md](runtime.md) |
| 编写一个新的供应商插件 | [writePlugin.md](writePlugin.md)（含必读陷阱清单） |
| 改插件开发流程本身（技能/CLI/server 调试通道/门禁/发布） | [devWorkflow.md](devWorkflow.md) |
| 排查用户/agent 报告的接入问题 | runtime.md「调试闭环」+ writePlugin.md「陷阱清单」 |

## 30 秒速览

- 插件 = 一个 TypeScript 文件：`export default` 一个 ProviderDefinition 对象，文件名必须等于 `<id>.ts`，≤2MB，装到 `data/providers/` 后在 **vm 中以本地权限运行**（可 require node: 内置与 server 依赖，与宿主同权限——只装可信来源）。
- 类型契约唯一源：`packages/providers/types.d.ts`（ambient 类型；技能内 `references/providerSpec.md` 是其镜像，selfcheck 门禁防漂移的只有技能副本一致性）。
- 用户入口三个，同一后端：Web 端"添加自定义媒体供应商"对话框（含 providerPrompt.ts 提示词，面向无宿主 agent 的用户）；**tdd-dev 技能 + `tdd provider` 命令组**（面向宿主 agent，主入口）；MCP appOperations（内置对话 AI）。
- 测试三级：`inspect` 零费用静态校验 → `dryrun` 零费用干跑（mock fetch 不出网，样例 match/method/times）→ `test` 真实计费（CLI 层 `--yes` 闸门 + 凭证自动回退）。费用红线：真测前必须用户显式同意。
- 分发：官方供应商经 `tudodo-center` manifest providers 段；自定义供应商通常本地开发本地装，不走中心。

## 需求演进史（三轮，理解现状为何长这样）

1. **Web 端时代**：设置页"添加自定义媒体供应商"（文件导入/粘贴代码）+ providerPrompt.ts（把 types.d.ts 内嵌进提示词，引导外部 AI 四阶段访谈式生成 .ts）——服务没有宿主 agent 的网页用户，至今保留不动。
2. **tdd-dev 时代（本期）**：外部开发 agent 成为主要用户 → 新增 `tdd provider` 命令组（1.11.0 起，八+N 条命令）+ `packages/skills/tdd-dev/` 技能（自主推进 + 三停点 + 七环节判定信号）+ server debug 通道 mock 样例支持（dryrun 底层）。agent 从"复制提示词问用户"变成"自主调研→开发→零费用验证→过闸门真测"。
3. **两轮真实 UAT 驱动的修复**：yijiaApi（OpenAI 兼容型，出图跑通）暴露 13 条阻塞点、autodlArt（ComfyUI 工作流型，出视频跑通）暴露 14 条 → 逐批修复（凭证回退、probe、样例 method、参考素材传参、轮询折叠、打码词边界、停点 1 必停确认卡、modelsUrl 边界等）。当前 CLI 1.11.2 / 技能 1.1.1 / selfcheck 146 项。

## 历史与过程记录（按需查阅）

- 需求访谈晶化 spec：`.omc/specs/deep-interview-tdd-dev.md`
- 版本变更明细：`packages/cli/agent-harness/CHANGELOG.md`（1.11.x 段全为本插件体系）
