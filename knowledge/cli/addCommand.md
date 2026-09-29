# 新增/修改 CLI 命令指南

## 1. 完整步骤（以新增 `canvas copy` 为例）

1. **确认分层**：这个命令是纯转发（新 server 端点/参数）、还是 CLI 本地逻辑（文件/输出）？业务语义变化要动 server（`apps/server/src/utils/canvas/`），同步 MCP 与页面——CLI 只跟进步。本文只覆盖 CLI 侧。
2. **core 模块实现**：在对应域文件（如 `core/canvas.py`）写 `cmdCanvasCopy(obj, ...)`：
   - 入参第一位是 `obj`（ctx.obj：`{"json", "workspace", "canvas"}`）；
   - 复用 `client.request / canvasOperation / getCanvasState / workspaceOf / emit` 与 `canvas.findNode`；
   - 报错一律 `raise CliError(message, exitCodes.xxx, hint)`；成功走 `emit(data, obj, humanFn)`（两种输出都要写）。
3. **Click 注册**（`toonflow_cli.py`）：`@canvas.command("copy")` + `click.option/argument` + `@click.pass_obj`。选项名用小驼峰变量（click 自动把 `--auto-submit` 转成 `auto_submit`）。
4. **help 文本即文档**（见第 2 节规范）——agent 靠它自学。
5. **selfcheck 补断言**（`selfcheck.py`）：层 2 加 `help 渲染` + `参数契约`（新命令的关键选项）；若属用户旅程关键环节，层 3 冒烟加真实执行断言。**不补断言的命令等于没有回归保护**。
6. **技能速查表同步**：`packages/skills/toonflowCli/SKILL.md` 命令表加行，并 **cp 一份到 `packages/cli/agent-harness/cli_tdd/toonflow/skills/SKILL.md`**（打包副本，双处必须一致，漏同步是高频事故）。
7. **CHANGELOG 加段 + setup.py 升版本**（修复 +0.0.1 / 新增能力 +0.1.0 / 不兼容 +1.0.0），按 release.md 发布。
8. **验证**：`python packages/cli/agent-harness/selfcheck.py`（dev server 在跑时全量）→ 手动跑一次新命令的 human 与 `--json` 两种输出。

## 2. help 文本规范（自发现三原则）

agent 的使用路径是 `tdd --help` → `tdd canvas` → `tdd canvas copy --help` → （如有输入文件）`--schema`。每层都要能"指路到下一层"：

- **根层组描述**：场景动词式并列子命令关键词，如 `"""画布：import 导入分镜建图 · list/get 现状 · report 体检排障 · fit 视口适配截图。"""`——不要只写"画布操作"这类名词。
- **组无参直接展示组 help**：所有组用 `invoke_without_command=True` + `if ctx.invoked_subcommand is None: click.echo(ctx.get_help())`，退出 0（不要让 agent 猜 `--help`）。
- **子命令 docstring**：动宾开头说明用途；参数语义写进 option 的 help；用法错误时 `CliError` 带 `hint` 指向下一步（如"先 --schema 看示例"）。
- **复杂输入自描述**：像 `canvas import --schema` 那样，输出**示例 + 字段说明**；坏输入由 CLI 前置校验拦下并给中文指引（`canvas.validateStoryboard` 模式），不要把 server 的 Zod 英文 JSON 直接砸给 agent。
- **docstring 多行原样段落**：Click 只在 docstring 支持 `\b` 段落保护（epilog 不支持）；docstring 不能用字符串拼接表达式（不会成为 `__doc__`）。

## 3. 陷阱清单（血泪教训，改前必读）

