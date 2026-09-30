const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
  {
    type: "input",
    field: "baseUrl" as const,
    title: "请求地址",
    value: "https://api.yijiarj.cn",
    props: { placeholder: "https://api.yijiarj.cn 国内大带宽；可换 https://apius.yijiarj.cn 美国线路" },
  },
] as const;

const version = "1.0.0";
const pollIntervalMs = 5000;
const maxPolls = 240;

function wait(signal: AbortSignal, ms: number) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function refToDataUri(input: MediaInput) {
  if (input.type === "url") return input.url;
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data;
  return data.startsWith("data:") ? data : `data:${input.mimeType};base64,${data}`;
}

function platformMessage(data: unknown) {
  const source = data as { msg?: unknown; message?: unknown; error?: unknown };
  const error = source?.error;
  const inner = typeof error === "object" && error ? (error as { message?: unknown }).message : undefined;
  return String(source?.msg || source?.message || inner || error || "").trim();
}

/** image2 的 size：文档像素可选值 1024x1024 / 1024x1792 / 1792x1024 等；ad 分组亦支持直接传比例（如 21:9），无像素映射时透传比例。 */
function imageSize(ratio?: string, size?: string) {
  if (size && /^\d+x\d+$/.test(size)) return size;
  const map: Record<string, string> = {
    "1:1": "1024x1024", "16:9": "1792x1024", "9:16": "1024x1792", "4:3": "1792x1024",
    "3:4": "1024x1792", "3:2": "1792x1024", "2:3": "1024x1792", "4:5": "1024x1792", "5:4": "1792x1024",
  };
  if (ratio) return map[ratio] ?? ratio;
  return "1024x1024";
}

/** /v1/videos 的 size 为像素格式（如 1920x1080）；由分辨率档位与比例推算短边。 */
function videoSize(ratio?: string, resolution?: string) {
  const shortSide = /1080/.test(resolution || "") ? 1080 : 720;
  const longSide = Math.round((shortSide * 16) / 9);
  if (["9:16", "2:3", "3:4", "4:5"].includes(ratio || "")) return `${shortSide}x${longSide}`;
  if (ratio === "1:1") return `${shortSide}x${shortSide}`;
  return `${longSide}x${shortSide}`;
}

