# 常见错误对照（按报错关键词自愈）

## inspect 拒绝（parseProvider 校验）

| 报错关键词 | 原因 | 处理 |
| --- | --- | --- |
| `TypeScript 语法错误` | 语法/类型标注写错 | 按报错行号修复 |
| `export default 导出对象` | 导出了变量或表达式 | 改为直接导出对象字面量 |
| `必须直接使用字面量` / `仅支持 JSON 字面量` | id/label/readme/modelsUrl/models 引用了变量或用了展开 | 内联为字面量（仅 version 可引用顶层 const） |
| `供应商 ID 必须为小驼峰` | id 格式非法 | 改 id 并同步改文件名 |
| `供应商 ID 与文件名不一致` | 文件名 ≠ `<id>.ts` | 重命名文件 |
| `模型 ID 不能重复` / `缺少 type` | models 数组问题 | 修 models |
| `供应商文件不能超过 2 MB` | 文件过大 | 拆分/精简 |

## import 冲突

| 报错 | 处理 |
| --- | --- |
| `已安装…请在「设置 → 媒体模型」中编辑`（退出码 3） | 确认要替换：`tdd provider delete <id> --yes` 后重新 import；只想改模型列表用 `provider models <id> --refresh` |

## models --refresh 失败

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `供应商未配置 modelsUrl` | .ts 没写 modelsUrl | 手工维护 models（providerSpec.md 模型字段），或加 modelsUrl 后 delete+import |
| `获取媒体模型列表失败（HTTP 401/403）` | apiKey 无效或过期 | 让用户检查/更换 key（提供获取地址）后重新 config |
| `获取…（HTTP 404/其他）` | modelsUrl 写错 | 对照上游文档修 URL |
| `未获取到媒体模型` | 上游返回空列表 | 正常现象：模型确实没了；确认后手工维护 models |

## dryrun / test 失败

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `mock_unmatched`（日志里 404） | 代码请求了样例未覆盖的地址 | 看日志该请求 URL，在样例文件补对应条目重跑 |
| 日志 401/403（真测） | 鉴权头/key 错误 | 核对 `authorization` 头形态与 key 值；key 问题走停点 2 |
| 日志 400/422（真测） | 请求体字段/单位不匹配上游 | 对照上游文档修构造入参（dryrun 先验证再真测） |
| 日志 5xx（真测） | 上游故障 | 稍后重试；持续失败让用户查供应商状态 |
| `模型已变更，请重新选择模型` | --model 不在该供应商 models 里 | `inspect` 看正确模型 id |
| `供应商没有实现此模型的媒体生成方法` | image/video 模型但没实现对应 generate 方法 | 补实现或删该模型 |
| `供应商未返回媒体数组` / `媒体类型与模型不一致` | 解析结果逻辑错误 | dryrun + 样例调试解析代码；确认返回 MediaAsset[] 且 mediaType 与模型 type 一致 |
| `媒体结果需要 HTTP 或 HTTPS 地址` | 返回了相对路径/data URI | 拼完整 URL 或改用 base64/binary 返回 |
| `媒体编码或 MIME 类型无效` | base64 脏数据或 mimeType 不对 | mimeType 须如 `image/png`、`video/mp4` |
| 超时 | 上游卡死或轮询未联动 signal | 轮询加间隔与 `signal.throwIfAborted()` |

## 闸门拒绝（不是错误，是设计）

| 报错 | 处理 |
| --- | --- |
| `拒绝执行：将真实调用…会产生实际费用`（test 缺 --yes） | 走费用红线流程拿到用户明确同意后再加 --yes |
| `拒绝执行：将删除供应商…`（delete 缺 --yes） | 确认用户要删再加 --yes |

## 环境类

| 报错 | 处理 |
| --- | --- |
| `无法连接 Toonflow server`（退出码 6） | 提醒用户启动 Toonflow；`tdd status` 自检 |
| `tdd: provider 组不存在` | CLI < 1.11.0：`tdd update --check` → 用户确认 → `tdd update` |
| `读取供应商文件失败` | 路径/编码问题：确认 UTF-8 与路径正确 |
