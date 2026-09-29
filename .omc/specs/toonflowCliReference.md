# Toonflow CLI 现状文档（能力 / 实现代码 / 验收场景）

> 记录时间：2026-09-28，对应 bun 版 CLI（`scripts/toonflow.ts`）。本文是迁移 Python 版前的基线快照。

## 1. 用户使用场景（诉求背景）

**核心诉求**：本地运行 Toonflow，把分镜资产的批量视频生产交给外部 agent（Claude Code / Codex / ZCode 等）。单个视频生成约 15 分钟、单画布可能有几百个视频，需要挂机数小时无人值守；挂机期间用户还可能同时打开多个画布窗口查看调整，因此要求 agent **不经页面转发、不模拟 GUI，而是通过后端接口直接、稳定地操作画布**。

**为什么是 CLI**：外部 agent 的原生环境就是终端——命令可 `--help` 自发现、`--json` 结构化取数、退出码判断成败，比注册 MCP server 或理解页面 DOM 更省事。CLI 与 MCP 同语义同后端：CLI 是给外部 agent 的首选门面，MCP 兜底。

**典型端到端流程**（新用户视角）：

1. 双击桌面应用启动 Toonflow，首页复制引导语，连同任务一起粘贴给外部 agent（如"把这个分镜 JSON 导入画布并批量出视频"）；
2. agent 首次执行 `toonflow install`（装技能+拉插件，秒级），再 `--help` 自学全部命令；
3. `project open` / `canvas import` 导入分镜一次建图（资产图→分镜→出镜连线+自动布局）；
4. `queue submit` 批量入队——依赖编排、限流退避、失败重试都在 server 端，agent 只管提交；
5. `queue status --watch` 挂机盯进度；期间用户可随时打开画布页面查看调整，revision 乐观锁保证人机不互相覆盖；
6. 出问题时 `canvas report` 体检、`queue logs` 看失败原因原文、`queue retry --set` 修改后重提；server 重启队列丢失也没关系，`queue submit --scope missing` 幂等重建；
7. 完成后 `queue export --verify` 校验产物落盘并产出清单交付。

## 2. 定位与启动形态

CLI 是 headless 画布生产的命令行门面，**与 MCP 同语义同后端**：所有命令转发到 Toonflow server 的 HTTP 接口，server 端点与 MCP 工具共用同一套实现（`applyCanvasOperation` / 生成队列），CLI 本身不含业务逻辑。

| 形态 | 启动方式 | 分发链路 |
| --- | --- | --- |
| 源码模式 | `bun scripts/toonflow.ts …` | 仓库源码直跑，要求本机 bun |
| Windows 桌面 | `toonflow-cli.exe …`（约 94MB，内嵌 bun 运行时） | `bun run build:cli` 编译 → `electrobun.config.ts` copy 进安装根 |
| macOS 桌面 | `toonflow-cli …`（无扩展名） | 需在 mac 打包机执行 `build:cli` 后随包分发 |

入口选择逻辑：`/api/agentGuide/get` 探测源码路径或桌面安装根的 CLI 文件，动态生成引导语；两者皆无则退回 MCP 版引导语。

## 3. 能力清单（7 组 22 子命令）

全局参数：`--json`（结构化输出）｜ `-w/--workspace <目录>` 或环境变量 `TOONFLOW_WORKSPACE`（`project open` 后写入 `data/toonflowCliWorkspace.txt` 记忆，可省略）｜ `--canvas <画布id>` ｜ `--server <url>`（默认 `http://127.0.0.1:3000`）。

