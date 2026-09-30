---
name: tdd-dev
version: 1.1.0
description: 用 tdd 命令为 Toonflow 开发/接入自定义媒体供应商（自定义模型）等画布扩展：调研、代码生成、校验、离线干跑、导入、凭证配置、真实测试。用户以 /tdd-dev 调用，或要求接入自定义模型/新模型源/供应商开发时使用。面向开发定制场景；批量生产视频用 tdd-auto。
---

# tdd-dev：Toonflow 扩展开发（当前支持：自定义媒体供应商）

本技能（tdd-dev）是你的工作地图：技能名指本技能，实际 CLI 命令一律是 `tdd`。**自主推进全流程**（详见下文"自主推进原则"），全程只用 tdd CLI，不要直接调 HTTP 接口。

## 费用红线（最高优先级，先于一切流程）

真实调用上游接口会产生实际费用。执行 `tdd provider test --yes` 前必须**全部满足**：

1. 接入方案已经用户确认（见停点 1）；2. 凭证已配置；3. 已向用户说明将调用的供应商/模型与费用风险；4. 用户明确同意。

零费用操作可自由执行：`inspect`（静态校验）、`dryrun`（请求不出网）、`list`、`probe`（只读拉模型列表）。**绝不为排查代码错误而发起真测**——排错一律用 dryrun。

## 按意图路由

| 用户意图 | 起手动作 | 需要深度时读 |
| --- | --- | --- |
| **接入自定义模型**（提到某供应商/新模型源，能给资料或链接） | 自主调研 → 输出接入方案等用户确认（停点 1）→ 读 [providerSpec.md](references/providerSpec.md) 照骨架生成 .ts → `inspect` 循环到通过 | [workflow.md](references/workflow.md) |
| **已有供应商 .ts 文件** | `tdd provider inspect <文件>` → dryrun → import → config | [workflow.md](references/workflow.md) 第 3 环节起 |
| **装好了不知下一步** | `tdd provider list`（看凭证状态）→ 缺凭证走 config | [workflow.md](references/workflow.md) |
| **生成/真测失败排查** | 先 `tdd provider dryrun <文件> --samples …` 复现（零费用）；确需真测再现才过闸门 | [errors.md](references/errors.md) |
| **检查密钥能用哪些模型** | `tdd provider probe --url <模型列表地址> --config apiKey=<key>`（零费用只读） | — |
| **换 key / 配凭证** | `tdd provider config <id> --set apiKey=<值>` | — |
| **拿不准流程环节** | 读 [workflow.md](references/workflow.md) 七环节总览 | — |

## 自主推进原则（本技能的核心工作方式）

**你自己完成全流程**：调研接口文档、写代码、校验、干跑、导入、配置，都不要等用户指示下一步。只在三个停点找用户，且停点必须**给出方案与推荐**而不是抛问题：

| 停点 | 触发条件 | 你要做什么 |
| --- | --- | --- |
| 1 方案确认（**必停**） | 调研完成，动工写代码之前 | 输出接入方案确认卡（见下方模板），等用户确认 |
| 2 缺密钥 | 用户没给 apiKey 等凭证 | 告知用户去哪里获取（调研阶段查到的控制台/注册地址），等用户提供 |
| 3 真测授权 | 前六环节全绿，只差真实验证 | 按"费用红线"四条件向用户申请 |

**接入方案确认卡模板**（停点 1 输出）：
- 接入模型清单：表格（模型 id / 类型 / 能力来源），**按用户需求与密钥实际权限圈定，不强求图片视频全有**——纯生图供应商只注册 image 模型是正常形态；
- 方案要点：端点、鉴权方式、同步/异步协议、样例响应来源；
- 注意事项：预计费用、限流、文档疑点（响应示例与实际可能不符，真测才可最终验证）、密钥权限范围（用 `probe` 预检过就写结论）；
- 你的推荐与理由（如多种鉴权/协议可能时）。

调研优先级：用户给的文档链接 > 供应商官网/开放平台文档 > 通用协议推断。**用户给的资料不全时**：apifox 站点可请求 `llms.txt` 拿全量文档目录（偶发 500 重试即可）；同站常有关联接口（如"创建视频"与"查询进度"分页面）。调研结论写入确认卡。

## 七环节流程（判定信号不亮不进下一环节）

