---
name: toonflowCli
version: 1.3.1
description: 用 toonflow CLI 无页面操作 Toonflow 画布完成视频批量生产：导入分镜、提交生成队列、挂机监控、失败排查与断点重建。适用于 ZCode / Claude Code / Codex 等任何能执行 shell 的 Agent。
---

# Toonflow CLI（headless 画布生产）

启动器（下文以 `<cli>` 代称，取你实际可用的一种）：
- 源码环境：`bun <Toonflow 仓库>/scripts/toonflow.ts`
- 桌面安装版（独立可执行，无需 bun；复制引导语时 server 会按平台给出完整命令）：
  - Windows：`<安装根目录>	oonflow-cli.exe`
  - macOS：`<安装根目录>/toonflow-cli`（若 Gatekeeper 拦截：`xattr -d com.apple.quarantine <路径>` 解锁一次）

server 须在运行（默认 `http://127.0.0.1:3000`）；地址一律用 `127.0.0.1`，勿用 localhost。命令报"无法连接 server"时先让用户启动 Toonflow。

## 快速流程（挂机生产）

```bash
export TOONFLOW_WORKSPACE="D:/prod/demo"          # 一次设定，长流程挂机用
<cli> status                     # 自检（server/项目/工作区）
<cli> canvas import 分镜.json --auto-submit   # 导入建图 + 提交队列
<cli> queue status --watch --interval 60      # 挂机盯进度（全成功退 0）
<cli> queue export --format md --output 清单.md --verify   # 交付：清单+落盘校验
```

## 命令速查

| 命令 | 用途 |
| --- | --- |
| `status` | server 在线 / 项目数 / 当前工作区 |
| `project list` / `project open <目录>` | 项目清单 / 打开（不存在自动创建） |
| `canvas list` / `canvas get [--nodes]` | 画布清单 / 摘要（节点类型与生成状态计数） |
| `canvas report [--explain]` | 画布体检：拓扑、节点现状、异常检测（产物落盘实测、失败原因、上游阻塞）；`--explain` 打印画布 JSON 字段说明，用于判断画布现状是否正确 |
| `canvas fit [--nodes id1,id2]` | 让已打开的页面适配视口（全幅或聚焦指定节点，配合浏览器截图排查；节点多用 --nodes 分组逐区截图） |
| `canvas import <json> [--auto-submit]` | 导入分镜标准 JSON 一次建图；`--auto-submit` 顺带提交队列 |
| `node list [--type ...] [--status ...]` / `node get <id>` | 节点过滤清单 / 详情 |
| `node set <id> [--prompt ...] [--model p/m] [--duration N] [--resolution R] [--ratio R]` | 修改节点 |
| `node cast <分镜id> --assets <id1,id2>` | 整组替换分镜出镜连线 |
| `queue submit [--scope missing\|all] [--nodes id1,id2] [--concurrency N]` | 批量入队；**missing（默认）= 只补未完成，重启后重建就重跑本命令** |
| `queue status [--watch] [--interval 秒]` | 状态/挂机轮询；`--watch` 到终态退出（有失败退 5） |
| `queue logs <taskId> [--tail N]` | 任务日志与失败原因原文（如提示词被拒） |
| `queue retry <nodeId...> [--set fix.json]` | 修改后重提（`--set` 如 `{"prompt":"…"}`） |
| `queue cancel <taskId\|nodeId\|--all>` | 取消任务 |
| `queue export [--format md\|json\|csv] [--output 文件] [--verify]` | 产物清单；`--verify` 校验文件在盘 |
| `config set <点路径> <值>` / `config get` | 供应商凭证等设置（如 mediaProviderConfigs.grsai.ts <apiKey>） |

## 关键约定

- **全局**：`--json` 结构化输出；`-w/--workspace` 或 `TOONFLOW_WORKSPACE`；`--canvas <id>` 省略时用第一块画布；`--server <url>`。
- **退出码**：0 成功 · 2 参数错误 · 3 画布版本冲突（先 `canvas get` 重读再改） · 4 目标不存在（先查询最新 ID） · 5 完成但有失败/跳过任务 · 6 server 未运行（请先启动 Toonflow）。
- **失败模型**：单任务失败自动重试 3 次后跳过（不拖垮队列）；上游失败时下游自动跳过；限流/网络错误退避重试不计失败。跳过的任务查 `queue logs` 原因，改完 `queue retry`。
- **断点重建**：server 重启队列清空属正常；重跑 `queue submit`（默认 missing）即幂等重建——已成功且产物在盘的自动跳过。
- **依赖编排**：资产图先生成，全部完成后视频任务才调度，无需自行排序。
- **导入 JSON 结构**：`{assets:[{name,imagePrompt}], scenes:[{sortNum,videoPrompt,cast:[name],duration?}], options:{imageModel,videoModel,resolution,duration,autoSubmit}}`；提供模型前先 `canvas list` 同仓的 MCP `listMediaProviders` 或直接用已知的 provider/model。

## 排障

- 409 冲突：画布被其他端（页面/另一 agent）改过——`canvas get` 重读最新再操作。
- 生成失败看 `queue logs`；常见为提示词敏感（改 `node set --prompt` 后 `queue retry`）。
- 多页面打开不影响本 CLI（后端直操作画布文档，不经页面）。
