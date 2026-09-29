import { z } from "zod";
import type { MediaGenerationRequest, MediaModel } from "@toonflow/tools-scaffold/runtime";
import u from "@/utils";
import { mutateCanvasDocument, readCanvasDocument, type CanvasDocument, type CanvasNode } from "@/utils/canvas/repository";

// headless 节点函数：与节点组件内 nodeTools 同语义的文档级实现。
// 校验规则与请求组装均从 packages/nodes/*/src/index.vue 等价迁移（报错文案保持一致），
// 生成执行复用 server 的 generateMedia（P1 即时执行；P2 换队列）。

type ToolInfo = { name: string; description: string; parameters: Record<string, unknown> };
type NodeTypeMeta = { type: string; label: string; tools: ToolInfo[] };

const setPromptTool: ToolInfo = {
  name: "node:setPrompt",
  description: "修改此节点的生成提示词，支持 {{ref 1}} 等参考标记；只修改提示词，不启动生成",
  parameters: z.toJSONSchema(z.strictObject({ prompt: z.string() })),
};
const generationStatusTool: ToolInfo = {
  name: "node:getGenerationStatus",
  description: "查询生成状态（idle/running/succeeded/failed）、当前输出、最近一次生成错误和生成历史；只有 succeeded 表示生成成功",
  parameters: { type: "object", additionalProperties: false },
};
const cancelGenerationTool: ToolInfo = {
  name: "node:cancelGeneration",
  description: "请求停止当前后台生成；不会删除已有输出，不能保证供应商撤销任务或费用",
  parameters: { type: "object", additionalProperties: false },
};

export const nodeTypesMeta: NodeTypeMeta[] = [
  {
    type: "remote-imageGenerationNode", label: "图片生成",
    tools: [
      setPromptTool,
      { name: "node:getConfig", description: "读取此图片生成节点的当前配置与可选模型能力，不含密钥", parameters: { type: "object", additionalProperties: false } },
      { name: "node:setConfig", description: "修改此图片生成节点的模型、分辨率或比例；providerId 与 modelId 必须同时提供；不修改提示词、不启动生成", parameters: z.toJSONSchema(z.strictObject({ providerId: z.string().min(1).optional(), modelId: z.string().min(1).optional(), size: z.string().min(1).optional(), ratio: z.string().min(1).optional() }).refine(args => (args.providerId === undefined) === (args.modelId === undefined), "providerId 与 modelId 必须同时提供")) },
      { name: "node:generateImage", description: "按当前配置与上游参考启动图片生成（异步）", parameters: { type: "object", additionalProperties: false } },
      generationStatusTool, cancelGenerationTool,
    ],
  },
  {
    type: "remote-videoGenerationNode", label: "视频生成",
    tools: [
      setPromptTool,
      { name: "node:getConfig", description: "读取此视频生成节点的当前配置、可选视频模型能力、通用比例及适合当前引用的模式，不含密钥；时长与分辨率须符合 durationResolutionMap", parameters: { type: "object", additionalProperties: false } },
      { name: "node:setConfig", description: "修改此视频生成节点的模型、时长、分辨率、比例、模式或声音；providerId 与 modelId 必须同时提供；mode 使用返回的原始字符串或数组，须匹配当前引用", parameters: z.toJSONSchema(z.strictObject({ providerId: z.string().min(1).optional(), modelId: z.string().min(1).optional(), duration: z.number().positive().optional(), resolution: z.string().min(1).optional(), ratio: z.string().min(1).optional(), mode: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(), generateAudio: z.boolean().optional() }).refine(args => (args.providerId === undefined) === (args.modelId === undefined), "providerId 与 modelId 必须同时提供")) },
      { name: "node:generateVideo", description: "按当前配置与上游参考启动视频生成（异步）", parameters: { type: "object", additionalProperties: false } },
      generationStatusTool, cancelGenerationTool,
    ],
  },
  { type: "remote-imageNode", label: "图片", tools: [{ name: "node:setImage", description: "设置图片节点的引用文件（工作区相对路径）", parameters: z.toJSONSchema(z.strictObject({ path: z.string().min(1).max(4096), mimeType: z.string().regex(/^image\/[a-zA-Z0-9.+-]+$/) })) }] },
  { type: "remote-videoNode", label: "视频", tools: [{ name: "node:setVideo", description: "设置视频节点的引用文件（工作区相对路径）", parameters: z.toJSONSchema(z.strictObject({ path: z.string().min(1).max(4096), mimeType: z.string().regex(/^video\/[a-zA-Z0-9.+-]+$/) })) }] },
  { type: "remote-audioNode", label: "音频", tools: [{ name: "node:setAudio", description: "设置音频节点的引用文件（工作区相对路径）", parameters: z.toJSONSchema(z.strictObject({ path: z.string().min(1).max(4096), mimeType: z.string().regex(/^audio\/[a-zA-Z0-9.+-]+$/) })) }] },
  { type: "remote-textNode", label: "文本", tools: [{ name: "node:setText", description: "设置文本内容", parameters: z.toJSONSchema(z.strictObject({ text: z.string() })) }] },
];

