# Python CLI 重写方案（遵循 CLI-Anything 规范）

> 状态：**已批准待实施**（2026-09-28 拍板：直接替换不留兼容；命令名 `tdd`；包名 `cli-tdd-toonflow`）。前提：接受 Python 3.10+ 运行时，缺失时由外部 agent 自行安装（winget/brew 等）。

## 1. CLI-Anything 学习结论（已下载实测）

仓库已克隆到 `.omc/research/cliAnything`，`cli-anything-hub` 已 pip 安装并实测（`cli-hub install mermaid` 秒装可用）。它不是库或代码生成器，而是三件套：

1. **方法论 SOP**：`cli-anything-plugin/HARNESS.md`（747 行，7 阶段：分析→架构→实现→测试计划→测试→文档→发布）。所有平台入口（Claude Code 插件、Codex 技能、Cursor 插件…）本质都是把这份 SOP 喂给 agent，由 agent 读目标源码后手写生成 CLI。**ZCode 无官方插件，但 SOP 是纯文档——由本会话 agent 直接执行其方法论即可，等价于它支持的所有平台入口。**
2. **产物规范**：Python 3.10+ / Click ≥8；每命令必支持 `--json`；PEP 420 命名空间包 `agent-harness/cli_anything/<software>/`；`setup.py` pip 安装上 PATH；SKILL.md 自动生成（YAML frontmatter+命令组+agent 指引）。
3. **分发生态**：cli-hub（pip 包管理器）+ registry.json 收录 + PyPI。

对位样例：`ollama`、`comfyui`、`adguardhome` 均为"本地 REST server 封装型"CLI——与 Toonflow CLI（转发 HTTP 到本机 server）完全同型，作为代码模板。

**"真实软件后端"原则完全契合**：规范第一铁律是"CLI 必须调用真实软件、不得用 Python 重实现"。我们的 CLI 只转发 HTTP 到 Toonflow server，画布/队列逻辑全在 server——天然合规。

## 2. 目标形态

### 2.1 包结构（仓库唯一源码，借鉴 ollama 样例裁剪）

```text
packages/cli/                          # 唯一源码（插件规范：修改只在这里）
  agent-harness/
    setup.py                           # name="cli-tdd-toonflow"，console_scripts 生成 tdd 命令
    cli_tdd/                           # PEP 420 命名空间包（无 __init__.py，规范硬性要求）
      toonflow/
        __init__.py  __main__.py       # python -m cli_tdd.toonflow 可跑
        toonflow_cli.py                # Click 入口：命令组+全局 --json/-w/--server
        core/
          client.py                    # HTTP 客户端（标准库 urllib）：{code,data,message} 解包、
                                       #   HTTP 状态→退出码映射、hint、server 未运行→码 6
          canvas.py  node.py  queue.py # 各命令组实现（22 子命令语义/参数/退出码与 bun 版对齐）
          configProject.py             # config get/set + project list/open + status/models
          install.py                   # install 的 Python 化：urllib+zipfile（替代 DecompressionStream）
        skills/SKILL.md                # 打包内置技能副本（toonflowCli 技能源文件的副本）
```

依赖：`click>=8` 唯一第三方依赖（HTTP 用标准库 urllib，不引 requests；无 prompt-toolkit）。
命名（已定案）：命令 `tdd`；pip 包 `cli-tdd-toonflow`；命名空间包 `cli_tdd/`——与 CLI-Anything 的 `cli-anything-*` / `cli_anything` 完全平行，未来其他软件的 harness 可挂 `cli-tdd-<name>` 共存于同一命名空间。

### 2.2 命令面：与 bun 版完全对齐（7 组 22 子命令）

语义、参数、退出码（0/2/3/4/5/6）、hint 文案、`TOONFLOW_WORKSPACE`/`TOONFLOW_SERVER` 环境变量全部不变；workspace 记忆缓存改为 `data/tddWorkspace.txt`（未发布，不留旧文件名包袱）。server 端点零改动——这是纯门面替换，迁移风险被限制在 CLI 进程内。

### 2.3 分发与引导链路

