# 供应商 .ts 开发规范（事实源）

供应商是一个 TypeScript 文件：`export default` 一个对象，文件名必须等于 `<id>.ts`。装到 Toonflow 后在 vm 中以本地权限运行，为画布生成节点提供模型。

> 类型契约的权威源是 `packages/providers/types.d.ts`（源码仓库）；本文件的"请求/返回类型"是其完整镜像，字段以此为准，不要凭记忆猜测。

## 最小骨架（照抄填空）

```ts
const version = "1.0.0";

const rules = [
  { type: "input", field: "apiKey", title: "API Key", value: "",
    props: { type: "password", placeholder: "在供应商控制台获取" } },
] as const;

export default {
  id: "demoProvider",            // 小驼峰，文件名必须是 demoProvider.ts
  label: "示例供应商",
  version,                       // 唯一允许引用顶层 const 的字段
  readme: "一句话说明。",          // 可选，Markdown 字面量
  // modelsUrl: "https://api.example.com/v1/models?type=image",  // 可选，见下方"modelsUrl 适用边界"
  rules,
  models: [                      // 纯 JSON 字面量，禁止引用变量/展开
    { id: "demoImage", label: "示例图片", type: "image", mode: ["text"], imageRatios: ["1:1", "16:9"] },
  ],

  async generateImage(request) {
    const response = await this.tool.fetch("https://api.example.com/v1/images", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({ model: request.model, prompt: request.prompt }),
      // this.signal 可能为 undefined：条件展开，不要用非空断言 this.signal!
      signal: AbortSignal.any([AbortSignal.timeout(120000), ...(this.signal ? [this.signal] : [])]),
    });
    if (!response.ok) throw new Error(`上游 HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    return [{ mediaType: "image", type: "url", url: data.result.url }];
  },

  // 视频同理实现 generateVideo(request)；音频 generateAudio（可选）。
  // 没有对应能力的模型就不要注册该类型模型——纯生图供应商只写 image 模型是正常形态。
};
```

## 硬约束（parseProvider 逐条校验，违反即 inspect 失败）

| 约束 | 说明 |
| --- | --- |
| 文件 ≤ 2 MB，UTF-8 | 超限直接拒绝 |
| `export default` 直接导出对象字面量 | 不能导出变量、不能包函数 |
| `id` 小驼峰，≤96 字符 | 首字母小写字母，其后字母数字；不能是 con/prn/aux/nul/com1-9/lpt1-9 |
| 文件名 = `<id>.ts` | import 时校验 |
| `id/label/version/readme/modelsUrl/models` 必须字面量 | **只有 `version` 允许引用顶层 const 字符串**；readme 也要内联写 |
| `models` 纯 JSON 字面量 | 不能引用变量、展开、计算属性；模型 id 不重复；≤2000 个 |
| 每个模型 `id/label/type` 必填 | type ∈ text/image/video/audio（供应商一般只写 image/video） |
| 禁止相对路径导入 | `import`/`require` 只允许 `node:` 内置模块与 server 已装依赖；模块体内动态 import 不可用 |

## 运行时环境（this 上的东西）

| 成员 | 用途 |
| --- | --- |
| `this.config.<field>` | rules 里声明的配置值（用户填的 apiKey 等；rules 的 `value` 是默认值） |
| `this.tool.fetch` | **唯一网络出口**——必须用它而不是全局 fetch（超时/取消/日志都靠它注入）；dryrun 时它被替换为 mock，代码无感知 |
| `this.signal` | 调用方取消信号，**可能为 undefined**；长轮询联动用条件展开写法（见骨架） |
| `this.tool.hash` / `this.tool.image` / `this.tool.audio.convert` / `this.tool.ffmpeg()` | Bun.hash / Bun.Image / 音频转换 / 工作区 ffmpeg（可选能力） |

## 请求字段契约（types.d.ts 完整镜像，字段名以此为准）

**MediaInput**（参考素材三形态，供应商负责转成平台要的格式）：
`{ type: "url", url, mimeType? }` | `{ type: "base64", data, mimeType }` | `{ type: "binary", data: Uint8Array, mimeType }`

**ImageRequest**（generateImage 入参）：`model`、`prompt`、`images?`（参考图，MediaInput[]——**不是 references**）、`mask?`、`n?`（数量）、`ratio?`（如 16:9）、`size?`（如 1K/2K/1024x1024）、`quality?`（low/medium/high）、`outputFormat?`（png/jpeg/webp）、`other?`（供应商专属参数兜底）。

**VideoRequest**（generateVideo 入参）：`model`、`prompt`、`mode?`（当前生成模式）、`images?` / `videos?` / `audios?`（参考素材数组）、`firstFrame?` / `lastFrame?`（首尾帧，单独字段）、`duration?`（秒）、`ratio?`、`resolution?`（如 720p/1080P）、`generateAudio?`、`watermark?`、`other?`。

**AudioRequest**（generateAudio 入参）：`model`、`text`（**文本字段是 text 不是 prompt**）、`audios?`、`voice?`、`speed?`、`volume?`、`format?`、`sampleRate?`、`other?`。

**models[].mode 合法值**：图片 `text | singleImage | multiReference`；视频 `text | singleImage | startEndRequired | endFrameOptional | startFrameOptional` 或参考数量声明 `["imageReference:10", "videoReference:5", "audioReference:5"]`（模板字面量形式）。models 其他可选字段：`think?`、`associationSkills?`、`audio?`、`imageSizes?`、`imageRatios?`、`durationResolutionMap?`、`voices?`。不确定就少写——字段缺失该能力即不展示，不会报错。

## 返回契约

返回必须是 `MediaAsset[]`（非空数组）：`{ mediaType: "image"|"video"|"audio", type: "url", url }`（url 须 http/https）或 `{ type: "base64", data, mimeType }` / `{ type: "binary", data: Uint8Array, mimeType }`（mimeType 须以 `{类型}/` 开头，如 image/png）。**不得返回任务 id**：异步任务要在方法内部轮询到终态再返回媒体（轮询间 `signal.throwIfAborted()` + 间隔等待）。

## rules（配置表单，form-create 规则）

- 鉴权字段名固定 `apiKey`（Toonflow 约定，`models --refresh`/`probe` 用它拼 Bearer）；
- 每项 `{ type: "input", field, title, value, props }`；密码用 `props.type = "password"`；
- 无鉴权供应商（如本地 ComfyUI）用 `const rules = [] as const;`；
- 编辑供应商时的渲染降级：**有 config.html 用自定义界面 → 仅有 rules 用表单回显 → 都没有回落 apiKey 单框**。静态几个字段用 rules 就够，只有动态列表/多节点管理才写 config.html。

## config.html（自定义配置界面，可选）

复杂配置（ComfyUI 多节点、浏览器窗口列表等动态结构）rules 表单做不了时，提供一个 `config.html` 伴生文件（与 `<id>.ts` 同目录、同名前缀）：`demoProvider.ts` + `demoProvider.html`。宿主在 iframe 沙箱中渲染它，通过注入的 `window.toonflow` 桥接 API 读写配置。

**硬约束**：≤512 KB、UTF-8、自包含（建议内联全部 CSS/JS）；宿主只取 `<body>` 内容（写完整文档时 `<head>` 里的脚本样式不会生效）；外链 http 资源技术上可用但离线不可用（inspect 警告）。

**桥接 API**（宿主注入，直接调用）：

| API | 说明 |
| --- | --- |
| `toonflow.ready()` | 界面初始化完成后必须调用（宿主据此结束加载态，10 秒未握手判失败并降级表单） |
| `toonflow.getConfig()` | `Promise<object>`，返回当前已保存配置 |
| `toonflow.setConfig(config)` | 上报编辑结果（宿主缓存，用户点"保存"时落库）——**每次变更后都要调** |
| `toonflow.validate(config?)` | `Promise<{ok, errors?}>`，调插件的 validateConfig 钩子（服务端代理，无 CORS），缺省用最近一次 setConfig 的值 |
| `toonflow.theme` | `{ mode: "dark" }`；宿主注入 `--tf-bg/--tf-fg/--tf-muted/--tf-primary/--tf-border/--tf-danger/--tf-radius` CSS 变量，直接引用即与平台配色一致 |

**保存模型**：宿主统管——界面**不要写保存按钮**，对话框底部的"保存"由宿主处理；界面内的"测试连接"类即时按钮用 `toonflow.validate()`。

**最小示例**（可直接照抄）：

```html
<body>
  <label>API Key<input id="apiKey" type="password" /></label>
  <label>请求地址<input id="baseUrl" /></label>
  <script>
    const state = {};
    toonflow.getConfig().then(config => {
      state.apiKey = config.apiKey ?? "";
      state.baseUrl = config.baseUrl ?? "https://api.example.com";
      apiKey.value = state.apiKey;
      baseUrl.value = state.baseUrl;
      toonflow.ready();
    });
    function report() { toonflow.setConfig({ ...state }); }
    apiKey.oninput = () => { state.apiKey = apiKey.value; report(); };
    baseUrl.oninput = () => { state.baseUrl = baseUrl.value; report(); };
  </script>