export function findNodeTypeMeta(type: string) {
  return nodeTypesMeta.find(meta => meta.type === type || meta.type === `remote-${type}`);
}

// ---- 模型能力（与节点端 getMatchingModes 等价的纯函数） ----

type ModeEntry = string | string[];

export function modelModes(model: MediaModel | undefined): ModeEntry[] {
  const mode = model?.mode;
  return Array.isArray(mode) ? (mode as ModeEntry[]) : [];
}

export function getMatchingModes(model: MediaModel | undefined, counts: { image: number; video: number; audio: number }) {
  return modelModes(model).filter(mode => {
    if (Array.isArray(mode)) {
      return counts.image + counts.video + counts.audio > 0 && (["image", "video", "audio"] as const).every(type =>
        counts[type] <= Number(mode.find(item => item.startsWith(`${type}Reference:`))?.split(":")[1] ?? 0));
    }
    if (mode === "text") return counts.image + counts.video + counts.audio === 0;
    if (mode === "singleImage") return counts.image === 1;
    if (mode === "startEndRequired") return counts.image === 2;
    return ["endFrameOptional", "startFrameOptional"].includes(mode) && counts.image >= 1 && counts.image <= 2;
  });
}

function videoDurations(model: MediaModel) {
  return [...new Set((model.durationResolutionMap ?? []).flatMap(item => item.duration))].sort((left, right) => left - right);
}

function videoResolutions(model: MediaModel, duration?: number) {
  return [...new Set((model.durationResolutionMap ?? []).filter(item => duration === undefined || item.duration.includes(duration)).flatMap(item => item.resolution))];
}

async function mediaModels() {
  return u.mediaGeneration.listMediaModels();
}

function parseNodeModel(data: Record<string, unknown>) {
  try {
    const parsed = JSON.parse(String(data.model ?? "null")) as unknown;
    return Array.isArray(parsed) && parsed.length === 2 && parsed.every(item => typeof item === "string")
      ? { providerId: parsed[0], modelId: parsed[1] } : undefined;
  } catch { return undefined; }
}

// ---- 参考组装（与 useNodeReferences + 生成请求组装等价） ----

type Reference = { dataType: string; url: string; mimeType?: string };

export function collectReferences(document: CanvasDocument, nodeId: string): Reference[] {
  const order = new Map((((document.nodes.find(node => node.id === nodeId)?.data ?? {}).referenceOrder as Record<string, string[]> | undefined)?.in ?? [])
    .map((key, index) => [key, index]));
  const byKey = new Map<string, Reference>();
  for (const edge of document.edges) {
    if (edge.target !== nodeId || edge.sourceHandle === undefined || (edge.targetHandle ?? "in") !== "in") continue;
    const source = document.nodes.find(node => node.id === edge.source);
    const outputs = (source?.data?.outputs ?? {}) as Record<string, { dataType?: string; value?: { url?: string; mimeType?: string } } | undefined>;
    for (const output of Object.values(outputs)) {
      if (output?.dataType && output.value?.url) {
        byKey.set(`${edge.source}:${output.dataType}:${output.value.url}`, { dataType: output.dataType, url: output.value.url, mimeType: output.value.mimeType });
      }
    }
  }
  return [...byKey.values()].sort((left, right) => {
    const leftIndex = order.get(left.url) ?? order.size;
    const rightIndex = order.get(right.url) ?? order.size;
    return leftIndex - rightIndex;
  });
}