| 链路 | 现状（bun） | 新方案（Python） |
| --- | --- | --- |
| 源码模式 | `bun scripts/toonflow.ts` | `pip install -e packages/cli/agent-harness` 后 `tdd …`（或 `python -m cli_tdd.toonflow`） |
| Windows 桌面 | 94MB 编译 exe 随包 | copy 同一份源码目录进安装根（约 100KB 文本）；引导语 `python -m pip install -e <安装根>/cli` |
| macOS 桌面 | 需 mac 打包机 build:cli + xattr 兜底 | **同一份源码，无编译、无 Gatekeeper 负担**（mac 迁移最大收益） |
| 中心（tudodo-center） | 不分发 CLI 本体 | sync.py 配置区新增条目：dist 放源码 zip，manifest 提供 URL（`pip install <zip URL>` 可直接装） |
| 引导语（agentGuide） | 探测 bun 路径/exe | 探测顺序：python 可用（python/python3/py -3）→ pip 装包 → `tdd install` → 干活；**无 python 时引导语第一条改为让 agent 自装 python（win: `winget install Python.Python.3.12`；mac: `brew install python3`）并给验证命令** |
| MCP 兜底 | 保留 | 保留不变 |

### 2.4 与 bun 版的交接

直接替换、不留双实现（已确认：未发布、无历史兼容负担）。`scripts/toonflow.ts`、`scripts/installExtensions.ts`、`build:cli` 脚本、electrobun `cliArtifact` 条目下线；`packages/skills/toonflowCli` 升 2.0.0（技能名保留，内容命令全部改为 `tdd`，启动器改为 pip 安装后的 `tdd` 命令 + python 自装指引）；中心同步发布。

## 3. 对 CLI-Anything 规范的取舍（明确偏离项）

| 规范要求 | 本方案 | 理由 |
| --- | --- | --- |
| Click ≥8 | **遵循** | 唯一第三方依赖 |
| 每命令 `--json` | **遵循** | 与现有规范一致 |
| REPL 默认（invoke_without_command=True + ReplSkin） | **不做**，无参时打印 help | agent 每次 spawn 新进程，one-shot 即可；挂机已由 `queue status --watch` 覆盖；省掉 prompt-toolkit 依赖 |
| undo/redo session | **不做** | server 端 revision 乐观锁+409 已覆盖人机共存 |
| TEST.md / pytest 四层测试（Phase 4/5） | **不做** | 仓库规范禁止测试文件；沿用"实际 HTTP 验证+新会话子代理复测"的既有验收方式 |
| preview 体系（bundle/live/trajectory） | **不做** | 画布排查已有 canvas report + canvas fit+浏览器截图路径 |
| PyPI 发布 / cli-hub 收录 | **三期可选** | 国内用户 pip 装 PyPI 包慢且需账号运营；一期中心分发已闭环。后续要推广再发 |
| `cli-anything-<name>` 包名前缀 | 自有前缀 `cli-tdd-<name>`（本单 `cli-tdd-toonflow`，已定案） | 建立自有命名空间，与 CLI-Anything 生态平行、可扩展到其他软件 |

命名规范冲突说明：Python 生态包/模块强制 snake_case（`cli_anything/`、`toonflow_cli.py`、PEP 420 结构），属于"第三方接口强制要求的名称保留原始写法"例外条款（类比 `<vue-flow/>`）；`packages/cli/` 等自有目录仍小驼峰。

## 4. 实施步骤（每步含验证，待批准后执行）

1. **骨架+client**：`packages/cli` 包结构、Click 入口、client.py（退出码映射/hint/workspace 记忆/server 探测）→ 验证：`tdd status`、`tdd models --json` 输出与 bun 版逐字段一致。
2. **22 命令移植**：canvas/node/queue/config/project 各组 → 验证：新旧版本 `--json` 输出并排比对（同一画布同一命令），人工可读输出等价。
3. **install 命令 Python 化**：urllib+zipfile 重写（宿主探测/中心拉取/版本比对/--force 幂等语义不变）→ 验证：临时宿主目录+`--mirror` 指向本地模拟中心，全流程+重复执行跳过。
4. **分发切换**：中心 sync.py 条目+zip 产物；electrobun copy 源码目录；agentGuide 探测与引导语重写；技能 toonflowCli 2.0.0；README/引导卡同步 → 验证：模拟桌面安装根目录（无 bun/无 build 产物）走新引导语全流程。
5. **AC-5 复测**：新会话子代理，仅首页引导语起步（含无 python 自装分支的文案审查）→ install → 全流程 → export --verify；对照 bun 版实测记录（13 次调用/4.5 分钟）。
6. **清理与提交**：删除 bun 版两脚本、build:cli、cliArtifact；typecheck/build；git 提交。

