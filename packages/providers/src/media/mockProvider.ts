/// <reference path="../../types.d.ts" />

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const version = "2.0.0";

// 模拟生成耗时，让等待、取消等 UI 状态可被真实触发。
const mockDelay: readonly [number, number] = [800, 2000];

const rules = [] as const;

const imageExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp"];
const videoExtensions = [".mp4", ".webm", ".mov", ".ogv"];

const imageMimeTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp",
};
const videoMimeTypes: Record<string, string> = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg" };

function randomDuration() {
  return Math.round(mockDelay[0] + Math.random() * (mockDelay[1] - mockDelay[0]));
}

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

function mockDirectory(kind: "images" | "videos") {
  const dataDirectory = process.env.TOONFLOW_DATA_DIR;
  if (!dataDirectory) throw new Error("未找到数据目录：process.env.TOONFLOW_DATA_DIR 未设置");
  return join(dataDirectory, "assets", "mock", kind);
}

async function mockFiles(kind: "images" | "videos", extensions: readonly string[], signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted();
  try {
    return (await readdir(mockDirectory(kind)))
      .filter(name => extensions.includes(`.${name.split(".").pop()?.toLowerCase()}`))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function mockAsset(kind: "images" | "videos", file: string, signal: AbortSignal): Promise<MediaAsset> {
  const mimeTypes = kind === "images" ? imageMimeTypes : videoMimeTypes;
  const bytes = await readFile(join(mockDirectory(kind), file), { signal });
  return { mediaType: kind === "images" ? "image" : "video", type: "binary", data: bytes, mimeType: mimeTypes[file.split(".").pop()!.toLowerCase()] ?? "" };
}

export default {
  id: "mockProvider",
  label: "Mock 媒体供应商",
  version,
  // ACT: parseProvider 要求 readme 内联为字面量，仅 version 允许引用顶层 const。
  readme: `Mock 媒体供应商：不请求任何外部服务，零损耗验证生图、生视频的完整流程。

**使用说明**

1. 生成结果直接读取数据目录 assets/mock/：图片在 mock/images，视频在 mock/videos。
2. 素材按文件名匹配请求参数：图片如 16x9-1.png（比例），视频如 5s-1.mp4（时长）；没有匹配素材时随机返回目录内任一文件，扩展名决定媒体类型。
3. 每类生成提供成功与失败两个模型，选择带「（失败）」的模型会在随机延迟后抛出错误，用于测试失败场景与错误提示。
4. 参考图、首尾帧等输入会被接收但不影响结果；每次生成固定延迟 0.8～2 秒，模拟真实等待与取消。`,
  rules,
  // ACT: parseProvider 要求 models 为纯 JSON 字面量，不能引用变量或使用展开。
  models: [
    {
      id: "mockImage",
      label: "Mock 图片",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
      imageSizes: ["1K", "2K"],
    },
    {
      id: "mockImageFail",
      label: "Mock 图片（失败）",
      type: "image",
      mode: ["text", "singleImage", "multiReference"],
      imageRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
      imageSizes: ["1K", "2K"],
    },
    {
      id: "mockVideo",
      label: "Mock 视频",
      type: "video",
      mode: ["text", "singleImage", "startEndRequired", "endFrameOptional", "startFrameOptional"],
      audio: "optional",
      durationResolutionMap: [{ duration: [5, 10], resolution: ["480P", "720P", "1080P"] }],
    },
    {
      id: "mockVideoFail",
      label: "Mock 视频（失败）",
      type: "video",
      mode: ["text", "singleImage", "startEndRequired", "endFrameOptional", "startFrameOptional"],
      audio: "optional",
      durationResolutionMap: [{ duration: [5, 10], resolution: ["480P", "720P", "1080P"] }],
    },
  ] satisfies ProviderModel[],

  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    const signal = this.signal ?? new AbortController().signal;
    await wait(signal, randomDuration());
    if (request.model.toLowerCase().includes("fail")) throw new Error("Mock 图片生成失败（失败模型的预期错误）");
    const files = await mockFiles("images", imageExtensions, signal);
    const ratio = request.ratio ? request.ratio.replace(":", "x").toLowerCase() : "";
    // ACT: 素材以文件名标注比例（如 16x9-1.png），未覆盖请求比例时回退随机挑选。
    const matched = ratio ? files.filter(file => file.toLowerCase().startsWith(`${ratio}-`)) : [];
    const pool = matched.length ? matched : files;
    if (!pool.length) throw new Error("mock 图片素材为空：请先在数据目录 assets/mock/images 放置图片");
    const file = pool[Math.floor(Math.random() * pool.length)]!;
    return [await mockAsset("images", file, signal)];
  },

  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
    const signal = this.signal ?? new AbortController().signal;
    await wait(signal, randomDuration());
    if (request.model.toLowerCase().includes("fail")) throw new Error("Mock 视频生成失败（失败模型的预期错误）");
    const files = await mockFiles("videos", videoExtensions, signal);
    const duration = typeof request.duration === "number" && Number.isFinite(request.duration) ? Math.round(request.duration) : 0;
    // ACT: 素材以文件名标注时长（如 5s-1.mp4），未覆盖请求时长时回退随机挑选。
    const matched = duration ? files.filter(file => file.toLowerCase().startsWith(`${duration}s-`)) : [];
    const pool = matched.length ? matched : files;
    if (!pool.length) throw new Error("mock 视频素材为空：请先在数据目录 assets/mock/videos 放置视频");
    const file = pool[Math.floor(Math.random() * pool.length)]!;
    return [await mockAsset("videos", file, signal)];
  },
} satisfies ProviderDefinition<typeof rules>;
