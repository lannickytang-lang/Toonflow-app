# 环境配置（安装 / 更新 / PATH）

## 前置：python 自检

```bash
python --version        # Windows 也可 py -3 --version；macOS 可用 python3 --version
```

不可用时先装：Windows `winget install Python.Python.3.12`；macOS `brew install python3`（或 `xcode-select --install`）。装好重开终端再继续。

## 安装 CLI（标准路径）

Gitee 对 pip 直链返回 403，必须先 curl 下载再本地安装：

```bash
curl -L -o cli-tdd-toonflow.zip https://gitee.com/comtudodo/tudodo-center/raw/master/dist/cli/cli-tdd-toonflow.zip && python -m pip install cli-tdd-toonflow.zip
```

装好即全局命令 `tdd`。无需 pip 安装的直跑方式：`python -m cli_tdd.toonflow <命令>`（不需要 PATH）。

其他形态（仅开发/桌面环境）：本地源码 `python -m pip install -e <路径>/agent-harness`。

## 更新体系

| 命令 | 行为 |
| --- | --- |
| `tdd --version` | 当前版本（纯本地） |
| `tdd update --check` | 干跑检查：输出"当前 X → 远端 Y"；有新版经用户确认后 `tdd update`；网络失败不阻塞任务 |
| `tdd update` | 升级到最新（Windows 下运行中的 tdd.exe 由后台延迟安装替换，约 5 秒后 `tdd --version` 验证） |
| `tdd update --version 1.6.0` | 安装指定历史版本（可降级） |
| `tdd update --list` | 列出全部历史版本与变更说明 |

## PATH 问题（命令装了却 not found）

常见于 pyenv / venv：包装进了对应 Python 的 bin/Scripts 目录而不在默认 PATH。

1. `tdd status` 会自检并输出实际安装目录、临时方案与**永久修复命令**（可直接转达用户执行后重开终端：macOS/Linux `echo 'export PATH="<目录>:$PATH"' >> ~/.zshrc`；Windows `setx PATH "%PATH%;<目录>"`）；
2. agent 的每次 Bash 是独立子进程，export 不跨命令持久——要么每条命令加前缀，要么让用户执行一次永久修复。

## 源码/开发环境说明

从源码运行（`pip install -e`）时 `tdd update` 会提示跳过（避免 zip 覆盖开发态）；更新方式为 `git pull` 后 `python -m pip install -e . --force-reinstall --no-deps`。改过 setup.py 版本后 `tdd --version` 显示旧值属 editable 元数据陈旧，同样用该命令刷新。
