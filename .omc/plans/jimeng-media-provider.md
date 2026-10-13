# 实施方案：即梦媒体供应商（jimeng.ts，CDP 浏览器自动化双模式）

> 需求规格：`.omc/specs/deep-interview-jimeng-media-provider.md`（deep-interview 6 轮，模糊度 15.4%）
> 逆向依据：`docs/插件/jimeng2apiTechnicalReview.md`（jimeng2api 函数级蓝图）
> 本文档 = 调研计划 + 技术设计 + 实施步骤，供批准后执行。

---

## 0. 已拍板的决策（访谈结论）

| 决策点 | 结论 |
| --- | --- |
| 技术路线 | 零依赖 CDP 直连：`Bun.spawn` 启动浏览器 + 原生 WebSocket + `Runtime.evaluate` 页内 fetch；**不引入 playwright，provider 目标零第三方 import** |
| 签名 | a_bogus 永远由即梦页面自带 bdms SDK 自动注入（页内 fetch 是唯一请求通道），不自研算法 |
| 模式暴露 | provider 配置 `submitMode` 下拉（normal/canvas，jimeng2api 原样）；models 数组声明全量模型（各自带比例/时长/参考图能力） |
| canvas 实现路线 | **octo 结构化节点 API**（project/create → node_generate → resource/batch_get 轮询取产物），不经 AI 对话——用户明确要"稳定的手动节点形式"，Phase A 抓包已验证完整链路；AI 对话式仅留作后续兜底研究 |
| 视频边界 | generateVideo 完整实现但**不真测**（dryrun 级验证）；验收只看生图 |
| 验收 | 两模式 × seedream4.1 各 1 张生图，流程完整正确（提交→轮询→下载→MediaAsset 落盘）；代码交付完整（全量模型清单） |
| 调研协作 | 用户默认 Chrome 已登录即梦；CDP 原型脚本连接抓包，后续可自行连接补充 |
| 多账号并行 | 本期延后，架构预留（会话管理器按 browserPath+userDataDir+port 键化） |

---

## 1. 总体架构

```
┌─ Toonflow 画布/队列 ────────────────────────────────────────────┐
│  节点选模型(seedream-4.1) → queue.runTask → generateMedia()      │
│        │ AbortController(signal)                                │
└────────┼────────────────────────────────────────────────────────┘
         ▼
┌─ jimeng.ts（data/providers/，node:vm 沙箱内，与宿主同权限）────────┐
│  rules: submitMode/browserPath/userDataDir/intervalMin/Max       │
│  ┌─ generateImage(request) ────────────────────────────────┐    │
│  │ 1 节流等待(随机 intervalMin~Max 秒)                       │    │
│  │ 2 getSession() ── 懒初始化单例，Promise 锁               │    │
│  │ 3 参考图上传(抓包确认通道，预期 ImageX/AWS4)              │    │
│  │ 4 按 submitMode 分链路组装请求                            │    │
│  │      normal: POST 生图端点(直调)                          │    │
│  │      canvas: SSE 会话提交(画布 AI 对话)                   │    │
│  │ 5 轮询 get_history_by_ids 直至完成                        │    │
│  │ 6 图片取回：URL 直传 → 不可公开访问则页内 fetch 转 base64  │    │
│  │ 7 返回 MediaAsset[]；signal 触发→中止轮询                 │    │
│  └──────────────────────────────────────────────────────────┘    │
│  sendRequest(): 唯一请求出口                                    │
│      生产 → 页内 fetch(缓存页面 Runtime.evaluate)               │
│      dryrun → this.tool.fetch(复用 tdd samples mock 机制✦)      │
└────────┬─────────────────────────────────────────────────────────┘
         ▼ WebSocket(CDP)
┌─ 浏览器进程(Bun.spawn, 独立 user-data-dir, 登录态持久)────────────┐
│  常驻即梦页面(加载着 bdms SDK → 自动给页内 fetch 注 a_bogus)       │
└──────────────────────────────────────────────────────────────────┘
```

✦ dryrun 适配是本方案对 tdd-dev 流程的关键补丁：现有 dryrun mock 挂在 `this.tool.fetch` 上（`apps/server/src/utils/media/debug.ts`），页内 fetch 不经过它。解法是 provider 内部所有 HTTP 走 `sendRequest()` 单一出口，dryrun 模式下切换到 `this.tool.fetch` —— 这样 `tdd provider dryrun --samples`（samples.json 用抓包样本改写）能完整走通"提交→轮询→取图"全流程的模拟，零积分消耗；生产模式切换到页内 fetch。**同一份业务代码，两种传输通道，dryrun 不再是缩小版。**