## 5. 验收计划（五层）

**总原则**：server 端点零改动，画布/队列的业务语义不重测（bun 版 8 项实测已覆盖，见 toonflowCliReference.md 第 5 节）；本次验收全部针对"门面层"——输出、退出码、参数解析、安装器、分发链路、引导语。

### 第一层：并排一致性（移植正确性）

每组命令移植完成后，在同一画布上与 bun 版并排执行：`--json` 输出逐字段一致，人类可读输出语义等价。基线命令 `tdd status`、`tdd models --json`，随后 22 子命令逐一对照。

### 第二层：行为特性场景

| # | 场景 | 通过标准 |
| --- | --- | --- |
| 1 | 退出码全表 | 0 成功 / 2 错参（构造缺参、未知命令）/ 3 冲突（页面与 CLI 并发改画布触发 409）/ 4 不存在（错误 nodeId）/ 5 有失败（`queue status --watch` 有 failed/skipped；`export --verify` 产物缺失）/ 6 server 未启动（停 server 执行命令），每码实测一次且 hint 正确 |
| 2 | 断点重建 | 模拟 server 重启后 `queue submit --scope missing`：产物在盘跳过、失败/缺失重提 |
| 3 | 人机共存 | 页面与 CLI 并发修改：后写方退出码 3 + hint，页面侧重载提示 |
| 4 | 失败模型 | 构造失败：重试 3 次后 skipped、下游级联 skip、`queue logs` 原文、`queue retry --set` 修改后重提成功 |
| 5 | install 幂等 | 临时宿主目录 + `--mirror` 指向本地模拟中心：全量装、重复执行版本一致跳过、`--force` 覆盖 |
| 6 | 参数边界 | `--verify -w <目录>` 组合不互吞、单命令组（status/models/install）flag 不当子命令、无参打印 help 退出 0 |
| 7 | workspace 记忆 | `project open` 后省略 `-w` 仍命中同一工作区；`TOONFLOW_WORKSPACE` 环境变量生效 |

### 第三层：分发链路（新形态闭环）

模拟桌面安装根目录：只有 copy 进去的源码目录 + 本机 python，无 bun、无编译产物——从新引导语起步走完全流程（pip install → `tdd install` → 干活）。中心侧：sync.py 产出源码 zip + manifest，`pip install <zip>` 可装可用。

### 第四层：AC-5 零文档冷启动复测（终极验收）

新会话子代理，只给首页引导语起步（含无 python 自装分支的文案审查），无人工文档、无人工介入，完成：install → `--help` 自学 → project open → `canvas import --auto-submit` → `queue status --watch` → 修复一个失败任务 → `queue export --verify`。对照 bun 版实测基线（13 次调用全成 / 约 4.5 分钟）：调用成功率与耗时不劣于基线，子代理最终总结无阻塞性问题。

### 第五层：清理回归与跨平台声明

- 删除 bun 版两脚本、`build:cli`、electrobun `cliArtifact` 后：server `bun run typecheck`/`bun run build` 通过（server 零改动，应无影响）；技能 2.0.0、引导语、中心 `sync.py --check` 一致。
- 跨平台：Windows 本机全量实测；mac 为同一份纯标准库+click 源码、无平台分支，本会话做静态审查，mac 出包时跑 `tdd status` + 一条 import 冒烟作为发布门（无需打包机构建 CLI 是本次迁移的最大收益之一）。


## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| Windows `python` 是 Microsoft Store 占位 stub | `status` 自检捕获并 hint（试 `py -3` / winget 安装）；引导语第一步就是确认 python 可用，agent 可自愈 |
| 用户 python 版本 <3.10 | setup.py `python_requires=">=3.10"`，pip 安装时即报明确错误；引导语附版本验证命令 |
| pip install -e 需写 site-packages 权限 | 文档主路径给 `pip install --user -e …`；agent 环境通常可写 |
| pip 安装需网络（click 依赖） | click 是纯 Python 小包，国内 pip 镜像可达；实在无网时中心 zip 内不含 click 的场景在引导语排障段注明（`pip install click` 单包） |
| CLI 与 server 端点耦合演进 | 与现状相同（门面架构不变），无新增风险；技能文档注明配套版本 |
