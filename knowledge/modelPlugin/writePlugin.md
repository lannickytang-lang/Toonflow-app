# 如何编写新供应商插件

面向"开发 agent 要接入一个新模型源"的场景。规范的事实源是技能内 `packages/skills/tdd-dev/references/providerSpec.md`（types.d.ts 的完整镜像 + 骨架）；本文补齐测试流程与陷阱清单。

## 骨架（最小可过校验）

```ts
const version = "1.0.0";
const rules = [{ type: "input", field: "apiKey", title: "API Key", value: "",
  props: { type: "password" } }] as const;

export default {
  id: "demoProvider",            // 文件名必须等于 demoProvider.ts
  label: "示例供应商",
  version,                       // 唯一允许引用顶层 const 的字段
  rules,
  models: [{ id: "demoImage", label: "示例图片", type: "image", mode: ["text"] }],
  async generateImage(request) {
    const response = await this.tool.fetch("https://api.example.com/v1/images", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({ model: request.model, prompt: request.prompt }),
      signal: AbortSignal.any([AbortSignal.timeout(120000), ...(this.signal ? [this.signal] : [])]),
    });
    if (!response.ok) throw new Error(`上游 HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    return [{ mediaType: "image", type: "url", url: data.result.url }];
  },
};
```

要点：鉴权字段名固定 `apiKey`；网络请求**只走 `this.tool.fetch`**（dryrun mock 靠它注入）；轮询到终态再返回（不得返回任务 id）；`this.signal` 可能 undefined 用条件展开；没有对应能力的模型就不注册该类型（纯生图供应商只写 image 模型是正常形态）。

## 请求字段契约（照此取名，勿凭记忆）

- ImageRequest：`model, prompt, images?`（参考图，MediaInput[]）`, mask?, n?, ratio?, size?, quality?, outputFormat?, other?`
- VideoRequest：`model, prompt, mode?, images?, videos?, audios?, firstFrame?, lastFrame?, duration?, ratio?, resolution?, generateAudio?, watermark?, other?`
- AudioRequest：`model, text`（不是 prompt）`, audios?, voice?, speed?, volume?, format?, sampleRate?, other?`
- MediaInput 三形态：`{type:"url",url}` / `{type:"base64",data,mimeType}` / `{type:"binary",data:Uint8Array,mimeType}`
- models[].mode 合法值：图片 `text|singleImage|multiReference`；视频 `text|singleImage|startEndRequired|endFrameOptional|startFrameOptional` 或 `["imageReference:10",...]`

## 测试流程（七环节中 agent 执行的五步，全用 tdd CLI）

```bash
tdd provider inspect demoProvider.ts          # 1 静态校验循环到退出码 0（零费用）
# 2 写样例 samples.json（来自上游文档响应示例；match=URL子串, method, times, status, body）
tdd provider dryrun demoProvider.ts --model demoImage --samples samples.json   # 零费用干跑
tdd provider import demoProvider.ts           # 3 安装（409=已装，delete --yes 后重装）
tdd provider config demoProvider --set apiKey=sk-xxx    # 4 凭证（回显打码）
tdd provider probe --url <模型列表地址> --config apiKey=sk-xxx   # 连通验证（无列表接口平台改用"查不存在任务"法）
tdd provider test demoProvider.ts --model demoImage --yes       # 5 真测（计费；凭证自动回退；参考图模型加 --image）
```

dryrun 验证两件事：**构造入参**（日志里每条请求的 method/URL/headers/body 对照上游文档）与**解析结果**（样例响应被正确转成 `成功: N 个媒体`）。图生视频等 ref 必填模型必须带 `--image/--audio` 才能验证完整流。

## 陷阱清单（两轮真实 UAT 实测踩过，必读）

1. **字面量违规**是 inspect 最常见拒绝：id/label/readme/modelsUrl/models 引用变量或展开 → 内联字面量（仅 version 可引用顶层 const）。
2. **参考素材字段名**：是 `images/firstFrame/lastFrame`，**不是 references**（首版技能文档写错致照抄全错，已修——但外部资料仍常见此误导）。
3. **`this.signal!` 非空断言**：signal 为 undefined 时抛 TypeError，用 `...(this.signal ? [this.signal] : [])`。
4. **modelsUrl 边界**：OpenAI 全量中转站（/v1/models 返回聊天+媒体全量无 type 区分）**不要配 modelsUrl**——refresh 会报"缺少 type"或整体覆盖本地 models；改静态注册。上游列表干净或可 `?type=image` 过滤的才配。
5. **平台文档失真**：真测报"存在未定义的参数/RequestParameterIsWrong"→ 优先怀疑文档错（autodl 实测：页面混入另一工作流参数），找权威源（前端 bundle 里工作流元数据接口的 input_rules）重写，别逐个补参数。
6. **文档响应示例与实际不符**：dryrun 样例取自文档，文档错只有真测能暴露——真测失败后用**实际响应**构造样例再 dryrun 验证解析，不要连续烧钱。
7. **503 `No available channel` / `model_not_found`**：是密钥分组无渠道（权限），重试无效——`probe` 复核 key 可用模型，去掉该模型或让用户换 key。
8. **上游 429**：限流，等 60–90s 重试；errors.md 有对照表。
9. **改已装供应商源码**：必须 `delete --yes`（凭证连带清除）→ `import` → 重新 `config`。
10. **终态值多态**：同一平台两处文档可能一个写 `SUCCESS` 一个写 `completed`——实现做大小写归一兼容。

## 完整流程（含 agent 编排与停点）

开发 agent 的完整七环节（调研→确认卡→开发→inspect→dryrun→导入配置→真测）与三停点（方案确认/缺密钥/真测授权）定义在 `packages/skills/tdd-dev/SKILL.md`——那是 agent 的行为规范；本文是人/agent 共用的技术参考。
