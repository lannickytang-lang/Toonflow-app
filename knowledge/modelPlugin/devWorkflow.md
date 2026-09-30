# 如何更改插件开发流程本身

插件开发体系由四层组成：技能（agent 行为规范）+ CLI（操作通道）+ server 调试通道（能力底座）+ 门禁与发布链。改任何一层都有固定入手点与验证义务。

## 体系地图与唯一源

| 层 | 唯一源 | 关键文件 |
| --- | --- | --- |
| 技能 tdd-dev | `packages/skills/tdd-dev/` | SKILL.md（意图路由/费用红线/三停点/七环节）+ references 四件（providerSpec/workflow/errors/environment） |
| CLI provider 组 | `packages/cli/agent-harness/` | `cli_tdd/toonflow/core/provider.py`（全部命令实现）+ `toonflow_cli.py`（注册） |
| server 调试通道 | `apps/server/src/utils/media/` | `debug.ts`（inspect/run/mock 样例/打码）+ `provider.ts`（parseProvider/loadMediaProviderSource） |
| 门禁 | `packages/cli/agent-harness/selfcheck.py` | 三层 146 项：静态（技能结构/副本一致/命令契约）→ 离线命令级 → 真实冒烟（provider 全流程） |
| 发布链 | `tudodo-center/scripts/sync.py` | SKILLS 登记技能版本；`--publish` 跑 selfcheck 后生成 dist + manifest 并提交推送 |

派生物（禁止直接改）：CLI 打包副本 `cli_tdd/toonflow/skills/tdd-dev/`（selfcheck 校验与源逐文件一致）；中心 `dist/` 与 `manifest.json`（sync.py 生成）。

## 改技能（最常见：调 agent 行为/流程话术）

1. 改 `packages/skills/tdd-dev/` 下对应文件；SKILL.md ≤160 行。
2. **同步打包副本**：删旧目录后 `cp -r packages/skills/tdd-dev packages/cli/agent-harness/cli_tdd/toonflow/skills/tdd-dev`（selfcheck"技能副本与源一致"是发布门禁，漏同步必被拦）。
3. 升 frontmatter version（修复 +0.0.1）+ `sync.py` SKILLS 同步登记。
4. 若新增了结构性内容（新节/新 references 文件），同步加 selfcheck 层1 断言（参照现有"停点 1 必停确认卡""字段契约修正"断言写法）。
5. 跑 selfcheck → sync.py --publish。

## 改 CLI 命令（provider 组）

1. `provider.py` 加/改实现 + `toonflow_cli.py` 注册（全局选项 `--json/--server` 前置；`-w/--canvas` 不参与 provider 组）。
2. 退出码契约保持：0 成功 / 2 参数与校验失败（含闸门拒绝）/ 3 冲突 409 / 4 不存在 / 6 server 未运行。计费与破坏性操作必须 `--yes` 闸门（不靠 agent 自觉）。
3. 升 `setup.py` version + `CHANGELOG.md` 加段（selfcheck 校验当前版本有段）。
4. selfcheck 补断言：commandTree/contractKeywords 加 help 契约，纯函数加层2 单测，有 server 交互的加层3 冒烟（探针供应商模板在同文件，可扩展——如参考素材透传分支的写法）。
5. 全量 `python selfcheck.py`（三层，需 dev server）→ publish。

## 改 server 调试通道（debug.ts / provider.ts）

1. 改后 `cd apps/server && bun run typecheck && bun run build`；只改现有路由内容不需要 `bun run routes`（无文件增删）。
2. mock 样例 schema 变更（如新增字段）要三处同步：`providerDebugMockSchema`、route 显式 parse（validateFields 只校验不写回）、CLI 样例构造（**缺省字段条件写入**——None 序列化成 null 会被 zod optional 拒绝，实测陷阱）。
3. CLI 冒烟会覆盖 inspect/dryrun（mock/test/凭证回退/method/参考素材）路径，改 server 行为后跑全量 selfcheck 即回归。

## 发布链与版本规则

- 技能与 CLI **独立版本**；一次批次可同时升（如技能 1.1.1 + CLI 1.11.2）。
- `sync.py --publish` 一条链：跑 selfcheck（offline 可 `--skip-smoke`）→ 生成 `dist/skills/tdd-dev.zip`、`dist/cli/<版本>/`（不可变存档）与 `versions.json` → git add/commit/push（**sync.py 自身的 SKILLS 改动要单独在中心仓库提交**，publish 不含 scripts/）。
- Gitee raw 有**分钟级 CDN 缓存**：publish 后远端 manifest 立即拉可能还是旧值，等 60–90s 复验再下结论。
- 安装红利：CLI `install` 是 manifest 驱动——中心新增/改名技能任意版本 CLI 自动跟随，install.py 零改动。

## UAT 方法论（验证流程改动的最强手段）

改完流程用**零上下文子代理真实接入测试**验证，规矩：

1. **非欺骗性**：子代理只给技能文件路径 + 用户资料（文档链接/密钥/真测授权声明），不给任何命令提示、不预扫障碍——它读不到 SKILL.md 之外的指引才算数。
2. **真实平台真实计费**：用户给密钥=授权真测；prompt 里限定最小调用次数、失败排查用零费用手段。
3. **阻塞点记录与接入同等重要**：要求按【第几步｜现象｜怎么解决｜责任在哪】逐条输出——"一次顺利"没有信息量，摩擦才是改进输入。
4. **旁证核验**：子代理自述不可全信——`tdd provider list` 核安装与凭证状态、只读查询任务接口、Range GET 验产物文件头（如 `ftyp isom`）。
5. 已跑两轮：yijiaApi（OpenAI 兼容型）13 条、autodlArt（ComfyUI 工作流型）14 条，全部闭环（修复/平台侧记录）——新流程改动建议继续此法回归。

## 与相邻体系的边界

- **Web 端 providerPrompt.ts** 与技能规范是两份并存的事实源（本期决策：Web 暂不动，统一路径备案在 `.omc/specs/deep-interview-tdd-dev.md`）——改 parseProvider 约束或 types.d.ts 时**两处都要检查同步**。
- 官方供应商源码收录（packages/providers → 中心 providers 段）走 `sync.py` 的 PROVIDERS 配置，与自定义插件的本地安装链路无关。
- 画布批量生产不是本体系职责（tdd-auto 技能）；本体系止于"供应商接入可用 + 节点可选到模型"。