---

## 2. 技术设计

### 2.1 CDP 会话层（provider 内部模块）

**浏览器启动**（懒初始化，规避 VM 顶层 1s 限制）：
```
Bun.spawn([browserPath,
  "--remote-debugging-port=" + port,     // 默认 9333，可配置
  "--user-data-dir=" + userDataDir,      // 默认 <data>/browsers/jimengProfile（独立于日常 profile，避开单实例锁）
  "--no-first-run", "--no-default-browser-check",
  "about:blank"], { detached: true, stdout:"ignore", stderr:"ignore" })
```
- `browserPath` 解析顺序：配置值 → Chrome 常见安装路径（`C:\Program Files\Google\Chrome\Application\chrome.exe` 等，x86/LocalAppData 变体）→ Edge。仅 Chromium 内核。
- 首次使用：独立 profile 无登录态 → generateImage 首次检测到未登录时**自动拉起浏览器打开即梦登录页**并返回可诊断错误（"请在弹出的浏览器中完成即梦登录后重试"），登录态此后持久。不做 cookie 手工导入（后续可加 sessionid 直填作为备用通道，本期不做）。

**CDP 握手与常驻页面**：
1. `fetch("http://127.0.0.1:"+port+"/json/version")`（全局 fetch，重试至浏览器就绪）
2. WebSocket 连 `webSocketDebuggerUrl`（浏览器级）
3. `Target.createTarget` 打开即梦图片生成页（normal）或画布页（canvas）→ `Target.attachToTarget({flatten:true})` 拿 page session
4. 页面 ready：`Runtime.evaluate` 探测（document.readyState===complete 且重试退避），首请求失败自动重试 2 次（覆盖 bdms SDK 注入时序）

**页内 fetch helper**（evaluate 注入的字符串，jimeng2api 同型）：
```js
(async () => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);   // 超时自保
  const resp = await fetch(url, { ...opts, signal: ctrl.signal });
  if (!stream) return { status: resp.status, body: await resp.text() };
  const reader = resp.body.getReader();                       // SSE：页内增量读取
  // 聚合 data: 行块，按分隔事件切片后整体返回（canvas 会话用）
})()
```
`Runtime.evaluate` 参数 `awaitPromise:true, returnByValue:true`。大响应保护：只回传 JSON/SSE 文本（图片本体绝不走 evaluate，见 2.4 下载策略）。

**会话生命周期**：
- 模块级 `sessionPromise` 单例 + Promise 锁防并发初始化（对齐 jimeng2api `_ensure_playwright_thread` 的单线程投递思想；本实现用"单页面串行化"：同一页面 evaluate 本身可并发，但提交动作经节流队列串行）
- WS 断连/页面崩溃：`sessionPromise = null`，下次调用自动重建；浏览器进程**常驻不关**（登录态在 profile；与宿主生命周期解耦，server 重启不掉登录）
- 会话按 `browserPath+userDataDir+port` 键化存表 → 多账号并行的架构余量（本期单键）

**节流**：模块级 `lastSubmitAt`，提交前等待 `intervalMin~intervalMax` 随机秒（默认 5/10，配置可调；jimeng2api 视频用 12–15s 量级，生图保守取低）。

### 2.2 调研补全（Phase A，**已完成 2026-10-12**）

> ✅ 全部完成。实测端点映射、请求/响应字段、模型双轨 key 对照、上传链签名细节见
> **`packages/cli/agent-harness/providerWork/jimengProbeOut/jimengApiReference.md`**（含样本文件 samples.jsonl*）。
> 关键结论：页内裸 fetch 自动签名实测通过（200/ret=0）；产物 CDN URL 无 cookie 可下载（6.3MB 实测）；normal= mweb `aigc_draft/generate`+`get_history_by_ids`；canvas = octo `node_generate`+`resource/batch_get`（结构化，无 AI 对话）；模型清单/参数 schema 可从 `generation_specs` 机器生成；上传链 = get_upload_token(STS) + ImageX AWS4 签名（node:crypto 可实现）。

CDP 原型脚本（`providerWork/jimengCdpProbe.ts`，Bun 跑）：spawn 浏览器 + Network 域被动记录 + Runtime.evaluate 页内执行。它本身已验证 CDP 路线全部技术点。