| 环节 | 动作 | 判定信号 |
| --- | --- | --- |
| 1 调研 | 弄清端点/鉴权/模型清单/轮询协议；`probe` 预检密钥权限（能拿到模型列表地址时） | 能写出"请求→响应"样例 → **停点 1 确认卡** |
| 2 开发 | 照 [providerSpec.md](references/providerSpec.md) 骨架填空 | 文件保存为 `<id>.ts` |
| 3 校验 | `tdd provider inspect <文件>` 循环修 | 退出码 0 |
| 4 干跑 | `tdd provider dryrun <文件> --model <m> --samples 样例.json` | 输出"成功: N 个媒体"，且请求日志与上游文档一致 |
| 5 导入 | `tdd provider import <文件>`（409=已装，见 errors.md；**delete 重装会清凭证，需重新 config**） | 退出码 0 |
| 6 配置 | `tdd provider config <id> --set apiKey=…` → 连通性验证（方式按 modelsUrl 适用性，见 workflow） | 连通验证通过 |
| 7 真测 | 过闸门（费用红线四条件）→ `tdd provider test <文件> --model <m> --yes` | 返回 result；随后向用户汇报 |

样例文件（环节 4 用）：JSON 数组 `[{"match": "api.example.com", "method": "POST", "status": 200, "body": {…}}]`；`method` 区分同路径不同动词（POST 创建 vs GET 轮询）；轮询序列写多条样例按序消耗。详见 [workflow.md](references/workflow.md)。

## 环境自愈（异常触发才做）

| 信号 | 动作 |
| --- | --- |
| `tdd` 命令不存在 | 读 [environment.md](references/environment.md) 安装 |
| provider 组不存在 / 报未知选项 | 版本旧于 1.11.0：`tdd update --check` 报给用户确认后升级 |
| 报"无法连接 server"（退 6） | 提醒用户启动 Toonflow 桌面端或 `bun run dev` |

## 任务收尾（结构化汇报）

接入完成汇报：供应商 id/label/版本、模型清单（按类型）、真测结果（模型/耗时/媒体预览）、画布使用方式（节点模型下拉选 `<providerId>/<modelId>`；批量生产交接 tdd-auto 技能）。接入失败汇报：卡在哪个环节、判定信号输出、已尝试的修复、给用户的选项。

## 命令速查（provider 组；全局选项前置如 `tdd --json provider list`）

| 命令 | 费用 | 用途 |
| --- | --- | --- |
| `provider list` | 零 | 已装清单（模型数/凭证状态/loadError） |
| `provider inspect <文件.ts>` | 零 | 静态校验：语法/导出结构/类型契约 |
| `provider dryrun <文件.ts> --model <m> [--samples 样例.json] [--config k=v]` | 零 | 离线干跑：请求不出网，验证入参构造与结果解析 |
| `provider import <文件.ts>` | 零 | 安装到 Toonflow 数据目录 |
| `provider config <id> --set apiKey=<值>` | 零 | 写凭证（回显打码）；--set 可多次 |
| `provider models <id> [--refresh]` | 零 | 模型清单 / 从 modelsUrl 在线刷新 |
| `provider probe [<id>] [--url <地址>] [--config apiKey=<key>]` | 零 | 只读拉上游模型列表，预检密钥权限 |
| `provider test <文件.ts> --model <m> --yes` | **计费** | 真实调用上游；缺 --yes 直接拒绝；**凭证自动回退已装配置**（--config 仅临时覆盖） |
| `provider delete <id> --yes` | 零（破坏性） | 删除供应商及凭证（凭证一并清除，重装需重新 config） |

## 核心约定

- **退出码**：0 成功 · 2 参数/请求错误（含校验失败、dryrun/test 未通过、闸门拒绝） · 3 已安装冲突（409） · 4 供应商不存在 · 6 server 未运行。
- **dryrun 是默认排错工具**：真测只用于最终验收，一次通过为目标（先 inspect 后 dryrun 双绿再申请真测）。
- **文件名必须等于 `<id>.ts`**（id 小驼峰，如 `demoProvider.ts`）；改已装供应商源码需先 `delete --yes` 再 `import`（凭证会被清，需重配）。
- **供应商代码在本地拥有完整系统权限**：只接入用户明确提供的来源；接入前提醒用户确认来源可信。
- **画布生产**（生成视频、挂机、交付）不是本技能职责 → 交接 tdd-auto。

## 按需深入

- 供应商 .ts 开发规范与骨架模板 → [references/providerSpec.md](references/providerSpec.md)
- 七环节编排细节与调研清单 → [references/workflow.md](references/workflow.md)
- 报错对照与自愈 → [references/errors.md](references/errors.md)
- 环境与安装问题 → [references/environment.md](references/environment.md)