/** image2 的图片 URL 以 Markdown 图片语法嵌在 content 中；转存等其他场景可能直接是裸 URL。 */
function extractImageUrl(content: unknown) {
  const parts = Array.isArray(content) ? content : [content];
  const text = parts.map((part) => (typeof part === "string" ? part : String((part as { text?: unknown })?.text ?? ""))).join("");
  const markdown = text.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
  if (markdown) return markdown[1];
  const withExt = text.match(/https?:\/\/[^\s)"']+\.(?:png|jpe?g|webp|gif)(?:[^\s)"']*)/i);
  if (withExt) return withExt[0];
  const bare = text.match(/https?:\/\/[^\s)"']+/);
  return bare?.[0] ?? "";
}

export default {
  id: "yijiaApi",
  label: "一加API",
  version,
  // ACT: 平台 /v1/models 返回全量聊天+媒体模型且无 type 区分，刷新会整体覆盖静态 models，故不配 modelsUrl；连通性由真实生成验证。
  readme: "一加API（yijiarj.cn）：image2 系列出图（POST /v1/chat/completions，实测返回 data[].url）；sora_video2 出视频（POST /v1/videos 创建 + GET /v1/videos/{id} 轮询）。注意：密钥需有所在分组对应渠道，ad-image2 分组仅可用 image2 系列，视频模型需换有视频权限的密钥。",
  rules,
  models: [
    { id: "image2", label: "Image2 图片生成", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1024x1024", "1024x1792", "1792x1024", "1920x822", "822x1920"] },
    { id: "image2-2k", label: "Image2 图片生成 2K", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1024x1024", "1024x1792", "1792x1024", "1920x822", "822x1920"] },
    { id: "image2-4k", label: "Image2 图片生成 4K", type: "image", mode: ["text", "singleImage", "multiReference"], imageSizes: ["1024x1024", "1024x1792", "1792x1024", "1920x822", "822x1920"] },
    { id: "sora_video2", label: "Sora2 视频", type: "video", mode: ["text", "singleImage"] },
  ] satisfies ProviderModel[],

  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const apiKey = this.config.apiKey?.trim().replace(/^Bearer(?:\s+|$)/i, "");
    if (!apiKey) throw new Error("请填写 API Key");
    const baseUrl = (this.config.baseUrl?.trim() || "https://api.yijiarj.cn").replace(/\/$/, "");
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

    const refs = (request.images ?? []).map(refToDataUri);
    const content = refs.length
      ? [{ type: "text", text: request.prompt }, ...refs.map((url) => ({ type: "image_url", image_url: { url } }))]
      : request.prompt;
    const payload = {
      messages: [{ role: "user", content }],
      model: request.model,
      size: imageSize(request.ratio, request.size),
    };

    const signal = AbortSignal.any([AbortSignal.timeout(300_000), ...(this.signal ? [this.signal] : [])]);
    const response = await this.tool.fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`图片生成失败:HTTP ${response.status} ${platformMessage(data)}`);
    // ACT: 实测 image2 在该端点返回 Images API 格式（data[].url），与文档的 chat 格式（choices[].message.content 内 Markdown）不一致，两种都兼容。
    const items = Array.isArray((data as { data?: unknown })?.data) ? ((data as { data: unknown[] }).data) : [];
    const urls = items
      .map((item) => (typeof item === "string" ? item : String((item as { url?: unknown })?.url || "").trim()))
      .filter(Boolean);
    if (!urls.length) {
      const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
      const url = extractImageUrl(content);
      if (url) urls.push(url);
    }
    if (!urls.length) throw new Error(`响应中未找到图片 URL:${JSON.stringify(data).slice(0, 300)}`);
    return urls.map((url) => ({ mediaType: "image" as const, type: "url" as const, url }));
  },

  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
    const apiKey = this.config.apiKey?.trim().replace(/^Bearer(?:\s+|$)/i, "");
    if (!apiKey) throw new Error("请填写 API Key");
    const baseUrl = (this.config.baseUrl?.trim() || "https://api.yijiarj.cn").replace(/\/$/, "");
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

    const images = request.firstFrame ? [request.firstFrame, ...(request.images ?? [])] : (request.images ?? []);
    const payload: Record<string, unknown> = {
      prompt: request.prompt,
      model: request.model,
      size: videoSize(request.ratio, request.resolution),
    };
    if (images.length) payload.input_reference = refToDataUri(images[0]);
    if (request.duration) payload.seconds = String(Math.round(request.duration));
    if (request.watermark !== undefined) payload.watermark = request.watermark;

    const signal = AbortSignal.any([AbortSignal.timeout(30 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const submit = await this.tool.fetch(`${baseUrl}/v1/videos`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    const submitData = await submit.json().catch(() => ({}));
    if (!submit.ok) throw new Error(`创建视频任务失败:HTTP ${submit.status} ${platformMessage(submitData)}`);
    const taskId = (submitData as { id?: unknown })?.id;
    if (!taskId) throw new Error(`创建响应缺少任务 id:${JSON.stringify(submitData).slice(0, 300)}`);

    for (let polls = 1; polls <= maxPolls; polls += 1) {
      await wait(signal, pollIntervalMs);
      const poll = await this.tool.fetch(`${baseUrl}/v1/videos/${taskId}`, { method: "GET", headers, signal });
      if (poll.status === 401 || poll.status === 403) throw new Error(`查询任务被拒绝(HTTP ${poll.status}),请检查 API Key`);
      if (!poll.ok) continue;
      const data = await poll.json().catch(() => ({}));
      const status = String((data as { status?: unknown })?.status || "").trim().toLowerCase();
      if (status === "completed") {
        const url = String((data as { url?: unknown })?.url || "").trim();
        if (!url) {
          const quality = String((data as { quality?: unknown })?.quality || "").trim();
          throw new Error(`任务完成但没有视频链接${quality ? `(内容审查:${quality})` : `:${JSON.stringify(data).slice(0, 300)}`}`);
        }
        return [{ mediaType: "video", type: "url", url }];
      }
      if (status === "error" || status === "failed") throw new Error(`视频生成失败:${platformMessage(data) || status}`);
    }
    throw new Error(`超过 ${maxPolls} 次轮询仍未完成`);
  },
} satisfies ProviderDefinition<typeof rules>;