function mediaCounts(references: Reference[]) {
  return {
    image: references.filter(item => item.dataType === "IMAGE").length,
    video: references.filter(item => item.dataType === "VIDEO").length,
    audio: references.filter(item => item.dataType === "AUDIO").length,
  };
}

// ---- 节点函数执行 ----

export async function dispatchNodeTool(directory: string, canvasId: string, nodeId: string, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const { document } = await readCanvasDocument(directory, canvasId);
  const node = document.nodes.find(item => item.id === nodeId);
  if (!node) throw Object.assign(new Error(`节点不存在：${nodeId}，请先 getCanvas 查询`), { status: 404 });
  const data = (node.data ??= {}) as Record<string, unknown>;
  const type = String(node.type ?? "").replace(/^remote-/, "");
  const models = await mediaModels();
  const selectedModel = (() => {
    const model = parseNodeModel(data);
    return model ? models.find(item => item.providerId === model.providerId && item.modelId === model.modelId) : undefined;
  })();

  if (name === "node:getConfig") {
    if (type === "imageGenerationNode") {
      return {
        config: { providerId: selectedModel?.providerId ?? "", modelId: selectedModel?.modelId ?? "", size: data.size ?? "", ratio: data.ratio ?? "16:9", prompt: data.prompt ?? "" },
        models: models.filter(item => item.type === "image"),
      };
    }
    if (type === "videoGenerationNode") {
      return {
        config: {
          providerId: selectedModel?.providerId ?? "", modelId: selectedModel?.modelId ?? "",
          duration: data.duration, resolution: data.resolution ?? "", ratio: data.ratio ?? "16:9",
          mode: data.mode ? safeJsonParse(data.mode) : undefined, generateAudio: data.generateAudio === true,
        },
        models: models.filter(item => item.type === "video"),
        matchingModes: getMatchingModes(selectedModel, mediaCounts(collectReferences(document, nodeId))),
      };
    }
    return { config: { label: data.label }, models: [] };
  }

  if (name === "node:setPrompt") {
    const prompt = z.string().parse(args.prompt);
    await mutateNodeData(directory, canvasId, nodeId, target => {
      target.prompt = prompt;
      target.promptModel = prompt.split("\n").map(text => [{ type: "Write", text }]);
    });
    return { prompt };
  }

  if (name === "node:setImage" || name === "node:setVideo" || name === "node:setAudio") {
    const mediaType = name === "node:setImage" ? "image" : name === "node:setVideo" ? "video" : "audio";
    const schema = z.strictObject({ path: z.string().min(1).max(4096), mimeType: z.string().regex(new RegExp(`^${mediaType}/[a-zA-Z0-9.+-]+$`)) });
    const parsed = schema.parse(args);
    await mutateNodeData(directory, canvasId, nodeId, target => {
      target.outputs = { ...(target.outputs as object ?? {}), [mediaType]: { dataType: mediaType.toUpperCase(), value: { url: parsed.path, mimeType: parsed.mimeType } } };
    });
    return { path: parsed.path };
  }

  if (name === "node:setText") {
    const text = z.string().parse(args.text);
    await mutateNodeData(directory, canvasId, nodeId, target => { target.text = text; });
    return { text };
  }

  if (name === "node:setConfig") {
    if (type === "imageGenerationNode") return setImageConfig(directory, canvasId, node, args, models);
    if (type === "videoGenerationNode") return setVideoConfig(directory, canvasId, document, node, args, models);
    throw new Error(`节点类型 ${type} 不支持 setConfig`);
  }

  if (name === "node:generateImage" || name === "node:generateVideo") {
    // 生成即入队（挂机批量语义）：立即返回 taskId，状态经 node:getGenerationStatus / getGenerationStatuses 查询。
    const { enqueueNode } = await import("@/utils/canvas/queue");
    return enqueueNode(directory, canvasId, nodeId);
  }

  if (name === "node:getGenerationStatus") {
    const { nodeRuntimeStatus } = await import("@/utils/canvas/queue");
    const runtime = nodeRuntimeStatus(directory, nodeId);
    if (runtime) return { status: runtime.status === "backoff" ? "running" : runtime.status, outputs: data.outputs ?? {}, error: runtime.error, taskId: runtime.taskId };
    const history = (data.generationHistory as Record<string, unknown>[] | undefined) ?? [];
    const outputs = data.outputs ?? {};
    const last = history.at(-1);
    const status = last?.status === "running" ? "failed" : String(last?.status ?? "idle");
    return { status, outputs, error: last?.error, history: history.slice(-10) };
  }

  if (name === "node:cancelGeneration") {
    const { cancelQueueTask } = await import("@/utils/canvas/queue");
    try {
      const result = cancelQueueTask({ nodeId, workspace: directory });
      return { cancellationRequested: true, ...result };
    } catch {
      return { cancellationRequested: false, note: "该节点当前没有队列任务" };
    }
  }

  throw new Error(`节点未注册函数 ${name}，请先通过 getCanvas 查询可用节点函数`);
}

