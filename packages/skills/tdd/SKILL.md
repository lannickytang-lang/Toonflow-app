---
name: tdd
version: 1.1.0
description: 用 tdd 命令（Toonflow CLI，Python 版）无页面操作 Toonflow 画布完成视频批量生产：环境配置与更新、导入分镜、批量生成、挂机监控、失败排查、多画布工作流与产物交付。用户以 /tdd <需求> 调用或在任务中提及 Toonflow/画布生产时使用。
---

# Toonflow CLI（命令 `tdd`）

本技能是你的全部工作指引：用户以 `/tdd <需求>` 调用或任务涉及 Toonflow 画布生产时，按下面四步走。

## 第一步：环境自检（每次任务开头，秒级）

```bash
tdd --version          # 失败（命令不存在）→ 读 references/environment.md 完成安装再回来
tdd update --check     # 有新版本时报给用户、经确认后 tdd update；检查失败不阻塞，继续用当前版本
tdd install            # 同步技能与插件（幂等）
```

命令报"无法连接 server"（退 6）→ 提醒用户启动 Toonflow 后继续。

## 第二步：识别需求（按意图路由，先起手再深入）

| 用户意图 | 起手动作 | 需要深度时读 |
| --- | --- | --- |
| **生成/批量**（做成视频、跑起来、挂机） | `tdd canvas list` 判断存量：无相关画布 → 走首次流程；有 → `tdd canvas import <分镜.json> --check` 比对（全一致=已完成只需补未完成；有差异=问用户改存量还是新画布） | [首次](references/scenarios/firstRun.md) · [重复任务](references/scenarios/repeatTask.md) · [挂机批量](references/scenarios/batchProduction.md) |
| **诊断**（怎么了、看看、检查） | `tdd canvas report`：无异常 → 向用户汇报健康摘要；有异常 → 逐项处理 | [失败排查](references/scenarios/failureTroubleshooting.md) + [errors.md](references/errors.md) |
| **修改**（把分镜1改成8秒、换模型） | 直接用命令速查：`node set` / `node cast` 等 → 改完 `tdd node get <节点>` 验证 → 参数影响产物需重新生成时 `queue retry <节点>` | [commands.md](references/commands.md) |
| **交付/进度**（清单、导出、跑到哪了） | `tdd queue status`；交付 `tdd queue export --format md --output 清单.md --verify` | [产物交付](references/scenarios/deliverProducts.md) |
| **拿不准**（"继续"、无上下文） | `tdd project list` + `tdd queue status` 看现状再判断；仍模糊 → 问用户一句 | — |

其他专项：新画布/多画布并行 → [multiCanvas](references/scenarios/multiCanvas.md)；截图/页面协作 → [pageCollaboration](references/scenarios/pageCollaboration.md)；涉及删除/覆盖/批量消耗 → [highRiskChecklist](references/scenarios/highRiskChecklist.md)。

## 第三步：参数检查（缺才向用户要，不要瞎猜）

- **工作区**：`tdd project open <绝对目录>`（已记住则免问）；
- **分镜文件**：用户给路径；没给且需生成 → 按用户描述写 JSON（`tdd canvas import --schema` 看格式）并请用户确认要点；
- **模型**：默认用 mock 先验证流程；切真实供应商需用户确认（消耗额度）且凭证已 `config set`。

## 第四步：任务收尾（结构化汇报）

向用户汇报三要素：结果计数（成功/失败/跳过）、关键**绝对路径**（产物根目录/清单文件）、异常与建议（有失败给原因和下一步选项）。

## 命令速查

| 命令 | 用途 |
| --- | --- |
| `status` | 自检：server 在线 / 项目数 / 工作区 / PATH 提示 |
| `install [--force]` | 一键安装技能与插件（幂等） |
| `update [--check\|--version X\|--list]` | 检查/升级 CLI；指定版本；版本历史 |
| `project list` / `project open <目录>` | 项目清单 / 打开（自动创建，记住为默认） |
| `models [--type image\|video]` | 可用模型清单（providerId/modelId） |
| `config set <点路径> <值>` / `get` | 供应商凭证等设置 |
| `canvas list` / `get [--nodes]` | 画布清单 / 摘要 |
| `canvas create [名称]` | 新建画布（同名自动加时间戳后缀） |
| `canvas import <json> [--auto-submit] [--new-canvas [名]] [--check] [--force-add]` | 导入分镜建图，**幂等**；`--schema` 看示例 |
| `canvas report [--explain]` | 画布体检（含参数列 6s/9:16/480P）；`--explain` 字段说明 |
| `canvas fit [--nodes id…]` | 页面视口适配（截图前用） |
| `node list/get/set/cast` | 节点查询与修改（支持 id 前缀/label） |
| `queue submit [--scope missing\|all] [--nodes …]` | 批量入队（missing=断点重建默认） |
| `queue status [--watch]` | 队列状态 / 挂机到终态（有失败退 5） |
| `queue logs <taskId>` / `retry <节点…> [--set …]` / `cancel` | 失败原文 / 修改重提 / 取消 |
| `queue export [--format md\|json\|csv] [--output …] [--verify]` | 产物清单 + 落盘校验 |

## 核心约定

- **全局选项前置**：`tdd --json -w <目录> <组> <命令>`；`--canvas <id>`（省略 .json 自动补全）对 canvas/node/queue 均生效，queue 的 submit/status/export 支持逗号分隔多块。
- **退出码**：0 成功 · 2 参数/请求错误 · 3 画布版本冲突（先 `canvas get` 重读） · 4 目标不存在 · 5 完成但有失败任务 · 6 server 未运行。
- **import 幂等**：与存量同 label 且参数一致自动跳过（重跑同任务零副作用）；不一致默认跳过并报差异；`--force-add` 才追加。
- **失败模型**：单任务失败自动重试 3 次后跳过、下游级联跳过；`queue logs` 看原因，`queue retry` 重提；server 重启后 `queue submit`（missing）幂等重建。
- **地址一律 127.0.0.1**，勿用 localhost。
- **高风险先确认**：删除节点、覆盖文件、批量消耗生成额度——先给用户选项。

## 按需深入

- 环境与安装问题（PATH、版本、报错）→ [references/environment.md](references/environment.md)
- 命令参数与用法示例 → [references/commands.md](references/commands.md)
- 报错对照与自愈 → [references/errors.md](references/errors.md)