</body>
```

**样式起步模板**（暗色主题直接协调，可选）：

```html
<style>
  input, select, textarea { width: 100%; padding: 6px 10px; border: 1px solid var(--tf-border);
    border-radius: var(--tf-radius); background: var(--tf-bg-soft); color: var(--tf-fg); box-sizing: border-box; }
  label { display: block; margin-bottom: 12px; color: var(--tf-muted); font-size: 13px; }
  button { padding: 5px 14px; border: 0; border-radius: var(--tf-radius); background: var(--tf-primary); color: #fff; cursor: pointer; }
</style>
```

## validateConfig（可选校验钩子）

导出对象上声明 `validateConfig(config)`（纯函数，`this.tool.fetch` 可联网，请求从服务端发出无 CORS）：返回 `{ ok: false, errors: ["原因"] }` 或抛异常都会让宿主**拒绝保存**并把 errors 回显给用户；返回 `{ ok: true }` 放行。同一份钩子供两处复用：宿主保存时自动调用 + 界面"测试连接"按钮（`toonflow.validate()`）。

```ts
async validateConfig(config) {
  const response = await this.tool.fetch(`${config.baseUrl}/v1/models`, {
    headers: { authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401) return { ok: false, errors: ["API Key 无效（上游返回 401）"] };
  if (!response.ok) throw new Error(`上游 HTTP ${response.status}`);
  return { ok: true };
},
```

## 打包分发（zip）

带 config.html 的供应商分发为 `<id>.zip`：根级（或同名顶层目录内）恰好一个 `<id>.ts` + 可选 `config.html`，≤2 MB。`tdd provider import <id>.zip` 或插件市场安装；单 .ts 导入时同目录 `<id>.html` 自动随附。

## modelsUrl 适用边界（重要，选错会污染模型列表）

**适合配置 modelsUrl**：上游有干净的"仅媒体模型"列表接口，或支持按 type 过滤（如 `…/v1/models?type=image`），返回 `{ data: [{id, …}] }`。

**不要配置 modelsUrl**（改静态注册 models）：
- OpenAI 全量中转/聚合站（`/v1/models` 返回聊天+转存+媒体全量模型且无 type 区分）——刷新会报"缺少 type"，或把几百个聊天模型灌入并**整体替换**本地同类型 models；
- 上游没有模型列表接口。

静态注册时，连通性验证改用 `tdd provider probe --url <地址> --config apiKey=<key>`（只读零费用）或直接由环节 7 真测承担。

## 开发自检清单（提交 inspect 前自查）

1. 文件名与 id 一致、id 小驼峰；2. 除 version 外元数据全是字面量；3. models 无变量引用；4. 网络请求全走 `this.tool.fetch`；5. 返回 MediaAsset[] 而非任务 id；6. 轮询联动 `this.signal`（条件展开写法）；7. 鉴权字段名是 `apiKey`；8. 参考素材字段名按上方契约（images/firstFrame/lastFrame，不是 references）；9. 有 config.html 时：调用了 `toonflow.ready/getConfig/setConfig`、无外链资源、不写保存按钮。