| 命令 | 作用 | 关键参数 |
| --- | --- | --- |
| `status` | 自检：server 连接 / 项目数 / 当前默认工作区 | — |
| `models` | 可用模型清单（`providerId/modelId` 供 import 与 node set 用） | `--type image|video` |
| `config get <点路径>` | 读设置（如 `mediaProviderConfigs.grsai`） | — |
| `config set <点路径> <值>` | 写设置（供应商凭证等），读改写回全量保存 | — |
| `install` | 一键安装：探测宿主技能目录装技能 + 从中心全量拉取 Toonflow 插件 | `--hosts d1,d2` `--force` `--mirror` `--toonflow-only` `--hosts-only` |
| `project list` | 项目清单（扫 data/workspaces） | — |
| `project open <目录>` | 打开/创建工作区并记住为默认 | — |
| `canvas list` | 画布清单（节点/边数/revision） | — |
| `canvas get` | 画布摘要（类型分布、生成状态统计） | `--nodes` 附节点表（截断 50） |
| `canvas import <分镜.json>` | 导入分镜一次建图（资产图→分镜→cast 连线+布局） | `--auto-submit` 导入即提交队列；`--schema` 打印示例 JSON |
| `canvas report` | 画布体检：健康度汇总+异常检测（含建议）+节点表（含上游 cast） | `--explain` 打印画布 JSON 字段说明 |
| `canvas fit` | 让已打开页面适配视口（配合浏览器截图排查；无页面连接时报错引导） | `--nodes id1,id2`（支持 id 前缀/label）聚焦 |
| `node list` | 节点表（label/类型/状态） | `--type` `--status` 过滤 |
| `node get <nodeId|label>` | 节点详情（含 data 全量） | — |
| `node set <nodeId>` | 改提示词/模型/时长/分辨率/比例/尺寸（视频节点校验参数适用性） | `--prompt` `--model provider/model` `--duration` `--resolution` `--ratio` `--size` |
| `node cast <分镜id> --assets <id…>` | 整组替换该分镜的出镜连线（删旧边+连新边，含容量校验语义在 server） | — |
| `queue submit` | 批量入队（依赖拓扑编排在 server） | `--scope missing|all`（默认 missing=断点重建）`--nodes id1,id2` `--concurrency N` |
| `queue status` | 队列状态（汇总+任务明细） | `--watch` 挂机轮询到终态（有失败退出码 5）`--interval 秒` |
| `queue logs <taskId>` | 任务日志与失败原因原文 | `--tail N` |
| `queue retry <nodeId…>` | 按修改重提（先应用修改再重入队） | `--set fix.json`（如 `{"prompt":"…"}`） |
| `queue cancel` | 取消任务 | `<taskId|nodeId>` 或 `--all` |
| `queue export` | 产物路径清单（分镜×产物表格） | `--format md|json|csv` `--output 文件` `--verify`（本地 stat 校验落盘，缺失退出码 5） |

### 退出码与报错规范

| 退出码 | 含义 | 典型来源 |
| --- | --- | --- |
| 0 | 成功 | — |
| 2 | 参数/请求错误 | 用法缺参、未知命令、非 409/404 的 HTTP 错误、install 失败 |
| 3 | 画布版本冲突（409） | 人机并存修改，hint 提示"先 canvas get 重读" |
| 4 | 目标不存在（404） | 节点/画布/配置项不存在，hint 提示查询命令 |
| 5 | 完成但存在失败 | `queue status --watch` 有 failed/skipped；`canvas report` 有异常；`export --verify` 产物缺失 |
| 6 | server 未运行 | fetch 失败，hint 提示先启动 Toonflow |

所有报错输出 `error: <信息>` + 可选 `hint: <自愈建议>` 两行。规范出处：CLI-Anything 式 agent 友好约定（--help 自发现、--json、退出码语义、hint 自愈）。

## 4. 实现代码地图

### 4.1 CLI 本体：`scripts/toonflow.ts`（608 行）

| 区块 | 行数约 | 内容 |
| --- | --- | --- |
| cliRoot() | 10-15 | 根目录推导：源码模式仓库根；编译版用 exe 所在目录（桌面安装根） |
| parseArgs | 21-44 | 手写参数解析：`--key value` / `-w` 短映射 / flag 判定 `next.startsWith("-")`（防 `--verify -w` 被吞） |
| request | 57-73 | fetch 封装：`x-toonflow-workspace` 头、120s 超时、`{code,data,message}` 解包、HTTP 状态→退出码映射 |
| workspaceOf | 77-85 | 工作区三级解析：-w 参数 → 环境变量 → 缓存文件记忆 |
| canvasFieldGuide | 109-118 | 画布 JSON 字段说明常量（report --explain 输出） |
| 命令实现 | 120-507 | 22 个 cmd* 函数（models/config/status/project/canvas/node/queue） |
| helpText | 511-552 | 帮助文本（含典型挂机流程示例，launcher 动态替换） |
| 分发段 | 554-607 | group/command 手工分发；单命令组（status/models/install）flag 不当子命令；install 转调 runInstall |

### 4.2 安装器：`scripts/installExtensions.ts`

- 导出 `runInstall({args, value, rootDirectory})` 供 CLI `install` 内置调用（编译版 spawn 不到外部脚本所以内置）；`import.meta.main` 直跑。
- 宿主探测：`~/.claude/skills`、`~/.codex/skills`、`~/.zcode/skills`、`~/.agents/skills`。
- 中心拉取：`https://gitee.com/comtudodo/tudodo-center/raw/master`，技能/供应商/工具全量，版本一致跳过（幂等），`--force` 覆盖。
- 自带 unzip：`DecompressionStream("deflate-raw")` 解析 zip（不依赖系统 unzip）。

