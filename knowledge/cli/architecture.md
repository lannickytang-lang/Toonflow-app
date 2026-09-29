# CLI 架构与代码地图

## 1. 为什么存在（用户场景）

本地运行 Toonflow 的用户，把"分镜资产批量生产视频"交给外部 AI agent 执行：单视频约 15 分钟、单画布数百个、需挂机数小时；期间用户可能多窗口查看画布。因此要求 agent **不经页面转发、不模拟 GUI，直接通过后端接口稳定操作画布**。agent 的原生环境是终端（`--help` 自发现、`--json` 取数、退出码判断成败），所以首选门面是 CLI；MCP 与 CLI 同语义同后端，作为兜底。

典型用户旅程（也是 selfcheck 冒烟层的蓝本）：首页复制引导语 → agent 执行 `tdd install`（装技能）→ `--help` 自学 → `project open` → `canvas import --auto-submit` 建图入队 → `queue status --watch` 挂机 → 出问题 `canvas report`/`queue logs`/`queue retry` 排障 → `queue export --verify` 交付清单。

## 2. 架构：纯门面，零业务状态

```
外部 agent ──shell──> tdd（Click 进程）
                        │  HTTP（Origin + x-toonflow-workspace 头）
                        ▼
                Toonflow server（Express，默认 127.0.0.1:3000）
                        │
        ┌───────────────┼─────────────────┐
   /api/canvas/*   /api/queue/*   /api/settings/* 等
   （画布文档仓库 + 生成队列 + 配置，业务全在这）
```

推论：**改命令语义通常要动 server**（CLI 只是转发与格式化）；CLI 单独可改的是参数解析、输出格式、退出码、hint、本地文件操作（读写分镜 JSON、export 落盘校验、workspace 记忆）。

## 3. 代码地图（`packages/cli/agent-harness/`）

```
packages/cli/agent-harness/
  setup.py                 # 包名 cli-tdd-toonflow / 版本 / entry_points: tdd=...toonflow_cli:main
  CHANGELOG.md             # 版本说明唯一源（发布门禁要求当前版本必须有段）
  selfcheck.py             # 发布自检门禁（三层 74 项，详见 release.md）
  cli_tdd/                 # PEP 420 命名空间包（此层无 __init__.py，规范硬性要求）
    toonflow/
      __main__.py          # python -m cli_tdd.toonflow 可直跑（无需 pip 上 PATH）
      toonflow_cli.py      # Click 入口：根组（全局选项+版本）、5 组 19 子命令 + 4 顶层命令、main() 错误出口
      core/
        client.py          # 唯一 HTTP 出口：request()（{code,data,message} 解包、退出码映射、Origin 头）、
                           #   workspaceOf 三级解析、cliRoot 数据根推导、emit(--json/人类输出)、canvasOperation
        canvas.py          # canvas 组 + findNode(id/前缀/label 解析) + validateStoryboard + schema 示例/字段说明
        node.py            # node 组
        queue.py           # queue 组（watch 轮询、export --verify 本地 stat）
        configProject.py   # status/models/config/project + coerceValue 值类型推断
        install.py         # tdd install（宿主技能+中心插件拉取）与 tdd update（自更新/版本列表）
      skills/SKILL.md      # 打包内置技能副本——与 packages/skills/toonflowCli/SKILL.md 保持一致（双处同步！）
```

命名约定说明：Python 生态包/模块为 snake_case（`cli_tdd/`、`toonflow_cli.py`），属于仓库小驼峰规范的第三方例外条款；包目录 `cli_tdd/toonflow` 是 PEP 420 要求，未来其他软件的 harness 可挂 `cli_tdd/<name>` 共存。

## 4. 命令面与退出码

5 个命令组 19 个子命令 + 4 个顶层命令（`status` `models` `install` `update`）。完整速查以 `tdd --help` 与技能 `packages/skills/toonflowCli/SKILL.md` 为准。

