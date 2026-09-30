# 插件运行全流程（源码 → 安装 → 加载 → 生成 → 调试）

链路中的权威文件与函数索引，改动任何一环前先读对应实现。

## 1. 源码层

- 官方供应商唯一源：`packages/providers/src/media/`（tfRouter/grsai/apiMart/mockProvider/meta）；类型契约：`packages/providers/types.d.ts`（ambient，无 runtime 代码）。
- 用户自定义供应商：本地开发的 `.ts` 文件，安装后落 `data/providers/<id>.ts`（源码态即仓库根 `data/`，桌面为安装目录 `data/`——由 `apps/server/src/utils/conf/index.ts` 的 TOONFLOW_DATA_DIR 决定）。
- 首启自动安装白名单：`apps/server/src/app.ts` 的 `autoInstallProviders`；补装逻辑 `apps/server/src/utils/plugins/initialize.ts`（已存在跳过，不随版本覆盖）。

## 2. 安装与校验（`apps/server/src/utils/media/provider.ts`）

- `parseProvider(source)`：唯一裁判。2MB 上限 → @babel/parser 语法校验 → 要求 `export default` 直接导出对象字面量 → `id/label/version/readme/modelsUrl/models` 必须字面量（**仅 version 可引用顶层 const 字符串**）→ id 小驼峰 ≤96（排除 con/prn 等保留名）→ models 走 `mediaModelsSchema`（≤2000、id 不重复）→ 文件名必须等于 `<id>.ts`。
- `addMediaProvider`：写入 `data/providers/`，EEXIST → 409"已安装"。
- `saveMediaProvider`：只替换源码中 models 的 **AST 区间**，保留用户函数编辑；revision（sha256）乐观锁。
- `deleteMediaProvider`：unlink + **连带删除 `settings.mediaProviderConfigs.<id>`**（技能已预警，CLI delete 输出提示）。
- `refreshMediaProviderModels`：用已配 apiKey Bearer 拉 modelsUrl（30s 超时），`{data:[{id,type?,label?}]` 解析后**整体替换**同 type 的本地 models——全量中转站不要配 modelsUrl（会灌入几百聊天模型），见 writePlugin 陷阱 6。

## 3. 加载与执行（每次生成按需即时加载，无缓存）

`loadMediaProviderSource(source, config, signal, fetchRequest, cwd)`（provider.ts:274）：
1. `Bun.Transpiler({loader:"ts"})` 转译 → `node:vm` `SourceTextModule` + `createContext`（注入 Buffer/URL/AbortController/Bun/process/require，`codeGeneration:{strings:false}`）；
2. `module.evaluate({timeout:1000})` 取 default 导出；
3. rules 默认值与 config 合并为 `this.config`；注入 `this.tool`（fetch 绑定 signal/超时、hash=Bun.hash、image=Bun.Image、audio.convert、按 cwd 的 ffmpeg）。
- 权限边界：vm 只隔离模块作用域，**与宿主同权限**；可 require node: 内置与 server 已装依赖；禁止相对路径导入；模块体内动态 import 不可用（运行时取模块用 require）。
- 改文件即生效（下次调用读新源码）；供应商目录/文件不能是符号链接。

## 4. 凭证与配置

- 存 `settings.json` 的 `settings.mediaProviderConfigs.<id>.apiKey`；`getMediaProviderApiKey` 自动 strip `Bearer` 前缀。
- 写入通道：Web 设置页、`tdd provider config <id> --set apiKey=…`（回显打码）、MCP updateSettings、`tdd config set` 点路径。
- 生成时 rules 声明了 apiKey 但配置为空 → 400"请先配置供应商 API Key"。

## 5. 生成消费链路（画布节点 → 供应商方法）

1. 生成节点模型下拉数据来自 `GET /api/ai/media/models`（节点 data.model 存 `JSON.stringify([providerId, modelId])`）。
2. 生成走 `POST /api/ai/media/generate` → `apps/server/src/utils/media/generation.ts` `generateMedia(cwd, type, request, signal)` → `getMediaProvider(id)` 读源码 → `loadMediaProviderSource` → 按 model.type 路由 `generateImage/generateVideo/generateAudio`。
3. 返回校验：非空 MediaAsset[]、mediaType 与模型一致、url 须 http(s)、base64/binary 编码与 MIME 合法（mimeType 须以 `{类型}/` 开头）→ 下载 url 结果（≤100MB）→ 写工作区 `assets/generated/`，失败回滚。
4. Agent 工具侧：`packages/tools/mediaGeneration`（ToolPlugin，运行时经 MediaContext 桥接同一 generateMedia——与画布同一执行面）。

## 6. 调试闭环（`apps/server/src/utils/media/debug.ts`）

- `inspectProviderSource`：只加载解析（vm evaluate），返回 id/label/rules/媒体 models——零费用静态校验（`POST /api/providers/debug/inspect`）。
- `runProviderSource`（`POST /api/providers/debug/run`，**NDJSON 流式**，30 分钟超时）：真实执行 generate 方法；fetch 包装为日志探针（≤200 条请求、16KB 响应截断、密钥字段打码——词边界正则，prompt_tokens 等计量字段不打码）；结果总量 ≤44MB base64。
- **mock 样例**（dryrun 底层，1.11.0 起）：body 传 `mock.samples[]`，每条 `{match?, method?, times=1, status=200, contentType, body}`——按 URL 子串 + 可选 method 匹配、按序消耗；未匹配返回可诊断 404 `mock_unmatched`；请求不出网。轮询协议用多条同 match 样例模拟"处理中→成功"。
- CLI 侧（`packages/cli/agent-harness/cli_tdd/toonflow/core/provider.py`）：`dryrun` 强制带 mock（承诺零出网）；`test` 真实调用需 `--yes`；两者**凭证自动回退**已装供应商配置（`--config` 仅临时覆盖）；参考素材 `--image/--audio/--first-frame/--last-frame`（URL 或本地路径转 base64）；连续同 method+url+status 的轮询日志折叠"连续 N 次"。
- 轻量连通验证：`provider probe [--url …]`（只读拉模型列表）；无列表接口平台用"查询不存在任务"法（鉴权错误 vs 业务错误）。

## 7. Web 端参照（与 CLI 平行的入口）

- 安装对话框：`apps/web/src/components/settings/panels/mediaModel/addCustomProviderDialog.vue`（文件导入/粘贴代码 → media/add → 写 settings）。
- 生成提示词：同目录 `providerPrompt.ts`（内嵌 types.d.ts `?raw` 全文 + 四阶段引导 + ComfyUI 专章）——面向无宿主 agent 用户，与本体系并存（技能规范是另一份事实源，后续统一路径见 spec）。
- 可视化调试：`…/developer/providerDebugDialog.vue`（inspect→run NDJSON 消费→安装，CLI dryrun/test 的 UI 对应物）。