1. **全局选项必须前置**：`tdd --json queue status` ✓ / `tdd queue status --json` ✗。写测试或调用代码时最容易犯（连开发者都连续踩过两次）。main() 已对 `-w`/`--workspace` 误用给定向 hint。
2. **None 不要进请求 body**：Python `None` → JSON `null`，server Zod 拒绝；条件写入（`if value: body["k"] = value`）。
3. **settings 层级**：`GET /api/settings/get` 的 `data` 就是 settings 本身，**不是** `data.settings`——取错层会让 `config set` 的全量覆盖保存清空用户全部配置（真实事故过）。
4. **必须带 `Origin` 头**：`client.request` 已统一加；新写 fetch 代码漏了会被 server 403（"只允许 Toonflow 页面访问控制连接"）。
5. **`config set` 值类型**：走 `coerceValue`（"false"→False、"42"→42），直接存字符串会让 server 的 `!== false` 类判断失效。
6. **cliRoot 层级**：源码（`packages/cli/agent-harness/...`）比桌面（`<安装根>/cli/agent-harness/...`）多一级目录，不能按固定层级取根——现实现是从 `cli` 目录向上**逐级**找 `package.json`（源码）或 `views`（桌面）特征；也不能无限向上找特征（嵌在仓库里的 venv 会误命中仓库根）。
7. **Windows 自更新文件锁**：运行中的 `tdd.exe` 不能被 pip 覆盖，Git Bash/MSYS 持句柄时连 rename 都被拒——`install.runUpdate` 的兜底链：改名让路（能过则同步装）→ 失败则 spawn 独立 python 延迟 1.5s 安装（异步，`tdd --version` 验证）。
8. **editable 元数据陈旧**：源码态 `pip install -e` 后改 `setup.py` 版本，`tdd --version` 读到的还是旧 egg-info——`python -m pip install -e . --force-reinstall --no-deps` 刷新。
9. **zip 内容不能明文 replace**：在 zip 的 deflate 压缩字节里 `replace(b'version="1.0"', ...)` 永远替换不到——构造测试 zip 要解压改文件再重打包（`zipfile.writestr`）。
10. **Gitee 对 pip UA 403**（curl/urllib 可过）：涉及安装的文案/代码一律"curl 下载 + 本地 pip install"。
11. **Git Bash 验证坑**：`cmd | tail; echo $?` 取的是 tail 的退出码（验证退出码不要接管道）；`/tmp` 是 MSYS 虚拟路径，Windows 原生 python 看不到（用真实路径）；heredoc 会吃 `\n` 转义（复杂文本用 Edit 工具或 python `chr()`）。
12. **技能双副本**：`packages/skills/toonflowCli/SKILL.md`（源）与 `packages/cli/agent-harness/cli_tdd/toonflow/skills/SKILL.md`（打包副本）必须同步 cp。
13. **`queue status --watch` / `canvas report` 的 json 模式不返回退出码 5**（提前 return 的历史行为），新增类似"完成但有失败"语义的命令时明确选一种并在 help 里写清。
14. **改页面 canvasMenu 的 canvases 时先重绑 boundCanvas**：`canvases` 是 inject 的 ShallowRef 且有 `watch(canvases, …, { flush: "sync" })` 依据 `includes(boundCanvas)` 维护 activeCanvasId（defineModel 双向绑定到父面板）——直接整体替换数组会让旧引用失配 → activeCanvasId 置空 → 父面板重载、工具栏闪断。替换前先把 boundCanvas 指到新数组中同 id 对象（见 canvasMenu 的 canvasListVisible watch）。

## 4. 常用本地验证方法

- 全量自检：`python packages/cli/agent-harness/selfcheck.py`（需 dev server + mockProvider）；`--offline` 只跑层 1+2。
- 手动命令：源码态直接 `tdd …`（本机 editable 安装后）或 `python -m cli_tdd.toonflow …`（无需 PATH）。
- 测 update 类（发行态专属逻辑）：建独立 venv + 本地模拟中心（目录放 manifest.json 与 dist/cli 结构 + `python -m http.server`，`--mirror http://127.0.0.1:<port>` 指过去）——源码态会走"跳过自更新"分支，测不到安装路径。
- 测桌面安装根场景：临时目录造 `views/` + `cli/agent-harness/` 结构后 pip install -e，验证数据落 `数据根/data/`。