### 4.3 依赖的 server 端点（CLI 是纯门面，端点不动则 CLI 语义不动）

| 端点 | 使用命令 |
| --- | --- |
| `GET /api/providers/media/list` | models |
| `GET /api/settings/get`、`PUT /api/settings/save` | config get/set |
| `GET /api/projects/list` | status、project list |
| `GET /api/canvas/list` | canvas list、project open |
| `POST /api/canvas/operation`（name: getCanvas / importStoryboard / fitCanvas / deleteEdges / connectNodes / nodeTools） | canvas get/fit/import、node 全部、queue retry --set |
| `GET /api/canvas/report` | canvas report |
| `POST /api/queue/submit` | queue submit/retry |
| `GET /api/queue/status` | queue status（含 watch 轮询） |
| `GET /api/queue/logs` | queue logs |
| `POST /api/queue/cancel` | queue cancel |

本地文件系统仅四类：读分镜 JSON（import）/ 读 fix.json（retry --set）/ 写清单文件（export --output）/ stat 校验产物（export --verify）/ 工作区记忆缓存。

### 4.4 分发与教学链路

- `package.json`：`"build:cli": "bun build scripts/toonflow.ts --compile --outfile build/cli/toonflow-cli"`（bun 自动按平台补 `.exe`）。
- `electrobun.config.ts`：copy `build/cli/toonflow-cli(.exe)` 进桌面安装根（win/mac 按平台分支）。
- `apps/server/src/routes/agentGuide/get.ts`：探测源码 CLI → 桌面 CLI，动态生成引导语（正斜杠路径；桌面引导用户先 `install` 再 `--help` 自学）。
- `packages/skills/toonflowCli`（1.3.1，经中心分发）：启动器代称 `<cli>`（源码 bun / win exe / mac 无扩展名+xattr 兜底）、命令速查、退出码、失败模型、断点重建、排障。
- `tudodo-center/scripts/sync.py`：SKILLS 配置区维护技能版本，产物进中心 dist+manifest。

## 5. 验收场景（已实测记录）

| 场景 | 验证内容 | 结果 |
| --- | --- | --- |
| AC-5 零文档冷启动 | 新会话子代理仅凭首页引导语+install+--help，无人工文档完成全流程 | 13 次调用全成功，约 4.5 分钟（install→project open→import→submit→watch→export --verify） |
| AC-2 断点重建幂等 | 模拟 server 重启（内存队列清空）后重跑 `queue submit --scope missing` | 产物在盘节点跳过、失败/缺失节点重提 |
| AC-3 人机共存 | 页面与 CLI 并发改画布 | 后写方 409→退出码 3+hint 重读；页面侧弹窗提示重载 |
| AC-4 失败模型 | 构造失败任务 | 失败重试 3 次后 skipped、下游依赖级联 skip、`queue logs` 原文、`queue retry --set` 修改后重提成功 |
| 挂机语义 | `queue status --watch --interval N` | 轮询到终态退出；存在 failed/skipped 时退出码 5 |
| 交付校验 | `queue export --format md --output 清单.md --verify` | 逐产物 stat 字节数；缺失标 ⚠ 且退出码 5 |
| 安装幂等 | `install` 零参 + 重复执行 + 编译版 exe 在桌面安装根模拟目录 | 自动探测宿主、版本一致跳过、全量安装成功 |
| 参数边界 | `--verify -w` 组合、单命令组 flag、编译版 `process.argv[1]` 虚拟路径（B:/~BUN） | 均修复：flag 判定 `startsWith("-")`、singleCommandGroups、launcher 改用 `process.execPath` |

## 6. 已知限制（迁移 Python 的动机）

1. **运行时绑定**：源码模式必须 bun；桌面模式必须按平台编译二进制——mac 产物必须在 mac 打包机构建（bun 交叉编译目标运行时下载受限），且mac 二进制有 Gatekeeper `xattr` 兜底负担。
2. **体积与三形态维护**：win exe 约 94MB；源码/win/mac 三种形态 + agentGuide 三分支探测 + 技能文档三形态说明，维护面大。
3. **生态不互通**：无法 pip 安装、无 CLI-Anything 生态位（cli-hub registry、SKILL.md 模板、PyPI），外部 agent 需要先拿到启动器路径才能用。
4. **自带 unzip**：DecompressionStream 解析 zip 为自研实现，平台边缘情况需自行兜底（Python 标准库 zipfile 开箱即用）。