function safeJsonParse(value: unknown) {
  try { return JSON.parse(String(value)); } catch { return value; }
}

async function mutateNodeData(directory: string, canvasId: string, nodeId: string, mutator: (data: Record<string, unknown>) => void) {
  await mutateCanvasDocument(directory, canvasId, document => {
    const node = document.nodes.find(item => item.id === nodeId);
    if (!node) throw Object.assign(new Error(`节点不存在：${nodeId}`), { status: 404 });
    mutator((node.data ??= {}) as Record<string, unknown>);
  });
}

async function setImageConfig(directory: string, canvasId: string, node: CanvasNode, args: Record<string, unknown>, models: MediaModel[]) {
  const schema = z.strictObject({
    providerId: z.string().min(1).optional(), modelId: z.string().min(1).optional(),
    size: z.string().min(1).optional(), ratio: z.string().min(1).optional(),
  }).refine(value => (value.providerId === undefined) === (value.modelId === undefined), "providerId 与 modelId 必须同时提供");
  const parsed = schema.parse(args);
  const data = (node.data ?? {}) as Record<string, unknown>;
  let selected = selectedFrom(models.filter(item => item.type === "image"), parsed, data);
  if (parsed.size !== undefined && !(selected?.imageSizes ?? []).includes(parsed.size)) throw new Error(`当前模型不支持尺寸 ${parsed.size}，可选：${(selected?.imageSizes ?? []).join("、") || "（无）"}`);
  if (parsed.ratio !== undefined && !(selected?.imageRatios ?? []).includes(parsed.ratio)) throw new Error(`当前模型不支持比例 ${parsed.ratio}，可选：${(selected?.imageRatios ?? []).join("、")}`);
  await mutateNodeData(directory, canvasId, node.id, target => {
    if (selected) target.model = JSON.stringify([selected.providerId, selected.modelId]);
    if (parsed.size !== undefined) target.size = parsed.size;
    if (parsed.ratio !== undefined) target.ratio = parsed.ratio;
  });
  return { providerId: selected?.providerId, modelId: selected?.modelId, size: parsed.size ?? data.size, ratio: parsed.ratio ?? data.ratio };
}

function selectedFrom(models: MediaModel[], parsed: { providerId?: string; modelId?: string }, data: Record<string, unknown>) {
  if (parsed.providerId === undefined) {
    const current = parseNodeModel(data);
    return current ? models.find(item => item.providerId === current.providerId && item.modelId === current.modelId) : undefined;
  }
  const choice = models.find(item => item.providerId === parsed.providerId && item.modelId === parsed.modelId);
  if (!choice) throw new Error("请选择 getConfig 返回的有效模型");
  return choice;
}