**全局选项前置**：`--json` / `-w <目录>` / `--canvas <id>` / `--server <url>` 必须写在子命令之前（`tdd --json queue status` ✓，`tdd queue status --json` ✗ 报 No such option）。这是 Click 根组选项的固有行为，帮助文本与引导语均已说明。

**退出码契约**（agent 的成败判断依据，改动需极谨慎）：

| 码 | 含义 | 典型来源 |
| --- | --- | --- |
| 0 | 成功（含"已是最新"等幂等结果） | — |
| 2 | 参数/请求错误 | 用法错误、未知命令、非 409/404 的 HTTP 错误、install 失败 |
| 3 | 画布版本冲突（HTTP 409） | 人机并存修改；hint 提示先 `canvas get` 重读 |
| 4 | 目标不存在（HTTP 404） | 节点/画布/配置项不存在 |
| 5 | 完成但存在失败 | `queue status --watch` 有失败/跳过、`canvas report` 有异常、`export --verify` 产物缺失 |
| 6 | server 未运行 | 连接失败 |

注意 `--json` 模式下的差异（沿袭历史行为）：`queue status --watch` 与 `canvas report` 在 json 输出路径**不**返回 5（提前 return），human 路径才判 5；`queue export` 两种模式都判 5。

## 5. 关键机制（改代码前必懂）

- **workspace 三级解析**（`client.workspaceOf`）：`-w` 参数 → 环境变量 `TOONFLOW_WORKSPACE` → 记忆缓存 `<数据根>/data/tddWorkspace.txt`（`project open` 写入）。数据根由 `cliRoot()` 推导（见陷阱清单 #6）。
- **请求头**：所有请求带 `Origin: <serverBase>` 与 `x-toonflow-workspace: 1`——settings 等接口走 server 的 `assertAppRequest` 校验，缺 Origin 直接 403。
- **body 构造的 undefined 语义**：值为 None 的可选字段**不要放进请求 body**（Python 的 None 会序列化成 `null`，server 的 Zod 校验拒绝；bun 时代 undefined 键会消失）。参考 `canvasOperation` 的条件写入写法。
- **settings/get 的 data 即 settings 本身**（不再包一层 `settings` 键）。取错层会导致 `config set` 全量覆盖清空用户配置——历史上真实发生过，`configProject.fetchSettings` 有注释防回退。
- **节点寻址**：`node get/set/cast` 与 `queue retry` 统一支持 完整 id / id 前缀 / label（`canvas.findNode`）；但 server 端 `nodeTools` 只认完整 nodeId——CLI 层先解析再传。分镜 label 形如 `分镜1`、资产为资产名。
- **install/update 都读中心 manifest**：`https://gitee.com/comtudodo/tudodo-center/raw/master`（可用 `--mirror` 覆盖）。urllib 默认 UA 可过 Gitee；pip 的 UA 会被 403——所以安装命令一律"curl 下载 + 本地 pip install"。
- **emit 双模式**：`--json` 输出 `json.dumps(data, ensure_ascii=False, indent=2)`，人类模式输出中文摘要。新增命令两种输出都要写。

## 6. CLI 依赖的 server 端点（转发契约）

| 端点 | 使用命令 |
| --- | --- |
| `GET /api/projects/list` | status、project list |
| `GET /api/providers/media/list` | models |
| `GET/PUT /api/settings/get`、`/api/settings/save` | config get/set |
| `GET /api/canvas/list?directory=` | canvas list、project open |
| `POST /api/canvas/operation`（name: getCanvas / importStoryboard / fitCanvas / deleteEdges / connectNodes / nodeTools） | canvas get/fit/import、node 全部、queue retry --set |
| `GET /api/canvas/report` | canvas report |
| `POST /api/queue/submit`、`GET /api/queue/status`、`GET /api/queue/logs`、`POST /api/queue/cancel` | queue 组 |

server 端点零改动时 CLI 可独立演进；改端点必须同步 MCP（`apps/server/src/utils/mcp/tools.ts`）与页面。
