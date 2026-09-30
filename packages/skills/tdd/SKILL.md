---
name: tdd
version: 1.0.0
description: 用 tdd 命令（Toonflow CLI，Python 版）无页面操作 Toonflow 画布完成视频批量生产：环境配置与更新、导入分镜、批量生成、挂机监控、失败排查、多画布工作流与产物交付。适用于 ZCode / Claude Code / Codex 等任何能执行 shell 的 Agent。
---

# Toonflow CLI（命令 `tdd`）

## 任务开始（三步）

```bash
tdd --version          # 1. 探测：命令存在即环境就绪（纯本地，不联网）
tdd update --check     # 2. 检查更新：有新版本时报给用户、经确认后 tdd update；失败不阻塞，继续用当前版本
tdd install            # 3. 同步技能与 Toonflow 侧插件（幂等秒级）
```

`tdd` 命令不存在（首次使用/未安装）→ 读 [references/environment.md](references/environment.md) 完成安装。

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

命令细节与示例 → [references/commands.md](references/commands.md)

## 核心约定

- **全局选项前置**：`tdd --json -w <目录> <组> <命令>`；`--canvas <id>`（省略 .json 自动补全）对 canvas/node/queue 均生效，queue 的 submit/status/export 支持逗号分隔多块。
- **退出码**：0 成功 · 2 参数/请求错误 · 3 画布版本冲突（先 `canvas get` 重读） · 4 目标不存在 · 5 完成但有失败任务 · 6 server 未运行（提醒用户启动 Toonflow）。
- **import 幂等**：与存量同 label 且参数一致自动跳过（重跑同任务零副作用）；不一致默认跳过并报差异；`--force-add` 才追加。
- **失败模型**：单任务失败自动重试 3 次后跳过、下游级联跳过；`queue logs` 看原因，`queue retry` 重提；server 重启后 `queue submit`（missing）幂等重建。
- **地址一律 127.0.0.1**，勿用 localhost。
- **高风险先确认**：删除节点、覆盖文件、批量消耗生成额度——先给用户选项。

## 按需深入

- 环境与安装问题（PATH、版本、报错）→ [references/environment.md](references/environment.md)
- 命令参数与用法示例 → [references/commands.md](references/commands.md)
- 报错对照与自愈 → [references/errors.md](references/errors.md)
- 按场景操作 → [references/scenarios/](references/scenarios/)：[首次使用](references/scenarios/firstRun.md) · [重复任务](references/scenarios/repeatTask.md) · [挂机批量](references/scenarios/batchProduction.md) · [失败排查](references/scenarios/failureTroubleshooting.md) · [多画布](references/scenarios/multiCanvas.md) · [产物交付](references/scenarios/deliverProducts.md) · [页面协作](references/scenarios/pageCollaboration.md)