async function setVideoConfig(directory: string, canvasId: string, document: CanvasDocument, node: CanvasNode, args: Record<string, unknown>, models: MediaModel[]) {
  const schema = z.strictObject({
    providerId: z.string().min(1).optional(), modelId: z.string().min(1).optional(),
    duration: z.number().positive().optional(), resolution: z.string().min(1).optional(),
    ratio: z.string().min(1).optional(), mode: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    generateAudio: z.boolean().optional(),
  }).refine(value => (value.providerId === undefined) === (value.modelId === undefined), "providerId 与 modelId 必须同时提供");
  const parsed = schema.parse(args);
  const data = (node.data ?? {}) as Record<string, unknown>;
  const videoModels = models.filter(item => item.type === "video");
  const selected = selectedFrom(videoModels, parsed, data);
  if (!selected) throw new Error("请先选择视频模型（providerId + modelId）");
  const durations = videoDurations(selected);
  if (parsed.duration !== undefined && !durations.includes(parsed.duration)) throw new Error(`当前模型不支持时长 ${parsed.duration}，可选：${durations.join("、")}`);
  const duration = parsed.duration ?? (durations.includes(Number(data.duration)) ? Number(data.duration) : durations[0]);
  const resolutions = videoResolutions(selected, duration);
  if (parsed.resolution !== undefined && !resolutions.includes(parsed.resolution)) throw new Error(`当前时长不支持分辨率 ${parsed.resolution}，可选：${resolutions.join("、")}`);
  if (parsed.mode !== undefined) {
    const references = collectReferences(document, node.id);
    const matching = getMatchingModes(selected, mediaCounts(references));
    if (!matching.some(item => JSON.stringify(item) === JSON.stringify(safeJsonParse(parsed.mode)))) throw new Error("所选模式不受当前模型支持或不适用于当前引用，请根据模型能力及已连接素材选择");
  }
  if (parsed.generateAudio !== undefined && selected.audio !== "optional" && parsed.generateAudio !== (selected.audio === true)) throw new Error("当前模型不支持切换声音，请查看 getConfig 返回的 audio 能力");
  await mutateNodeData(directory, canvasId, node.id, target => {
    target.model = JSON.stringify([selected.providerId, selected.modelId]);
    if (duration !== undefined) target.duration = duration;
    if (parsed.resolution !== undefined) target.resolution = parsed.resolution;
    if (parsed.ratio !== undefined) target.ratio = parsed.ratio;
    if (parsed.mode !== undefined) target.mode = typeof parsed.mode === "string" ? parsed.mode : JSON.stringify(parsed.mode);
    if (parsed.generateAudio !== undefined) target.generateAudio = parsed.generateAudio;
  });
  return { providerId: selected.providerId, modelId: selected.modelId, duration };
}

// ---- 生成执行（P1 即时；P2 替换为队列入队） ----

