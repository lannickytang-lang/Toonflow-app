# 打包发布与版本管理指南

## 1. 发布流程（一条链）

```
改代码（含 selfcheck 断言 + 技能双副本同步）
  → packages/cli/agent-harness/CHANGELOG.md 补当前版本段
  → setup.py 升版本
  → cd tudodo-center && python scripts/sync.py --publish
       ├─ 先跑 selfcheck.py 三层自检（失败即拒绝发布，不产出任何文件）
       ├─ 打包 zip（排除 egg-info/__pycache__）
       ├─ 产出中心文件（见下）+ git add/commit/push 中心仓库
  → 主仓库 git commit/push
```

- `--no-push`：只 commit 中心不推送；`--skip-smoke`：只跑层 1+2 自检（极端逃生口，跳过需 dev server 的冒烟层）。
- `--check`：只对比漂移不写入（也不触发自检）。
- 发布前置条件：dev server 在跑（默认 `http://127.0.0.1:3000`，可用 selfcheck 的 `--server` 语义对应 sync 内部调用默认值）——冒烟层需要 mockProvider。

## 2. 中心产物与版本管理规则

```
tudodo-center/dist/cli/
  cli-tdd-toonflow.zip        ← 固定最新（引导语 curl 安装的稳定入口，每次发布覆盖）
  versions.json                ← 历史索引（降序：version/date/notes/file）
  1.3.0/
    cli-tdd-toonflow.zip      ← 版本存档（不可变：同版本重发布不覆盖）
    notes.md                  ← 版本说明（头部含"> 发布日期"，允许修正但保留原日期）
  1.2.0/ …
```

- **CHANGELOG.md 是版本说明唯一源**：sync.py 发布时切出 `## <当前版本>` 段写入 notes.md，并扫描所有版本目录聚合 versions.json；**CHANGELOG 缺当前版本段直接拒绝发布**（空说明版本禁止流出）。
- manifest.json 的 `cli[0]` = `{name, version, file: dist/cli/<版本>/cli-tdd-toonflow.zip, description}`——`tdd update` 的默认升级路径。
- 版本号规则：修复 +0.0.1 / 新增能力 +0.1.0 / 不兼容 +1.0.0。

## 3. 分发链路全景（用户/agent 从哪拿到 CLI）

| 链路 | 路径 | 说明 |
| --- | --- | --- |
| 任意机器（主路径） | `curl -L -o cli-tdd-toonflow.zip https://gitee.com/comtudodo/tudodo-center/raw/master/dist/cli/cli-tdd-toonflow.zip && python -m pip install cli-tdd-toonflow.zip` | 引导语/技能/中心 AGENTS.md 统一此文案（Gitee 对 pip 直链 403，必须先 curl） |
| 桌面安装版 | `python -m pip install -e <安装根>/cli/agent-harness` | electrobun.config.ts copy 源码目录进安装根（win/mac 同一份，约几十 KB） |
| 源码开发 | `python -m pip install -e <仓库>/packages/cli/agent-harness` | 仅开发自用，不进引导语 |
| 自更新 | `tdd update`（manifest 比对）/ `tdd update --version X.Y.Z`（可降级）/ `tdd update --list`（历史+说明） | 详见 architecture.md 陷阱 #7 |

配套触点（改 CLI 行为时检查是否需要同步）：

- **引导语**：`apps/server/src/routes/agentGuide/get.ts`（server 动态生成，含 python 自装指引）；
- **技能**：`packages/skills/toonflowCli/SKILL.md`（版本号 frontmatter，中心 sync.py 的 SKILLS 配置区维护发布版本）+ 打包副本；
- **桌面打包**：`electrobun.config.ts` 的 `packages/cli/agent-harness → cli/agent-harness` copy 条目。

## 4. selfcheck 自检门禁（维护要求）

三层 74 项（`packages/cli/agent-harness/selfcheck.py`）：

1. **层 1 静态**：.py 全部语法编译、setup.py 包名/版本/入口约定、技能副本存在、CHANGELOG 当前版本段；
2. **层 2 离线命令级**：help 全树渲染（根/5 组/全部子命令）、组无参展示 help、11 组参数契约、纯函数断言（versionTuple/coerceValue/validateStoryboard/cliRoot/schema 示例）、离线退出码（未知命令 2、server 不可达 6）；
3. **层 3 真实冒烟**（dev server + mockProvider）：临时工作区完整旅程——status/models/project open（记忆生效）→ import --auto-submit → watch 全成功 → report 零异常 → node get/set/cast/retry（label 解析）→ export --verify 落盘 → 退出码抽检（4/3）。工作区自动清理、开发者记忆备份还原。

**维护纪律**：新命令必须补层 2 断言（help+参数契约）；用户旅程级改动补层 3。断言挂了先修代码再发布——它抓出过 cliRoot 层级 bug 这类真实缺陷。

## 5. 历史版本

| 版本 | 要点 |
| --- | --- |
| 1.3.0 | 发布自检门禁 selfcheck.py；修复 cliRoot 层级 bug |
| 1.2.0 | 版本目录化（dist/cli/<版本>/ + versions.json + update --list） |
| 1.1.0 | tdd update 自更新 + --version（Windows exe 锁双兜底） |
| 1.0.x | Python 版首航：22 命令对齐、场景审视修复（retry label/config 类型/import 校验）、help 三层自发现 |

明细见 `CHANGELOG.md`；bun 编译版时代记录见 `.omc/specs/toonflowCliReference.md`。
