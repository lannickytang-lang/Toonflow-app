# Changelog

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