| # | 抓什么 | 怎么触发 | 产出 |
| --- | --- | --- | --- |
| 1 | normal 生图提交+轮询 | 即梦"图片生成"页，seedream4.1，1 次文生图 + 1 次带参考图 | 提交端点/请求体结构、get_history_by_ids 生图记录结构 |
| 2 | canvas 生图会话 | 画布页对 AI 说"生成一张图…"（带参考图） | SSE 端点、事件格式、提示词协议实效、图N引用验证 |
| 3 | 全量模型清单 | 图片/视频页模型下拉数据源（接口或页面内数据） | models 声明（seedream/seedance 全系 + 比例/分辨率/时长/参考图上限） |
| 4 | 参考图上传通道 | 上传一张参考图 | 是否 ImageX/AWS4（jimeng2api 视频证据）+ 参数 |
| 5 | 图片 URL 可访问性 | 对生成图 URL 无 cookie 访问 | 决定下载策略（URL 直传 vs 页内转 base64） |
| 6 | （可选）Seedance 提交 | 视频页 1 次最便宜档试提（可取消） | 校验 jimeng2api 逆向证据与线上一致性 |

抓包样本 → 改写成 `samples.json`（tdd dryrun 用）+ 端点/字段映射表（provider 常量区）。

### 2.3 jimeng.ts 结构（骨架，字段值待 Phase A 填充）

```ts
export default {
  id: "jimeng",
  label: "即梦（浏览器自动化）",
  version: "0.1.0",
  readme: "…使用说明：首次需在拉起的浏览器中登录即梦…",
  rules: [ // form-create，无 apiKey
    { type: "select",  field: "submitMode",  title: "提交模式", value: "normal",
      options: [{label:"普通模式",value:"normal"},{label:"画布模式",value:"canvas"}] },
    { type: "input",   field: "browserPath", title: "浏览器路径", value: "",
      props: { placeholder: "留空自动查找 Chrome/Edge" } },
    { type: "input",   field: "userDataDir", title: "用户数据目录", value: "",
      props: { placeholder: "留空使用默认独立目录" } },
    { type: "inputNumber", field: "intervalMin", title: "提交间隔下限(秒)", value: 5 },
    { type: "inputNumber", field: "intervalMax", title: "提交间隔上限(秒)", value: 10 },
  ],
  models: [ /* 从 jimengApiReference.md 的双轨对照生成纯字面量：
    图片 9 档（seedream 3.0~5.0 Pro + 美学 V8.2），视频 9 档（seedance 1.0~2.5 + happyhorse + wan3.0）；
    imageRatios=octo aspect_ratio 枚举(21:9~9:16)，分辨率 1.5K/2K/4K；
    mode.imageReference 按各模型 materials 上限（多数 10）*/ ],
  validateConfig(config) { /* browserPath 填了则校验存在；intervalMin≤Max */ },
  async generateImage(request) { /* §1 七步流程；signal 检查在轮询循环 */ },
  async generateVideo(request) { /* 同骨架，Seedance 请求组装（jimeng2api 证据） */ },
}
```
- **零 import 目标**：Bun.spawn / fetch / WebSocket / crypto（如需 AWS4，`require("node:crypto")` 是白名单内的 node: 前缀，允许）——规避 `resolveProviderImport` 一切限制
- canvas 提示词模板（视频已知，生图版 Phase A 确认）：`使用Seedream 4.1帮我生成一张图片，比例{ratio}，分辨率{resolution}，下面是我的提示词: {prompt}（图1是角色XX…）`
- 参考图数量声明：`mode.imageReference` 取 normal 上限与 canvas 上限的**保守兼容值**（两模式共享模型条目，readme 说明 canvas 实际更宽松）
- 错误分类（可诊断优先）：未登录（自动拉起登录页+明确提示）、积分不足、风控/签名失败（自动重试 1 次后报错）、浏览器启动失败（路径提示）、超时（signal 传播）

### 2.4 图片取回策略
1. 首选：`MediaAsset = { url }`，宿主 `generateMedia` 下载（Phase A #5 确认可公开访问时）
2. 兜底：需登录态访问的 URL → 页内 fetch 读 blob → base64 返回（不走 evaluate 传二进制，页内转 base64 字符串再 returnByValue；超大时 provider 直接 `tool.fetch`？不行无 cookie —— base64 分片或 binary via Blob，实现时按实测大小定，图片 <10MB 常见可承受）

### 2.5 tdd-dev 流程映射

