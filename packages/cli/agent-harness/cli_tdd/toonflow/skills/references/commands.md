# tdd 命令文档

## 调用契约

```
tdd [全局选项] <组> <命令> [参数]
```

- 全局选项必须写在子命令之前：`--json`（结构化输出）、`-w/--workspace <目录>`（或环境变量 `TOONFLOW_WORKSPACE`）、`--canvas <画布id>`（省略 .json 自动补全；对 canvas/node/queue 组生效；queue 的 submit/status/export 支持逗号分隔多块）、`--server <url>`（默认 `http://127.0.0.1:3000`）。
- 工作区解析优先级：`-w` 参数 → 环境变量 → `project open` 记忆缓存。
- 报错两行制：`error: <信息>` + `hint: <自愈建议>`。

## 退出码总表

| 码 | 含义 | 处理 |
| --- | --- | --- |
| 0 | 成功（含"已是最新"等幂等结果） | — |
| 2 | 参数/请求错误 | 看 hint 修正 |
| 3 | 画布版本冲突（409） | `canvas get` 重读最新再操作 |
| 4 | 目标不存在（404） | `canvas list`/`canvas get` 查最新 ID |
| 5 | 完成但存在失败 | `queue logs` 看原因 |
| 6 | server 未运行 | 提醒用户启动 Toonflow |

## 环境与配置

- `tdd status`：server 在线 / 项目数 / 默认工作区 / PATH 自检。
- `tdd models [--type image|video]`：输出 `providerId/modelId`，供 import 的 options 与 `node set --model` 使用。
- `tdd config set <点路径> <值>`：值自动类型推断（`true/false`→布尔、数字字符串→数字）。例：`config set mediaProviderConfigs.grsai.ts <apiKey>`。`config get <点路径>` 读取。
- `tdd install [--hosts 目录] [--force]`：宿主技能 + Toonflow 侧插件（幂等）。
- `tdd update [--check] [--version X.Y.Z] [--list]`：见 environment.md。

## 项目与画布

- `project open <绝对目录>`：不存在自动创建并记住为默认工作区。
- `canvas list`：id（如 `画布2.json`）/ 节点数 / 边数 / revision。
- `canvas get [--nodes]`：摘要（类型/状态计数）；`--nodes` 附节点表。
- `canvas create [名称]`：新建空画布；同名自动加年月日时分秒后缀。
- `canvas report [--explain]`：画布体检——异常检测（未配置模型/无提示词/历史失败/产物缺失/上游阻塞，每条带建议）+ 节点表（含参数列 `6s/9:16/480P`）。
- `canvas fit [--nodes id1,id2]`：让已打开的页面适配视口（需页面在线，配合浏览器截图；节点多用 --nodes 分组逐区截图）。

## 导入分镜（幂等）

分镜 JSON 结构（`tdd canvas import --schema` 看完整示例与字段说明）：

```json
{ "assets": [{"name": "主角", "imagePrompt": "…"}],
  "scenes": [{"sortNum": 1, "videoPrompt": "…", "cast": ["主角"], "duration": 3}],
  "options": {"imageModel": {"providerId": "p", "modelId": "i"}, "videoModel": {…}, "resolution": "480P"} }
```

- `tdd canvas import 分镜.json [--auto-submit]`：与存量同 label 且参数一致（提示词/模型/时长/分辨率/cast）的资产/分镜自动跳过——重跑同任务零副作用；同名不一致默认跳过并在输出列出差异明细。
- `--check`：干跑只出比对报告（一致/差异/新建 + 明细），不动画布。
- `--force-add`：差异项仍追加新节点（默认跳过；想改存量用 `node set` 后重试）。
- `--new-canvas [名称]`：先建新画布再导入（多轮任务各用一块画布）。
- `--auto-submit`：导入后提交 missing 队列（全跳过时也会补提未完成——重复任务重跑即恢复）。

## 节点操作

节点寻址统一支持 完整 id / id 前缀 / label（如 `分镜1`、资产名）。

- `node list [--type …] [--status …]`
- `node get <节点>`
- `node set <节点> [--prompt …] [--model p/m] [--duration N] [--resolution R] [--ratio R] [--size S]`（duration/resolution 仅视频节点）
- `node cast <分镜> --assets <资产1,资产2>`：整组替换出镜连线。

## 队列（批量生成 / 挂机 / 交付）

- `queue submit [--scope missing|all] [--nodes id…] [--concurrency N] [--canvas a,b]`：missing=只补未完成（断点重建默认）。
- `queue status [--watch] [--interval 秒]`：watch 挂机到终态（有失败退 5；空队列立即退出）。
- `queue logs <taskId> [--tail N]`：任务日志与失败原因原文。
- `queue retry <节点…> [--set fix.json]`：先应用修改（如 `{"prompt":"…"}`）再重提。
- `queue cancel <taskId|nodeId|--all>`。
- `queue export [--format md|json|csv] [--output 文件] [--verify] [--canvas a,b]`：产物清单（md 含画布列与产物根目录行）；`--verify` 逐产物 stat 校验落盘，缺失退 5；完成消息输出**绝对路径**（相对路径基于终端当前目录，非工作区）。
