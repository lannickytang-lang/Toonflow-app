# 供应商 .ts 开发规范（事实源）

供应商是一个 TypeScript 文件：`export default` 一个对象，文件名必须等于 `<id>.ts`。装到 Toonflow 后在 vm 中以本地权限运行，为画布生成节点提供模型。

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
  // modelsUrl: "https://api.example.com/v1/models",  // 可选：拉模型列表的 GET 地址
  rules,
  models: [                      // 纯 JSON 字面量，禁止引用变量/展开
    { id: "demoImage", label: "示例图片", type: "image", mode: ["text"], imageRatios: ["1:1", "16:9"] },
  ],

  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const response = await this.tool.fetch("https://api.example.com/v1/images", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({ model: request.model, prompt: request.prompt }),
      signal: AbortSignal.any([AbortSignal.timeout(120000), this.signal!]),
    });
    if (!response.ok) throw new Error(`上游 HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    return [{ mediaType: "image", type: "url", url: data.result.url }];
  },

  // 视频同理实现 generateVideo(request: VideoRequest)；音频 generateAudio（可选）。
} satisfies ProviderDefinition<typeof rules>;
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
| `this.signal` | 调用方取消信号；长轮询必须联动（见骨架的 AbortSignal.any 写法） |
| `this.tool.hash` / `this.tool.image` / `this.tool.audio.convert` / `this.tool.ffmpeg()` | Bun.hash / Bun.Image / 音频转换 / 工作区 ffmpeg（可选能力） |

## 请求/返回类型速览

- `ImageRequest`：`model, prompt, ratio?, size?` + 参考素材（`references?` 等，见 types 全文）；`VideoRequest` 另有 `duration?, resolution?`；`AudioRequest` 用 `text` 字段。
- 返回必须是 `MediaAsset[]`（非空数组）：`{ mediaType: "image"|"video"|"audio", type: "url", url }`（url 须 http/https）或 `{ type: "base64", data, mimeType }` / `{ type: "binary", data: Uint8Array, mimeType }`（mimeType 须以 `{类型}/` 开头）。
- **不得返回任务 id**：异步任务要在方法内部轮询到终态再返回媒体（轮询间 `signal.throwIfAborted()` + 间隔等待）。

## rules（配置表单，form-create 规则）

- 鉴权字段名固定 `apiKey`（Toonflow 约定，`models --refresh` 用它拼 Bearer）；
- 每项 `{ type: "input", field, title, value, props }`；密码用 `props.type = "password"`；
- 无鉴权供应商（如本地 ComfyUI）用 `const rules = [] as const;`。

## 模型能力字段（models 内可选）

`mode`（支持哪些输入形态）、`imageRatios`/`imageSizes`（图片）、`durationResolutionMap`（视频时长×分辨率）、`associationSkills`。不确定就少写——字段缺失该能力即不展示，不会报错。

## 开发自检清单（提交 inspect 前自查）

1. 文件名与 id 一致、id 小驼峰；2. 除 version 外元数据全是字面量；3. models 无变量引用；4. 网络请求全走 `this.tool.fetch`；5. 返回 MediaAsset[] 而非任务 id；6. 轮询联动 `this.signal`；7. 鉴权字段名是 `apiKey`。
