---
name: toonflowCli
version: 2.0.2
description: 用 tdd 命令（Toonflow CLI，Python 版）无页面操作 Toonflow 画布完成视频批量生产：导入分镜、提交生成队列、挂机监控、失败排查与断点重建。适用于 ZCode / Claude Code / Codex 等任何能执行 shell 的 Agent。
---

# Toonflow CLI（headless 画布生产，命令 `tdd`）

安装（仅首次，宿主机执行一次）：
1. 自检：`python --version`（mac 可用 `python3 --version`，Windows 可用 `py -3 --version`）；
2. 无 python 时安装：Windows `winget install Python.Python.3.12`；macOS `brew install python3`；装好重开终端；
3. 安装 CLI（标准路径，任意机器；Gitee 对 pip 直链 403，须先 curl 下载再本地安装）：
   `curl -L -o cli-tdd-toonflow.zip https://gitee.com/comtudodo/tudodo-center/raw/master/dist/cli/cli-tdd-toonflow.zip && python -m pip install cli-tdd-toonflow.zip`
4. 首次执行 `tdd install`（把画布操作技能装进你的技能目录，秒级幂等）。

开发环境备注：主仓库/桌面安装根内有源码时也可 `python -m pip install -e <路径>/agent-harness`，仅本地开发用，普通用户走上面的标准路径。

装好后全局命令 `tdd` 即可用。全局选项（`--json` / `-w` / `--canvas` / `--server`）写在子命令之前，如 `tdd --json queue status`。

server 须在运行（默认 `http://127.0.0.1:3000`）；地址一律用 `127.0.0.1`，勿用 localhost。命令报"无法连接 server"时先让用户启动 Toonflow。

## 快速流程（挂机生产）

```bash
export TOONFLOW_WORKSPACE="D:/prod/demo"          # 一次设定，长流程挂机用
tdd status                       # 自检（server/项目/工作区）
tdd canvas import 分镜.json --auto-submit   # 导入建图 + 提交队列
tdd queue status --watch --interval 60      # 挂机盯进度（全成功退 0）
tdd queue export --format md --output 清单.md --verify   # 交付：清单+落盘校验
```

## 命令速查

| 命令 | 用途 |
| --- | --- |
| `status` | server 在线 / 项目数 / 当前工作区 |
| `tdd install` | 一键安装技能与 Toonflow 侧插件（幂等；`--force` 覆盖） |
| `tdd update [--version X.Y.Z]` | 升级 CLI 到最新；`--version` 装指定历史版本（可降级）。命令行为异常先 update 再试 |
| `project list` / `project open <目录>` | 项目清单 / 打开（不存在自动创建，记住为默认） |
| `canvas list` / `canvas get [--nodes]` | 画布清单 / 摘要（节点类型与生成状态计数） |
| `canvas report [--explain]` | 画布体检：拓扑、节点现状、异常检测（产物落盘实测、失败原因、上游阻塞）；`--explain` 打印画布 JSON 字段说明，用于判断画布现状是否正确 |
| `canvas fit [--nodes id1,id2]` | 让已打开的页面适配视口（全幅或聚焦指定节点，配合浏览器截图排查；节点多用 --nodes 分组逐区截图） |
| `canvas import <json> [--auto-submit]` | 导入分镜标准 JSON 一次建图；`--auto-submit` 顺带提交队列；`--schema` 看示例 |
| `node list [--type ...] [--status ...]` / `node get <id>` | 节点过滤清单 / 详情 |
| `node set <id> [--prompt ...] [--model p/m] [--duration N] [--resolution R] [--ratio R]` | 修改节点 |
| `node cast <分镜id> --assets <id1,id2>` | 整组替换分镜出镜连线 |
| `queue submit [--scope missing\|all] [--nodes id1,id2] [--concurrency N]` | 批量入队；**missing（默认）= 只补未完成，重启后重建就重跑本命令** |
| `queue status [--watch] [--interval 秒]` | 状态/挂机轮询；`--watch` 到终态退出（有失败退 5） |
| `queue logs <taskId> [--tail N]` | 任务日志与失败原因原文（如提示词被拒） |
| `queue retry <nodeId...> [--set fix.json]` | 修改后重提（`--set` 如 `{"prompt":"…"}`；与 node get 一致支持完整 id / id 前缀 / label） |
| `queue cancel <taskId\|nodeId\|--all>` | 取消任务 |
| `queue export [--format md\|json\|csv] [--output 文件] [--verify]` | 产物清单；`--verify` 校验文件在盘 |
| `models [--type image\|video]` | 可用模型清单（providerId/modelId） |
| `config set <点路径> <值>` / `config get` | 供应商凭证等设置（如 mediaProviderConfigs.grsai.ts <apiKey>） |

## 关键约定

- **全局选项前置**：`tdd --json <组> <命令>`、`tdd -w <目录> <组> <命令>`；环境变量 `TOONFLOW_WORKSPACE` / `TOONFLOW_SERVER` 同效；`--canvas <id>` 省略时用第一块画布。
- **退出码**：0 成功 · 2 参数错误 · 3 画布版本冲突（先 `canvas get` 重读再改） · 4 目标不存在（先查询最新 ID） · 5 完成但有失败/跳过任务 · 6 server 未运行（请先启动 Toonflow）。
- **失败模型**：单任务失败自动重试 3 次后跳过（不拖垮队列）；上游失败时下游自动跳过；限流/网络错误退避重试不计失败。跳过的任务查 `queue logs` 原因，改完 `queue retry`。
- **断点重建**：server 重启队列清空属正常；重跑 `queue submit`（默认 missing）即幂等重建——已成功且产物在盘的自动跳过。
- **依赖编排**：资产图先生成，全部完成后视频任务才调度，无需自行排序。
- **导入 JSON 结构**：`{assets:[{name,imagePrompt}], scenes:[{sortNum,videoPrompt,cast:[name],duration?}], options:{imageModel,videoModel,resolution,duration,autoSubmit}}`；模型 providerId/modelId 用 `models` 命令查询。

## 排障

- `tdd` 命令不存在：pip 安装未完成或不在 PATH——重跑安装命令；`python -m cli_tdd.toonflow` 可直接跑无需 PATH。
- 命令行为异常/报未知命令：先 `tdd update` 升级（`tdd --version` 查当前版本），再重试。
- 409 冲突：画布被其他端（页面/另一 agent）改过——`canvas get` 重读最新再操作。
- 生成失败看 `queue logs`；常见为提示词敏感（改 `node set --prompt` 后 `queue retry`）。
- 多页面打开不影响本 CLI（后端直操作画布文档，不经页面）。