| 环节 | 映射 | 停点 |
| --- | --- | --- |
| 调研 | Phase A 原型脚本+抓包（本方案 §2.2） | - |
| 开发 | providerWork/jimeng.ts 暂存 → 按 providerSpec 骨架 | - |
| inspect | `tdd provider inspect`：零 import/字面量 models/文件名 `jimeng.ts` 全过 | - |
| dryrun | `tdd provider dryrun --samples jimengSamples.json`：sendRequest 切 tool.fetch，samples=抓包样本改写；全流程模拟出 MediaAsset | - |
| import/config | `tdd provider import` + `tdd provider config --set submitMode=… browserPath=…` | - |
| 真测 | normal 1 张 → config 切 canvas → 1 张 | **费用红线停点：真测前 dryrun 全绿 + 用户授权** |

---

## 3. 实施步骤

| 阶段 | 内容 | 验证 | 预估消耗 |
| --- | --- | --- | --- |
| **A 调研** | ~~CDP 原型脚本 → 连已登录浏览器抓包~~ **✅ 已完成（2026-10-12）**：端点映射表 jimengApiReference.md + 样本 + 全部可行性验证通过（页内签名/URL 下载/CDP 链路/登录持久） | 端点样本齐 | 实耗：生图 2 张（normal 1 + canvas 1） |
| **B 开发** | jimeng.ts（models 全量/rules/双模式 generateImage/generateVideo/sendRequest 双通道/错误分类） | inspect 过；dryrun（samples）两模式全流程模拟绿 | 0 |
| **C 验收** | import → config → 真测：normal seedream4.1 1 张落盘 → 切 canvas 1 张落盘；视频路径仅 dryrun | 画布节点出图、`assets/<nodeId>/` 落盘、signal 取消不残留进程 | canvas 1 张 |
| **D 收尾** | readme/使用文档（登录引导、间隔建议、故障排查）；多账号余量说明 | 文档过目 | 0 |

里程碑门：A→B 之间（端点样本齐）向我汇报映射表；B→C 之间 = tdd-dev 费用红线（dryrun 全绿 + 用户授权真测）。

## 4. 风险与对策
- **bdms/接口漂移**：页内 fetch 天然跟随页面 SDK（签名侧免疫）；路径/字段漂移 → provider 顶部常量区集中映射 + readme 更新流程，供应商文件可随时重 import 热替换
- **CDP 细节坑**（Target flatten/sessionId 路由/evaluate 时序）：原型脚本先行验证，坑在 Phase A 暴露而非 Phase C
- **evaluate 大响应**：只传 JSON/SSE 文本；图片走 URL/base64 策略（§2.4）
- **登录态失效**：错误分类+自动拉起登录页；profile 持久化把频率压到最低
- **风控**：节流默认保守（5–10s）、单页面、拟人随机间隔；不并发打 SSE
- **浏览器找不到**：探测链+配置兜底，validateConfig 提前暴露

## 5. 延后项的架构余量（多账号并行）
- 会话表按 `browserPath+userDataDir+port` 键化（本期恒单键）
- 配置层后续可扩展为账号数组 + config.html 列表界面（providerSpec 已明示该场景适用 config.html）
- 调度层后续按账号轮询分派请求；jimeng2api 的并发上限+随机间隔经验直接复用

---

## 6. 执行结果（2026-10-12）

### 已完成
- **jimeng.ts**（providerWork/，v0.1.0）：零第三方依赖（仅 node:crypto/fs 静态 import + Bun.connect 裸 TCP 自写 RFC6455 WebSocket 客户端）；CDP 懒初始化会话；ImageX AWS4 上传链；normal（mweb aigc_draft/generate）+ canvas（octo node_generate）双模式；视频走 octo（type:2 未实机验证）；dryrun 双通道（config.dryrun=true 时切 this.tool.fetch）
- **inspect 通过**（17 模型）；**dryrun 三场景全绿**（normal/canvas 生图 + canvas 视频）；已安装到 data/providers 并配置
- **normal 真测通过**：seedream4.1 16:9 文生图 14.1s 端到端（CDP→提交→轮询→出图），产物 1.86MB PNG 无 cookie 可下载
- 文生图 draft 结构实证修正：`abilities.generate`（仅 core_param，多 negative_prompt/seed 字段，intelligent_ratio:false）；带图走 `abilities.blend`（+byte_edit ability_list）；component 必带 metadata

