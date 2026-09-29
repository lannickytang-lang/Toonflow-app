# Changelog

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