export async function runGeneration(directory: string, canvasId: string, nodeId: string, mediaType: "image" | "video", signal: AbortSignal) {
  const { document } = await readCanvasDocument(directory, canvasId);
  const node = document.nodes.find(item => item.id === nodeId);
  if (!node) throw Object.assign(new Error(`节点不存在：${nodeId}`), { status: 404 });
  const data = (node.data ?? {}) as Record<string, unknown>;
  const type = String(node.type ?? "").replace(/^remote-/, "");
  if (type !== `${mediaType}GenerationNode`) throw new Error(`节点类型不支持 ${mediaType} 生成`);
  const model = parseNodeModel(data);
  if (!model) throw new Error("请先选择模型，可通过 node:setConfig 配置（providerId + modelId）");
  const models = await mediaModels();
  const selected = models.find(item => item.providerId === model.providerId && item.modelId === model.modelId);
  if (!selected) throw new Error("当前配置的模型不可用，请用 node:setConfig 重新选择");
  const references = collectReferences(document, nodeId);
  const counts = mediaCounts(references);
  const prompt = String(data.prompt ?? "");
  if (!prompt.trim()) throw new Error("请先填写提示词");

  const request: MediaGenerationRequest & { outputDirectory: string } = {
    providerId: selected.providerId, modelId: selected.modelId, prompt, outputDirectory: `assets/${nodeId}`,
  };
  const images = references.filter(item => item.dataType === "IMAGE").map(item => ({ path: item.url, mimeType: item.mimeType ?? "image/png" }));
  const frameMode = ["startEndRequired", "endFrameOptional", "startFrameOptional"].includes(String(safeJsonParse(data.mode) ?? data.mode));
  if (mediaType === "image") {
    request.ratio = data.ratio ? String(data.ratio) : undefined;
    request.size = data.size ? String(data.size) : undefined;
    if (images.length) request.images = images;
    request.mode = typeof data.mode === "string" && data.mode ? safeJsonParse(data.mode) : undefined;
  } else {
    if (modelModes(selected).length && !getMatchingModes(selected, counts).length) throw new Error("当前模型没有适合这些参考素材的生成模式，请更换模型或调整引用");
    const modeValue = data.mode ? safeJsonParse(data.mode) : undefined;
    request.mode = modeValue as MediaGenerationRequest["mode"];
    request.duration = data.duration !== undefined ? Number(data.duration) : undefined;
    request.resolution = data.resolution ? String(data.resolution) : undefined;
    request.ratio = data.ratio ? String(data.ratio) : undefined;
    request.generateAudio = selected.audio === "optional" ? data.generateAudio === true : selected.audio === true;
    request.images = frameMode ? undefined : images;
    if (frameMode) {
      request.firstFrame = (modeValue !== "startFrameOptional" || images.length > 1) ? images[0] : undefined;
      request.lastFrame = images[modeValue === "startFrameOptional" && images.length === 1 ? 0 : 1];
    }
    request.videos = references.filter(item => item.dataType === "VIDEO").map(item => ({ path: item.url, mimeType: item.mimeType ?? "video/mp4" }));
    request.audios = references.filter(item => item.dataType === "AUDIO").map(item => ({ path: item.url, mimeType: item.mimeType ?? "audio/mpeg" }));
  }

  const startedAt = Date.now();
  const historyId = crypto.randomUUID();
  const record: Record<string, unknown> = {
    id: historyId, startedAt, finishedAt: startedAt, status: "running", prompt,
    model: `${selected.providerId}/${selected.modelId}`,
    inputs: [
      ...images, ...(request.firstFrame ? [request.firstFrame] : []), ...(request.lastFrame ? [request.lastFrame] : []),
      ...(request.videos ?? []), ...(request.audios ?? []),
    ].map(item => ({ url: item.path, mimeType: item.mimeType })),
  };
  await appendHistory(directory, canvasId, nodeId, record);
  try {
    const results = await u.mediaGeneration.generateMedia(directory, mediaType, request, signal);
    const first = results[0];
    if (!first) throw new Error("供应商未返回结果");
    record.status = "succeeded";
    record.finishedAt = Date.now();
    record.files = results.map(item => ({ url: item.path, mimeType: item.mimeType }));
    await mutateNodeData(directory, canvasId, nodeId, target => {
      target.outputs = { ...(target.outputs as object ?? {}), [mediaType]: { dataType: mediaType.toUpperCase(), value: { url: first.path, mimeType: first.mimeType } } };
    });
    await appendHistory(directory, canvasId, nodeId, record, historyId);
    return { status: "succeeded", outputs: { [mediaType]: { url: first.path, mimeType: first.mimeType } } };
  } catch (error) {
    record.status = "failed";
    record.finishedAt = Date.now();
    record.error = error instanceof Error ? error.message : String(error);
    await appendHistory(directory, canvasId, nodeId, record, historyId);
    throw error;
  }
}

function appendHistory(directory: string, canvasId: string, nodeId: string, record: Record<string, unknown>, replaceId?: string) {
  return mutateNodeData(directory, canvasId, nodeId, target => {
    const history = ((target.generationHistory ?? []) as Record<string, unknown>[]).filter(item => replaceId === undefined || item.id !== replaceId);
    history.push(record);
    target.generationHistory = history.slice(-50);
  });
}