### 卡点（canvas 真测）——已解决（2026-10-13，UI 驱动方案）
- **根因**：octo 路径的 `node_generate` 要求 `a_bogus` 签名（UI 实测请求带 a_bogus+msToken）；页内裸 fetch/XHR 在 **mweb 路径**会被 bdms SDK 自动补签（normal 模式因此全通），但 **octo 路径不补**，签名器在 SDK 闭包内无公开接口（window.bdms 仅 init/getReferer）
- **解法：让页面自己发请求**（UI 驱动）。submitMode 扩展为三选：`normal` / `canvasNode`（DOM 自动化建节点生成）/ `agent`（画布右侧 AI 对话导入），v0.2.0 已全链路真测通过（server 沙箱：canvasNode 32.3s / agent 37.6s 端到端出图，seedream_4.1 16:9 2K）
- 其余 octo 接口（create/access resolve/batch_get/resource list）裸 fetch/带 cookie 直发均无签名要求；`project/create` 改为浏览器级 CDP `Storage.getCookies` 取 cookie 后 provider 直发（过滤 `.jianying.com` 全域）

### canvas DOM 自动化实证要点（2026-10-13 调研，全部实测）
- 左栏工具按钮 = `button[aria-label="图片"/"视频"]`，单击直接建节点（有节点画布）；**合成事件（.click()/dispatchEvent）全部无效**，必须 CDP `Input.dispatchMouseEvent` 真实点击序列（mouseMoved→Pressed→Released）
- **空画布是引导态**：无左栏工具，只有"双击画布 创建节点"提示 → 双击画布空白（60%w/50%h）→ 弹"新建节点"菜单（`[class*=octo-co]`）→ 点菜单项；空画布交互层初始化有时序，单击激活+双击为一轮重试
- **Loading canvas / Syncing room 期间交互层锁定**（双击无反应）→ 就绪条件等 `Room connected`（sr-only 文本）
- 双击节点内容区 → 配置面板 `.generation-input-panel`：contenteditable 提示词（focus 后 `Input.insertText`）、`选择模型: *` 按钮（listbox 选项**超高被裁剪，必须先 scrollIntoView 再点**）、`*尺寸选项` 按钮（三 listbox：比例/分辨率/数量）、`生成` 按钮；Escape/点空白会收起面板但**配置保留**
- agent 对话：`与 AI 对话` 按钮 → contenteditable（右下区）→ `发送消息` 按钮；协议 = `canvas_agent/sessions/create` → `subscribe` → `messages/send`（a_bogus 由页面签）→ 页面 WS 收事件自动建节点生图 → `resource/batch_get` 查产物 → `result_attribution/attach`；**agent 生成的 resource 的 prompt 字段原样透传**（可用 prompt 匹配定位产物）
- 产物轮询：`resource/list` `{project_id, source:1, relation_source:1}`（按 prompt+created_at 匹配，**status 1000=完成/1001=失败**；完成态 resource 无 error_code 字段——判失败须 `?? 0` 兜底）；URL 用 `resource/batch_get` 的 `image_urls`（生成中间态 status=200，完成态 1000）
- **后台 tab 会被 Chrome 冻结**（CDP 全挂：Network.enable 超时）→ ensureCdpSession 遍历页面跳过冻结 tab；**画布生成全程开新 tab**（旧 tab 冻结+协作编辑器 beforeunload 拦截导航）；**跨文档导航后旧 CDP 连接的 Input 域失效**（evaluate 仍通）→ 导航后必须按 projectId 重连
- 参考图：canvasNode/agent 模式暂不支持（传参考图报错提示改用 normal；normal 的 byte_edit 已覆盖 1-10 张）

### 实施过程的关键坑（复刻者必读）
- **Bun node:http 的 WS 不可用**：101 响应走 `response` 事件而非 `upgrade`，且 response.socket 不吐数据 → 必须 `Bun.connect` 裸 TCP 手写 Upgrade 握手+帧编解码
- **vm 沙箱 require 不生效**（即使 context 注入了 providerRequire）→ 供应商内一律静态 `import "node:..."`（resolveProviderImport 支持）
- tdd CLI 的 `--config` 多键用重复 flag：`--config k1=v1 --config k2=v2`；samples 文件是**裸数组**
- `| tail` 管道会缓冲 tdd 流式输出直到进程结束，排查中间态要直连 server NDJSON（realTest.py 即此用途）
- CDP 抓包 attach 页面时要核对 target：页面 reload/多 tab 时 probe 可能连着别的 tab，网络证据以 `performance.getEntriesByType('resource')`（页内）或自 attach 监听为准
