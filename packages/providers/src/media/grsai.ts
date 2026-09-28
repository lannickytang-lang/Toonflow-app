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
    value: "https://grsai.dakka.com.cn",
    props: { placeholder: "https://grsai.dakka.com.cn" },
  },
] as const;

const version = "1.1.0";
const drawSubmitPath = "/v1/draw/completions";
const drawResultPath = "/v1/draw/result";
const videoSubmitPath = "/v1/api/generate";
const videoResultPath = "/v1/api/result";
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
  return String(source?.msg || source?.message || source?.error || "").trim();
}

function toAspectRatio(ratio?: string) {
  const [width, height] = (ratio || "16:9").split(":").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !height) return "landscape";
  return width < height ? "portrait" : "landscape";
}

export default {
  id: "grsai",
  label: "grsai",
  version,
  readme: "grsai 中转平台,支持 gpt-image / nano-banana 系列生图模型与 minimax-h3 视频生成,在 grsai 控制台获取 API Key。",
  rules,
  models: [
    { id: "gpt-image-2", label: "GPT Image 2", type: "image", mode: ["text", "singleImage", "multiReference"], imageRatios: ["auto", "1:1", "3:2", "2:3"] },
    { id: "gpt-image-2-vip", label: "GPT Image 2 VIP", type: "image", mode: ["text", "singleImage", "multiReference"], imageRatios: ["auto", "1:1", "3:2", "2:3"] },
    { id: "gpt-image-2.5", label: "GPT Image 2.5", type: "image", mode: ["text", "singleImage", "multiReference"], imageRatios: ["auto", "1:1", "3:2", "2:3"] },
    { id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", type: "image", mode: ["text", "singleImage", "multiReference"], imageRatios: ["auto", "1:1", "3:2", "2:3"] },
    { id: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst", type: "image", mode: ["text", "singleImage", "multiReference"], imageRatios: ["auto", "1:1", "3:2", "2:3"] },
    { id: "nano-banana", label: "Nano Banana", type: "image", mode: ["text", "singleImage", "multiReference"], imageRatios: ["auto", "1:1", "3:2", "2:3"] },
    { id: "nano-banana-2", label: "Nano Banana 2", type: "image", mode: ["text", "singleImage", "multiReference"], imageRatios: ["auto", "1:1", "3:2", "2:3"] },
    { id: "nano-banana-fast", label: "Nano Banana Fast", type: "image", mode: ["text", "singleImage", "multiReference"], imageRatios: ["auto", "1:1", "3:2", "2:3"] },
    {
      id: "minimax-h3",
      label: "MiniMax H3",
      type: "video",
      mode: ["text", "singleImage", ["imageReference:9", "audioReference:3"]],
      audio: true,
      durationResolutionMap: [{ duration: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "768p", "1080p"] }],
    },
  ] satisfies ProviderModel[],
  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const apiKey = this.config.apiKey?.trim().replace(/^Bearer(?:\s+|$)/i, "");
    if (!apiKey) throw new Error("请填写 API Key");
    const baseUrl = (this.config.baseUrl?.trim() || "https://grsai.dakka.com.cn").replace(/\/$/, "");
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

    const urls = (request.images ?? []).map(refToDataUri);
    const payload: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      size: request.ratio || "2:3",
      variants: Math.min(Math.max(request.n ?? 1, 1), 2),
      webHook: "-1",
    };
    if (urls.length) payload.urls = urls;

    const signal = AbortSignal.any([AbortSignal.timeout(17 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const submit = await this.tool.fetch(`${baseUrl}${drawSubmitPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    const submitData = await submit.json().catch(() => ({}));
    if (!submit.ok) throw new Error(`提交任务失败:HTTP ${submit.status} ${platformMessage(submitData)}`);
    const taskId = submitData?.data?.id || submitData?.data?.task_id || submitData?.id || submitData?.task_id;
    if (!taskId) throw new Error(`提交响应缺少任务 id:${JSON.stringify(submitData).slice(0, 300)}`);

    for (let polls = 1; polls <= maxPolls; polls += 1) {
      await wait(signal, pollIntervalMs);
      const poll = await this.tool.fetch(`${baseUrl}${drawResultPath}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: taskId }),
        signal,
      });
      if (poll.status === 401 || poll.status === 403) throw new Error(`查询任务被拒绝(HTTP ${poll.status}),请检查 API Key`);
      if (!poll.ok) continue;
      const data = await poll.json().catch(() => ({}));
      const code = data?.code;
      if (code !== undefined && code !== 0 && code !== "0") throw new Error(`平台返回 code=${code} ${platformMessage(data)}`);
      const inner = data?.data ?? {};
      const status = String(inner.status || "").trim().toLowerCase();
      if (status === "succeeded") {
        const results = inner.results ?? inner.result ?? (inner.url ? [{ url: inner.url }] : null);
        const list = Array.isArray(results) ? results : results ? [results] : [];
        const assets = list.map((item: unknown) => (typeof item === "string" ? item : (item as { url?: unknown })?.url)).filter(Boolean);
        if (!assets.length) throw new Error(`成功响应缺少结果 url:${JSON.stringify(data).slice(0, 300)}`);
        return assets.map((url: string) => ({ mediaType: "image" as const, type: "url" as const, url }));
      }
      if (status === "failed" || status === "error") throw new Error(String(inner.failure_reason || inner.error || "图片生成失败"));
    }
    throw new Error(`超过 ${maxPolls} 次轮询仍未完成`);
  },
  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
    const apiKey = this.config.apiKey?.trim().replace(/^Bearer(?:\s+|$)/i, "");
    if (!apiKey) throw new Error("请填写 API Key");
    const baseUrl = (this.config.baseUrl?.trim() || "https://grsai.dakka.com.cn").replace(/\/$/, "");
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

    const duration = Math.min(Math.max(Math.round(request.duration ?? 6), 1), 15);
    const resolution = (request.resolution ?? "768p").toLowerCase();
    if (!["480p", "768p", "1080p"].includes(resolution)) throw new Error(`不支持的分辨率:${request.resolution}`);
    if (resolution === "1080p" && duration > 10) throw new Error("1080p 分辨率下时长最多 10 秒");

    const images = request.firstFrame ? [request.firstFrame, ...(request.images ?? [])] : (request.images ?? []);
    const refs = images.slice(0, 9).map(refToDataUri);
    const audios = (request.audios ?? []).slice(0, 3).map(refToDataUri);

    const payload: Record<string, unknown> = {
      model: "minimax-h3",
      prompt: request.prompt,
      aspectRatio: toAspectRatio(request.ratio),
      resolution,
      duration,
      replyType: "async",
    };
    if (refs.length) payload.images = refs;
    if (audios.length) payload.audios = audios;

    const signal = AbortSignal.any([AbortSignal.timeout(20 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const submit = await this.tool.fetch(`${baseUrl}${videoSubmitPath}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    const submitData = await submit.json().catch(() => ({}));
    if (!submit.ok) throw new Error(`提交任务失败:HTTP ${submit.status} ${platformMessage(submitData)}`);
    const taskId = submitData?.id || submitData?.data?.id || submitData?.task_id || submitData?.data?.task_id;
    if (!taskId) throw new Error(`提交响应缺少任务 id:${JSON.stringify(submitData).slice(0, 300)}`);

    for (let polls = 1; polls <= maxPolls; polls += 1) {
      await wait(signal, pollIntervalMs);
      const poll = await this.tool.fetch(`${baseUrl}${videoResultPath}?id=${encodeURIComponent(String(taskId))}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });
      if (poll.status === 401 || poll.status === 403) throw new Error(`查询任务被拒绝(HTTP ${poll.status}),请检查 API Key`);
      if (!poll.ok) continue;
      const data = await poll.json().catch(() => ({}));
      const inner = (data?.data && typeof data.data === "object" ? data.data : data) as { status?: unknown; results?: unknown; result?: unknown; url?: unknown; error?: unknown };
      const status = String(inner.status || "").trim().toLowerCase();
      if (status === "succeeded") {
        const results = inner.results ?? inner.result ?? (inner.url ? [{ url: inner.url }] : null);
        const list = Array.isArray(results) ? results : results ? [results] : [];
        const assets = list.map((item: unknown) => (typeof item === "string" ? item : (item as { url?: unknown })?.url)).filter(Boolean);
        if (!assets.length) throw new Error(`成功响应缺少结果 url:${JSON.stringify(data).slice(0, 300)}`);
        return assets.map((url: string) => ({ mediaType: "video" as const, type: "url" as const, url }));
      }
      if (status === "violation") throw new Error("内容涉嫌违规,生成被平台拒绝");
      if (status === "failed") throw new Error(String(inner.error || "视频生成失败"));
    }
    throw new Error(`超过 ${maxPolls} 次轮询仍未完成`);
  },
} satisfies ProviderDefinition<typeof rules>;
