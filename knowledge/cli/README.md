# Toonflow CLI（命令 tdd）知识库导读

面向后续接手的 AI（或人）：快速理解 CLI 全貌、准确修改命令、安全打包发布。四份文档按目的索引：

| 我想… | 读哪份 |
| --- | --- |
| 理解 CLI 是什么、怎么运转、代码在哪 | [architecture.md](architecture.md) |
| 新增/修改一个命令 | [addCommand.md](addCommand.md)（含必读陷阱清单） |
| 打包发布新版本、版本管理规则 | [release.md](release.md) |
| 排查用户/agent 报告的 CLI 问题 | architecture.md 的「命令面与退出码」+ addCommand.md 的「陷阱清单」 |

## 30 秒速览

- CLI 是**纯门面**：所有命令转发本机 Toonflow server 的 HTTP 接口（默认 `http://127.0.0.1:47392`），画布/队列业务逻辑全在 server 端——CLI 进程内没有任何业务状态。
- 唯一源码在 `packages/cli/agent-harness/`（Python 3.10+ / Click ≥8，包名 `cli-tdd-toonflow`，命名空间 `cli_tdd`，全局命令 `tdd`）。
- 发布一条链：`tudodo-center/scripts/sync.py --publish`，打包前强制过 `selfcheck.py` 三层 74 项自检；版本说明唯一源是 `CHANGELOG.md`，中心按 `dist/cli/<版本>/` 目录存档并聚合 `versions.json`。
- 服务对象是**外部 AI agent**（ZCode/Claude Code/Codex…），它们靠 `--help` 逐层自发现命令——每层 help 文本都是文档，改动需维护其自解释性。

## 历史与过程记录（按需查阅）

- bun 编译版时代的基线快照与重写决策：`.omc/specs/toonflowCliReference.md`、`.omc/plans/pythonCliRewrite.md`
- 版本变更明细：`packages/cli/agent-harness/CHANGELOG.md`
