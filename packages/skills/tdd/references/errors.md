# 常见错误清单（对照自愈）

按报错关键词查找；每条含原因与处理。

## 环境

| 报错/现象 | 原因 | 处理 |
| --- | --- | --- |
| `tdd: command not found` | 未安装或不在 PATH | 按 environment.md 安装；已装则看 PATH 一节（pyenv/venv 常见） |
| pip 装 CLI 报 `403 Forbidden`（Gitee） | Gitee 拒绝 pip 的 User-Agent | 一律 curl 下载 zip 后 `python -m pip install <本地zip>` |
| `tdd` 更新后版本没变 | Windows 运行中 exe 锁，后台延迟安装约 5 秒 | 等待后 `tdd --version` 验证；仍失败按 hint 手动 pip 命令 |
| `tdd --version` 显示旧版本（源码环境） | editable 元数据陈旧 | `python -m pip install -e . --force-reinstall --no-deps` 刷新 |

## 连接与权限

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `无法连接 Toonflow server`（退 6） | Toonflow 未启动 | 提醒用户启动 Toonflow（桌面应用或 `bun run dev`）后重试 |
| `只允许 Toonflow 页面访问控制连接`（config 命令 403） | 请求缺同源 Origin 头 | 使用 1.6.0+ 的 CLI（已内置）；确认版本后 update |
| `localhost` 连不上 | 部分环境 localhost 解析异常 | 地址一律用 `127.0.0.1` |

## 画布与导入

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `画布不存在: 画布2.json`（退 4） | --canvas 指向不存在的画布 | `canvas list` 查看；`canvas create` 新建；或 import 加 `--new-canvas` |
| `画布已存在：…-<时间戳>.json` | 同秒两次同名创建（极罕见） | 换名重试 |
| `视频模型 … 最大支持 N 张图片参考，以下分镜超出` | cast 数量超模型参考上限 | 减 cast、换支持多参考的模型，或拆分镜 |
| `当前模型不支持时长 X` | duration 不在模型 durationResolutionMap | `tdd models` 查可选项后调整 |
| import 输出 `差异 N（默认跳过）` | 同名项与存量参数不一致（非错误） | 看差异明细：改存量（`node set`）后重试，或 `--force-add` 追加，或确认存量即所要直接沿用 |
| Zod 英文 JSON 数组报错（import） | 分镜 JSON 结构不符 | `tdd canvas import --schema` 对照修正（CLI 已前置校验，穿透说明结构特殊） |

## 队列与生成

| 报错/现象 | 原因 | 处理 |
| --- | --- | --- |
| `queue status --watch` 退 5 | 存在 failed/skipped 任务 | 输出列出的任务用 `queue logs <id>` 看原文；修正后 `queue retry` |
| 任务 `skipped`（重试 3 次后） | 连续失败 | `queue logs` 看原因（常见：提示词被拒、凭证无效）；`node set` 修改后 `queue retry --set` |
| 下游分镜不生成 | 上游资产未成功（级联跳过） | `canvas report` 看上游 error 项，先修上游 |
| server 重启后队列为空 | 内存队列清空（设计如此） | `queue submit`（missing）幂等重建，已成功且产物在盘的自动跳过 |
| `watch` 输出"队列为空，无任务可等待" | 没有可做任务 | 全部已完成（missing 语义）或忘记 submit |

## 人机共存

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `画布已被其他端修改`（退 3，409） | 页面/另一 agent 先保存 | `canvas get` 重读最新画布再重试修改 |
| `canvas fit` 报需要页面 | 无页面连接（视口是页面动作） | 用宿主内嵌浏览器打开页面后重试；不需要截图可忽略 |
