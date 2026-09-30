# Changelog

## 1.11.0
- 新增 provider 命令组（自定义媒体供应商开发接入，配套 tdd-dev 技能）：
  inspect 静态校验 / dryrun 零费用干跑（请求不出网，按样例响应验证入参构造与结果解析）/ import 安装 / config 凭证（回显打码）/ models 在线刷新 / test 真实调用（计费，缺 --yes 直接拒绝）/ delete 删除（缺 --yes 拒绝）
- server debug 通道支持 mock 样例响应（dryrun 底层；未匹配样例返回可诊断 404）
- 409 冲突提示区分供应商语境（先 delete 再 import）

## 1.10.0
- install 宿主技能名单改为中心 manifest 驱动（根治硬编码旧名 404：中心改名/增删技能任意版本 CLI 自动跟随）
- install 失败自愈：技能 zip 404 提示"CLI 版本过旧，tdd update 后重试"；宿主侧失败输出数据目录副本救急路径
- 引导语/技能：--hosts 直达自己的技能目录；status PATH 警告附永久修复命令（转达用户一次执行）

## 1.9.0
- 技能改名 tdd → tdd-auto（与 CLI 命令 tdd 一词一义；自动清理宿主 toonflowCli 与 tdd 旧目录）
- 首命令自动安装宿主技能（幂等标记，stderr 提示不污染 --json；网络失败下次重试）
- tdd update 顺带同步宿主技能
- 引导语精简为 3 条（进入路径 / 自足安装链 / 高风险确认）

## 1.8.1
- 分发物去内部信息：技能移除主仓库地址引用；api.md 头部去内部源码路径

## 1.8.0
- server 能力清单随包分发：新增 scripts/genApiDoc.ts 从 runtime.ts 权威生成技能内 references/api.md（16 个画布操作+参数字段），selfcheck 门禁校验不漂移——真实用户（exe/桌面）无需源码即可发现 CLI 未暴露的能力

## 1.7.2
- 技能 tdd 1.2.0：环境自检改为异常驱动（不再每次必做）；新增自学能力节（--help/--schema 自发现、按意图自行编排）；新增源码深挖节（本地/仓库源码定位、server 能力权威清单 runtime.ts、未暴露操作的 API 逃生通道）

## 1.7.1
- 技能 tdd 1.1.0：面向 /tdd <需求> 直调入口重构 SKILL.md——四步工作流（环境自检 → 意图路由带起手命令 → 参数检查 → 结构化收尾汇报）
- selfcheck 新增技能路由结构断言

## 1.7.0
- 新增 tdd update --check 干跑检查（输出当前/远端版本对比；网络失败不阻塞任务）
- 技能体系重构：新技能 tdd（渐进式加载：SKILL 速查层 + references 环境/命令/错误清单 + scenarios/ 每场景一文件）继任 toonflowCli，install 自动清理宿主旧目录
- 引导语极简化：装技能按技能干活，安装链仅作 tdd 不存在时兜底

## 1.6.0
- import 幂等化：与存量同 label 且参数一致的资产/分镜自动跳过（重跑同任务零副作用）；同名不一致默认跳过并报告差异明细
- 新增 import --check（干跑比对报告，不修改画布）与 --force-add（同名不一致仍追加新节点）
- 全跳过时 --auto-submit 仍执行 missing 提交（重复任务重跑即恢复未完成）
- 修复空队列时 queue status --watch 死循环（立即退出提示）
- canvas report 节点表新增参数列（时长/比例/分辨率/尺寸，如 6s/9:16/480P）
- queue export 完成消息输出绝对路径；清单头部标注产物根目录

## 1.5.0
- 多画布工作流：queue 的 submit/status/watch/export 支持 --canvas 逗号分隔多块画布（export 清单含画布列）
- server：画布同名创建自动追加年月日时分秒重试，不再直接报冲突

## 1.4.0
- 画布生命周期：新增 canvas create（指定名/自动编号）；import 支持 --new-canvas [名称] 建新画布导入
- import 目标透明化：显示目标画布与现有节点数，资产同名冲突警告；--canvas 指定不存在画布给出新建途径 hint
- --canvas 省略 .json 后缀自动补全；全局选项误用定向 hint 扩展到 --canvas/--json/--server
- status 自检 PATH：tdd 不在 PATH 时输出安装目录与 export 建议（pyenv/venv 场景）
- 页面修复：外部（CLI/MCP）新建的画布在画布切换器中实时可见（打开切换器时重扫）

## 1.3.0
- 发布自检门禁：新增 selfcheck.py 三层检查（静态/离线命令级/真实场景冒烟），sync.py 打包前强制全过
- 覆盖 help 全树、参数契约、纯函数断言与完整用户旅程（导入→生成→排障→交付）

## 1.2.0
- 版本管理目录化：中心 dist/cli/<版本>/ 独立存档（zip + notes.md），versions.json 提供历史索引
- 新增 tdd update --list 列出全部历史版本与说明；指定版本下载路径改为版本目录

## 1.1.0
- 新增 tdd update 自更新（manifest 比对升级；--version 指定版本，支持降级）
- 新增 tdd --version
- Windows 运行中 exe 锁：改名让路 + 延迟安装双兜底

## 1.0.3
- help 三层自发现优化：组描述场景动词化、组无子命令直接展示组 help、退出码/挂机流程段落保留原始换行

## 1.0.2
- queue retry 支持 id 前缀/label 解析，拒绝静默空提交
- config set 值类型推断（布尔/数字），修复 mcp.enabled false 失效
- canvas import 前置结构校验 + --schema 附字段说明
- 安装路径统一为中心 zip 远程优先

## 1.0.1
- -w 误用给定向 hint
- Gitee 对 pip 直链 403：兜底安装改为 curl 下载 + 本地安装

## 1.0.0
- 首个 Python 版 CLI（替代 bun 编译版）：22 命令语义对齐、退出码规范、install 一键安装
