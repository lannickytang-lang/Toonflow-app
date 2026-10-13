const rules = [
  {
    type: "input",
    field: "baseUrl" as const,
    title: "请求地址",
    value: "https://uu1139071-791317494c9b.westd.seetacloud.com:8443",
    props: { placeholder: "https://主机:8443" },
  },
] as const;

const version = "1.0.0";
const defaultBaseUrl = "https://uu1139071-791317494c9b.westd.seetacloud.com:8443";
const workflowId = "U08-MiniMax-H3-极速生成10S只要2分半";
const pollIntervalMs = 2000;
const maxPolls = 600;

const aspectRatioLabels: Record<string, string> = {
  "1:1": "1:1 (Square)",
  "2:3": "2:3 (Portrait Photo)",
  "3:2": "3:2 (Photo)",
  "3:4": "3:4 (Portrait Standard)",
  "4:3": "4:3 (Standard)",
  "9:16": "9:16 (Portrait Widescreen)",
  "16:9": "16:9 (Widescreen)",
  "21:9": "21:9 (Ultrawide)",
};

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

function mediaValue(input: MediaInput) {
  if (input.type === "url") return input.url;
  const data = input.type === "binary" ? Buffer.from(input.data).toString("base64") : input.data;
  return data.startsWith("data:") ? data : `data:${input.mimeType};base64,${data}`;
}

function messageOf(data: unknown) {
  const source = data as { msg?: unknown; message?: unknown; error?: unknown };
  const error = source?.error;
  const inner = typeof error === "object" && error ? (error as { message?: unknown }).message : undefined;
  return String(source?.msg || source?.message || inner || (typeof error === "string" ? error : "") || "").trim();
}

function aspectRatioOf(ratio?: string) {
  const key = (ratio || "16:9").trim();
  if (aspectRatioLabels[key]) return aspectRatioLabels[key];
  if (Object.values(aspectRatioLabels).includes(key)) return key;
  throw new Error("不支持的画面比例，可选 1:1、2:3、3:2、3:4、4:3、9:16、16:9、21:9");
}

function durationOf(duration?: number) {
  const value = duration ?? 10;
  if (!Number.isInteger(value) || value < 2 || value > 15) throw new Error("时长须为 2 到 15 的整数秒");
  return value;
}

function baseUrlOf(value: unknown) {
  const baseUrl = String(value ?? "").trim().replace(/\/$/, "") || defaultBaseUrl;
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("请求地址须为 http 或 https");
  return baseUrl;
}

function promptIdOf(data: Record<string, unknown>) {
  const nested = data.data && typeof data.data === "object" ? data.data as Record<string, unknown> : undefined;
  const id = data.prompt_id || nested?.prompt_id || data.id;
  if (typeof id !== "string" || !id.trim() || id.startsWith("workflow-")) return "";
  return id.trim();
}

function absoluteMediaUrl(baseUrl: string, url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

export default {
  id: "zealmanComfy",
  label: "Zealman ComfyUI",
  version,
  readme: "云端 Zealman ComfyUI 的 MiniMax H3 极速工作流。实例无密钥，填写请求地址即可。参考图最多 2 张、参考音频最多 2 段，顺序对应提示词中的图1、图2、音频1、音频2。",
  rules,
  models: [
    {
      id: "h3Fast10s",
      label: "MiniMax H3 极速10秒",
      type: "video",
      audio: true,
      mode: [["imageReference:2", "audioReference:2"]],
      durationResolutionMap: [{ duration: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["默认"] }],
    },
  ],

  async validateConfig(config) {
    let baseUrl = "";
    try {
      baseUrl = baseUrlOf(config.baseUrl);
    } catch (error) {
      return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
    }
    try {
      const response = await this.tool.fetch(`${baseUrl}/api/workflow/result?prompt_id=probe-not-exist`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return { ok: false, errors: [`连通失败：HTTP ${response.status}`] };
      const data = await response.json().catch(() => null) as { success?: boolean } | null;
      if (!data || data.success !== true) return { ok: false, errors: ["连通失败：结果接口没有返回 success"] };
      return { ok: true };
    } catch (error) {
      return { ok: false, errors: [`连通失败：${error instanceof Error ? error.message : String(error)}`] };
    }
  },

  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
    const baseUrl = baseUrlOf(this.config.baseUrl);
    if (!request.prompt?.trim()) throw new Error("请输入提示词");
    const images = request.images ?? [];
    const audios = request.audios ?? [];
    if (images.length > 2) throw new Error("最多 2 张参考图，依次对应提示词图1、图2");
    if (audios.length > 2) throw new Error("最多 2 段参考音频，依次对应提示词音频1、音频2");

    const ratio = aspectRatioOf(request.ratio);
    // ACT: 百万像素按工作流示例固定为生成 0.4、放大 1；画布分辨率档「默认」不改这两个值。
    const inputValues: Record<string, unknown> = {
      aspect_ratio: ratio,
      megapixels: 0.4,
      value: durationOf(request.duration),
      aspect_ratio_2: ratio,
      megapixels_2: 1,
      prompt: request.prompt,
    };
    images.forEach((image, index) => {
      inputValues[`ref_image_${index}`] = mediaValue(image);
    });
    audios.forEach((audio, index) => {
      inputValues[`ref_audio_${index}`] = mediaValue(audio);
    });

    const signal = AbortSignal.any([AbortSignal.timeout(20 * 60_000), ...(this.signal ? [this.signal] : [])]);
    const submit = await this.tool.fetch(`${baseUrl}/api/workflow/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow_id: workflowId, input_values: inputValues }),
      signal,
    });
    const submitText = await submit.text();
    let submitData: Record<string, unknown> = {};
    try {
      submitData = submitText ? JSON.parse(submitText) : {};
    } catch {
      submitData = {};
    }
    if (!submit.ok || submitData.success === false) {
      throw new Error(`提交任务失败: HTTP ${submit.status} ${messageOf(submitData) || submitText.slice(0, 300)}`);
    }
    const promptId = promptIdOf(submitData);
    if (!promptId) throw new Error(`提交响应缺少 prompt_id: ${submitText.slice(0, 300)}`);

    // ACT: 查不到的 prompt_id 也会一直 pending，只能靠 20 分钟超时结束。
    for (let polls = 1; polls <= maxPolls; polls += 1) {
      if (polls > 1) await wait(signal, pollIntervalMs);
      const poll = await this.tool.fetch(`${baseUrl}/api/workflow/result?prompt_id=${encodeURIComponent(promptId)}`, { signal });
      if (!poll.ok) continue;
      const data = await poll.json().catch(() => null) as {
        success?: boolean;
        pending?: boolean;
        results?: { type?: string; url?: string }[];
      } | null;
      if (!data) continue;
      if (data.success === false) throw new Error(messageOf(data) || "视频生成失败");
      const results = Array.isArray(data.results) ? data.results : [];
      const videos = results.flatMap((item) => {
        const url = typeof item?.url === "string" ? item.url : "";
        if (!url) return [];
        if (item.type === "video" || /\.(mp4|webm|mov|mkv|m4v)(\?|$)/i.test(url)) return [absoluteMediaUrl(baseUrl, url)];
        return [];
      });
      if (videos.length) return videos.map((url) => ({ mediaType: "video" as const, type: "url" as const, url }));
      if (data.pending === false) throw new Error(`任务结束但没有视频: ${JSON.stringify(data).slice(0, 300)}`);
    }
    throw new Error("超过 20 分钟仍未完成");
  },
} satisfies ProviderDefinition<typeof rules>;
