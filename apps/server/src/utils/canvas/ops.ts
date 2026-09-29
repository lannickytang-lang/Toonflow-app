import { z } from "zod";
import { canvasSchemas } from "@toonflow/tool-canvas/runtime";
import u from "@/utils";
import type { MediaModel } from "@toonflow/tools-scaffold/runtime";
import { createCanvasDocument, listCanvasFiles, mutateCanvasDocument, readCanvasDocument, type CanvasDocument, type CanvasNode } from "@/utils/canvas/repository";
import { collectReferences, dispatchNodeTool, findNodeTypeMeta, getMatchingModes, modelModes, nodeTypesMeta } from "@/utils/canvas/nodeTools";

// headless 画布结构操作：与页面 useCanvasTools 同语义的文档级实现（单一画布文档读改写）。
// 连线校验为基础版（节点/端口存在、方向与数据类型匹配、无重复），与页面 validateConnection 保持一致的拒绝口径。

const nodeSizeEstimate = { width: 280, height: 170 };
const columnGap = 90;
const rowGap = 60;

type EdgeLike = { id?: string; source: string; target: string; sourceHandle?: string; targetHandle?: string };

export async function resolveActiveCanvasId(directory: string, canvasId?: string) {
  if (canvasId) {
    const canvases = await listCanvasFiles(directory);
    if (!canvases.some(item => item.id === canvasId)) throw Object.assign(new Error(`画布不存在：${canvasId}，可选：${canvases.map(item => item.id).join("、") || "（无）"}`), { status: 404 });
    return canvasId;
  }
  const canvases = await listCanvasFiles(directory);
  if (!canvases.length) throw Object.assign(new Error("工作区还没有画布，可先 addCanvas 创建"), { status: 404 });
  return canvases[0]!.id;
}

export async function getCanvasState(directory: string, canvasId?: string) {
  const activeId = await resolveActiveCanvasId(directory, canvasId);
  const { document, revision } = await readCanvasDocument(directory, activeId);
  const nodeTools = document.nodes.flatMap(node => {
    const meta = findNodeTypeMeta(String(node.type ?? ""));
    if (!meta) return [];
    return meta.tools.map(tool => ({
      nodeId: node.id, name: tool.name, nodeLabel: String((node.data as Record<string, unknown> | undefined)?.label ?? node.id),
      description: tool.description, parameters: tool.parameters,
    }));
  });
  return {
    id: activeId, revision, canvases: await listCanvasFiles(directory),
    nodes: document.nodes, edges: document.edges, viewport: document.viewport ?? {},
    availableNodeTypes: nodeTypesMeta.map(meta => ({ type: meta.type, label: meta.label, tools: meta.tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) })),
    nodeTools,
  };
}

export async function addCanvas(directory: string, name?: string) {
  const { canvasId } = await createCanvasDocument(directory, name);
  return getCanvasState(directory, canvasId);
}

export async function renameCanvas(directory: string, canvasId: string, name: string) {
  // 重命名 = 文件改名；目标已存在由 renameWorkspaceFile 拒绝。
  const target = /\.json$/.test(name) ? name : `${name}.json`;
  if (target !== canvasId) {
    const { resolveWorkspacePath, renameWorkspaceFile } = await import("@/utils/workspace/files");
    const { path: source } = await resolveWorkspacePath(directory, canvasId);
    const { path: targetPath } = await resolveWorkspacePath(directory, target);
    await renameWorkspaceFile(source, targetPath);
  }
  return target;
}

function handleOf(document: CanvasDocument, nodeId: string, handleId: string | undefined, kind: "source" | "target") {
  const node = document.nodes.find(item => item.id === nodeId);
  if (!node) throw new Error(`节点不存在：${nodeId}`);
  const handles = ((node.data as Record<string, unknown> | undefined)?.handles ?? []) as { id: string; type: string; dataType?: string | string[] }[];
  const handle = handles.find(item => item.id === handleId);
  if (!handle || handle.type !== kind) throw new Error(`节点 ${nodeId} 不存在${kind === "source" ? "输出" : "输入"}端口：${handleId ?? "(空)"}`);
  return handle;
}

function dataTypeMatches(source: { dataType?: string | string[] }, target: { dataType?: string | string[] }) {
  const left = Array.isArray(source.dataType) ? source.dataType : source.dataType ? [source.dataType] : [];
  const right = Array.isArray(target.dataType) ? target.dataType : target.dataType ? [target.dataType] : [];
  return left.some(item => right.includes(item));
}

function validateConnection(document: CanvasDocument, source: string, sourceHandle: string | undefined, target: string, targetHandle: string | undefined) {
  if (source === target) throw new Error("不允许节点连接自身");
  const sourcePort = handleOf(document, source, sourceHandle, "source");
  const targetPort = handleOf(document, target, targetHandle, "target");
  if (!dataTypeMatches(sourcePort, targetPort)) throw new Error(`端口数据类型不匹配：${sourceHandle} → ${targetHandle}`);
  const duplicated = document.edges.some(edge => edge.source === source && edge.target === target && edge.sourceHandle === sourceHandle && edge.targetHandle === targetHandle);
  if (duplicated) throw new Error("连线已存在");
}

function nodeInfo(node: CanvasNode) {
  const meta = findNodeTypeMeta(String(node.type ?? ""));
  return {
    node: { id: node.id, type: node.type, position: node.position, data: node.data },
    label: (node.data as Record<string, unknown> | undefined)?.label,
    nodeTools: meta ? meta.tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) : [],
  };
}

function arrangeDocument(document: CanvasDocument) {
  // ACT: headless 无 DOM 实测尺寸，按拓扑分层 + 固定尺寸估算排布；页面打开后可手动整理覆盖。
  const incoming = new Map<string, number>();
  for (const node of document.nodes) incoming.set(node.id, 0);
  for (const edge of document.edges as EdgeLike[]) incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  const depth = new Map<string, number>();
  const pending = document.nodes.map(node => node.id);
  let depthIndex = 0;
  while (pending.length) {
    const current = pending.filter(id => (incoming.get(id) ?? 0) === 0);
    const batch = current.length ? current : [pending[0]!];
    for (const id of batch) {
      depth.set(id, depthIndex);
      pending.splice(pending.indexOf(id), 1);
      for (const edge of document.edges as EdgeLike[]) if (edge.source === id) incoming.set(edge.target, (incoming.get(edge.target) ?? 1) - 1);
    }
    depthIndex++;
  }
  const columns = new Map<number, CanvasNode[]>();
  for (const node of document.nodes) {
    const column = depth.get(node.id) ?? 0;
    columns.set(column, [...(columns.get(column) ?? []), node]);
  }
  const arrangedNodeIds: string[] = [];
  for (const [column, nodes] of [...columns.entries()].sort((left, right) => left[0] - right[0])) {
    nodes.forEach((node, index) => {
      node.position = {
        x: column * (nodeSizeEstimate.width + columnGap),
        y: index * (nodeSizeEstimate.height + rowGap),
      };
      arrangedNodeIds.push(node.id);
    });
  }
  document.viewport = { x: 40, y: 40, zoom: 0.85 };
  return arrangedNodeIds;
}

/** 页面动作通道：fitCanvas 等纯 UI 操作经此转发已打开的页面执行；无页面时为 undefined。 */
export type PageCall = (request: { name: string; args: Record<string, unknown> }, signal: AbortSignal) => Promise<unknown>;

/** 单个结构操作的统一入口：解析 args → 文档读改写 → 返回与页面版一致的结果。 */
export async function applyCanvasOperation(directory: string, canvasId: string | undefined, request: { name: string; args: Record<string, unknown> }, signal: AbortSignal, pageCall?: PageCall): Promise<unknown> {
  // addCanvas 不要求已有画布（空工作区创建首块画布）；其余操作需要激活画布。
  if (request.name === "addCanvas") {
    const { name } = canvasSchemas.addCanvas.parse(request.args);
    return addCanvas(directory, name);
  }
  // 空工作区直接导入时自动创建首块画布（对齐 openProject 自动建目录的体验）。
  let activeId: string;
  if (request.name === "importStoryboard") {
    const canvases = await listCanvasFiles(directory);
    if (!canvases.length) activeId = (await createCanvasDocument(directory)).canvasId;
    else activeId = canvasId ? await resolveActiveCanvasId(directory, canvasId) : canvases[0]!.id;
  } else {
    activeId = await resolveActiveCanvasId(directory, canvasId);
  }
  switch (request.name) {
    case "getCanvas": {
      canvasSchemas.getCanvas.parse(request.args);
      const state = await getCanvasState(directory, activeId);
      return { ...state, nodes: state.nodes.map(node => ({ ...node })), edges: state.edges.map(edge => ({ ...edge })) };
    }
    case "switchCanvas": {
      const { canvasId: targetId } = canvasSchemas.switchCanvas.parse(request.args);
      await resolveActiveCanvasId(directory, targetId);
      return getCanvasState(directory, targetId);
    }
    case "renameCanvas": {
      const { canvasId: targetId, name } = canvasSchemas.renameCanvas.parse(request.args);
      const renamedId = await renameCanvas(directory, targetId ?? activeId, name);
      return getCanvasState(directory, renamedId);
    }
    case "addNode": {
      const args = canvasSchemas.addNode.parse(request.args);
      return mutateResult(directory, activeId, document => {
        const type = args.type.startsWith("remote-") ? args.type : `remote-${args.type}`;
        const meta = findNodeTypeMeta(type);
        if (!meta) throw new Error("节点类型未启用或尚未加载，请先查询 getCanvas");
        const node: CanvasNode = {
          id: crypto.randomUUID(), type, position: { x: args.position.x, y: args.position.y },
          data: defaultNodeData(type, meta.label, args.label),
        };
        document.nodes.push(node);
        return nodeInfo(node);
      });
    }
    case "deleteNodes": {
      const { nodeIds } = canvasSchemas.deleteNodes.parse(request.args);
      return mutateResult(directory, activeId, document => {
        const idSet = new Set(nodeIds);
        for (const id of nodeIds) {
          if (!document.nodes.some(node => node.id === id)) throw new Error(`节点不存在：${id}`);
          if (document.nodes.some(node => (node as { parentNode?: string }).parentNode === id && !idSet.has(id))) throw new Error(`请先删除此节点的子节点：${id}`);
        }
        const removedEdgeIds = (document.edges as EdgeLike[]).filter(edge => idSet.has(edge.source) || idSet.has(edge.target)).map(edge => edge.id!);
        document.nodes = document.nodes.filter(node => !idSet.has(node.id));
        document.edges = (document.edges as EdgeLike[]).filter(edge => !idSet.has(edge.source) && !idSet.has(edge.target));
        return { nodeIds, removedEdgeIds };
      });
    }
    case "moveNodes": {
      const { moves } = canvasSchemas.moveNodes.parse(request.args);
      return mutateResult(directory, activeId, document => {
        for (const move of moves) {
          const node = document.nodes.find(item => item.id === move.nodeId);
          if (!node) throw new Error(`节点不存在：${move.nodeId}`);
          node.position = { x: move.position.x, y: move.position.y };
        }
        return { movedNodeIds: moves.map(move => move.nodeId) };
      });
    }
    case "renameNodes": {
      const { renames } = canvasSchemas.renameNodes.parse(request.args);
      return mutateResult(directory, activeId, document => {
        for (const rename of renames) {
          const node = document.nodes.find(item => item.id === rename.nodeId);
          if (!node) throw new Error(`节点不存在：${rename.nodeId}`);
          ((node.data ??= {}) as Record<string, unknown>).label = rename.label;
        }
        return { renamedNodeIds: renames.map(rename => rename.nodeId) };
      });
    }
    case "connectNodes": {
      const { connections } = canvasSchemas.connectNodes.parse(request.args);
      return mutateResult(directory, activeId, document => {
        const edges = connections.map(connection => {
          validateConnection(document, connection.source, connection.sourceHandle, connection.target, connection.targetHandle);
          return { id: crypto.randomUUID(), source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle };
        });
        document.edges.push(...edges);
        return { edges: edges.map(edge => ({ id: edge.id })) };
      });
    }
    case "deleteEdges": {
      const { edgeIds } = canvasSchemas.deleteEdges.parse(request.args);
      return mutateResult(directory, activeId, document => {
        for (const id of edgeIds) if (!document.edges.some(edge => (edge as EdgeLike).id === id)) throw new Error(`连线不存在：${id}`);
        document.edges = document.edges.filter(edge => !edgeIds.includes((edge as EdgeLike).id!));
        return { edgeIds };
      });
    }
    case "arrangeCanvas": {
      canvasSchemas.arrangeCanvas.parse(request.args);
      return mutateResult(directory, activeId, document => {
        const arrangedNodeIds = arrangeDocument(document);
        return { arrangedNodeIds, viewport: document.viewport };
      });
    }
    case "fitCanvas": {
      const args = canvasSchemas.fitCanvas.parse(request.args);
      // 视口适配是页面动作：有已打开页面时转发执行（截图排查用），无页面时明确引导。
      if (!pageCall) throw Object.assign(new Error("fitCanvas 需要已打开的 Toonflow 页面（视口适配是页面动作）。请先用内嵌浏览器打开 getAppState 返回的 suggestedPageUrl，再重试本命令"), { status: 409 });
      return pageCall({ name: "fitCanvas", args: { ...(args.nodeIds ? { nodeIds: args.nodeIds } : {}) } }, signal);
    }
    case "selectNodes":
      return { selectedNodeIds: [], note: "headless 模式无选择状态" };
    case "nodeTools": {
      const args = canvasSchemas.nodeTools.parse(request.args);
      return dispatchNodeTool(directory, activeId, args.nodeId, args.name, args.args ?? {}, signal);
    }
    case "getGenerationStatuses": {
      const args = canvasSchemas.getGenerationStatuses.parse(request.args);
      const { document } = await readCanvasDocument(directory, activeId);
      const { nodeRuntimeStatus } = await import("@/utils/canvas/queue");
      const targets = args.nodeIds ? [...new Set(args.nodeIds)] : document.nodes.filter(node => String(node.type ?? "").includes("GenerationNode")).map(node => node.id);
      const nodes = targets.map(nodeId => {
        const node = document.nodes.find(item => item.id === nodeId);
        const data = (node?.data ?? {}) as Record<string, unknown>;
        const history = (data.generationHistory as Record<string, unknown>[] | undefined) ?? [];
        const last = history.at(-1);
        const label = String(data.label ?? nodeId);
        if (!node) return { nodeId, label, status: "unknown", error: `节点不存在：${nodeId}`, outputs: undefined };
        const runtime = nodeRuntimeStatus(directory, nodeId);
        if (runtime) return { nodeId, label, status: runtime.status, error: runtime.error, outputs: data.outputs, taskId: runtime.taskId };
        return { nodeId, label, status: last?.status === "running" ? "failed" : String(last?.status ?? "idle"), error: last?.error, outputs: data.outputs };
      });
      const summary = nodes.reduce<Record<string, number>>((counts, node) => {
        counts[String(node.status)] = (counts[String(node.status)] ?? 0) + 1;
        return counts;
      }, { total: nodes.length, succeeded: 0, failed: 0, running: 0, idle: 0, unknown: 0 });
      return { nodes, summary };
    }
    case "importStoryboard": {
      const args = canvasSchemas.importStoryboard.parse(request.args);
      const { autoGenerateImages, autoSubmit, imageModel, videoModel, duration, resolution } = args.options ?? {};
      const state = await getCanvasState(directory, activeId);
      const imageType = state.availableNodeTypes.find(item => item.type === "remote-imageNode")?.type;
      const imageGenType = state.availableNodeTypes.find(item => item.type === "remote-imageGenerationNode")?.type;
      const videoGenType = state.availableNodeTypes.find(item => item.type === "remote-videoGenerationNode")?.type;
      if (!videoGenType) throw new Error("未找到视频生成节点，请确认节点插件已安装并启用");
      const models = await u.mediaGeneration.listMediaModels();
      const videoChoice = videoModel ? models.find(item => item.providerId === videoModel.providerId && item.modelId === videoModel.modelId && item.type === "video") : undefined;
      if (videoModel && !videoChoice) throw new Error("videoModel 不是有效视频模型，请先用 listMediaProviders 查询");

      let importedAssets = 0;
      let importedScenes = 0;
      const assetGenNodeIds: string[] = [];
      // 整个建图在一个 mutate 内原子完成：任一步失败全部不落盘（优于页面版的半成品语义）。
      const mutation = await mutateCanvasDocument(directory, activeId, async document => {
        const assetNodeIds: { name: string; nodeId: string }[] = [];
        const addStoryboardNode = (type: string, label: string) => {
          const meta = findNodeTypeMeta(type)!;
          const node: CanvasNode = { id: crypto.randomUUID(), type, position: { x: 0, y: 0 }, data: defaultNodeData(type, meta.label, label) };
          document.nodes.push(node);
          return node;
        };
        for (const asset of args.assets) {
          if (asset.filePath && imageType) {
            const node = addStoryboardNode(imageType, asset.name);
            (node.data as Record<string, unknown>).outputs = { image: { dataType: "IMAGE", value: { url: asset.filePath, mimeType: guessMimeType(asset.filePath) } } };
            assetNodeIds.push({ name: asset.name, nodeId: node.id });
          } else if (imageGenType && (asset.imagePrompt || asset.filePath)) {
            const node = addStoryboardNode(imageGenType, asset.name);
            const target = node.data as Record<string, unknown>;
            const prompt = asset.imagePrompt || `参考图：${asset.filePath}`;
            target.prompt = prompt;
            target.promptModel = prompt.split("\n").map(text => [{ type: "Write", text }]);
            if (imageModel) target.model = JSON.stringify([imageModel.providerId, imageModel.modelId]);
            assetNodeIds.push({ name: asset.name, nodeId: node.id });
            if (asset.imagePrompt) assetGenNodeIds.push(node.id);
          }
          importedAssets++;
        }

        const sortedScenes = [...args.scenes].sort((left, right) => left.sortNum - right.sortNum);
        const sceneNodeIds: { sortNum: number; nodeId: string; cast: string[] }[] = [];
        let castCapacityChecked = false;
        const assetNames = new Set(assetNodeIds.map(asset => asset.name));
        for (const scene of sortedScenes) {
          const node = addStoryboardNode(videoGenType, `分镜${scene.sortNum}`);
          const target = node.data as Record<string, unknown>;
          target.prompt = scene.videoPrompt;
          target.promptModel = scene.videoPrompt.split("\n").map(text => [{ type: "Write", text }]);
          if (videoModel) {
            target.model = JSON.stringify([videoModel.providerId, videoModel.modelId]);
            const sceneDuration = scene.duration ?? duration;
            if (sceneDuration !== undefined) {
              const durations = [...new Set((videoChoice?.durationResolutionMap ?? []).flatMap(item => item.duration))];
              if (durations.length && !durations.includes(sceneDuration)) throw new Error(`当前模型不支持时长 ${sceneDuration}，可选：${durations.join("、")}`);
              target.duration = sceneDuration;
            }
            if (resolution !== undefined) target.resolution = resolution;
          }
          if (!castCapacityChecked) {
            castCapacityChecked = true;
            const maxImageReference = modelModes(videoChoice).reduce((max, mode) => {
              if (Array.isArray(mode)) {
                const count = Number(mode.find(item => typeof item === "string" && item.startsWith("imageReference:"))?.split(":")[1]);
                return Math.max(max, Number.isFinite(count) ? count : 0);
              }
              if (mode === "singleImage") return Math.max(max, 1);
              if (mode === "startEndRequired" || mode === "endFrameOptional" || mode === "startFrameOptional") return Math.max(max, 2);
              return max;
            }, 0);
            const conflicts = sortedScenes
              .map(item => ({ sortNum: item.sortNum, count: item.cast.filter(name => assetNames.has(name)).length }))
              .filter(item => item.count > maxImageReference);
            if (conflicts.length) {
              const guidance = videoModel
                ? "请减少 cast、换支持多参考的模型，或拆分分镜"
                : "导入 JSON 的 options.videoModel 未提供且节点无默认模型，无法校验参考容量——请在 options 提供 videoModel（CLI 用 canvas import --schema 看示例、models 查询可用模型），或先以空 cast 导入再用 node set 配模型、node cast 补连线";
              throw new Error(`视频模型 ${videoModel?.modelId ?? "(未提供)"} 最大支持 ${maxImageReference} 张图片参考，以下分镜超出：${conflicts.map(item => `分镜${item.sortNum}（${item.count} 个资产）`).join("、")}。${guidance}`);
            }
          }
          sceneNodeIds.push({ sortNum: scene.sortNum, nodeId: node.id, cast: scene.cast });
          importedScenes++;
        }

        const connections = sceneNodeIds.flatMap(({ nodeId, cast }) => cast
          .map(name => assetNodeIds.find(asset => asset.name === name)?.nodeId)
          .filter((source): source is string => !!source)
          .map(source => ({ source, target: nodeId, sourceHandle: "image", targetHandle: "in" })));
        const edges = connections.map(connection => {
          validateConnection(document, connection.source, connection.sourceHandle, connection.target, connection.targetHandle);
          return { id: crypto.randomUUID(), source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle };
        });
        document.edges.push(...edges);
        const arrangedNodeIds = arrangeDocument(document);
        return { assetNodeIds, sceneNodeIds: sceneNodeIds.map(({ sortNum, nodeId }) => ({ sortNum, nodeId })), edgeIds: edges.map(edge => edge.id), arrangedNodeIds };
      });
      // 生成触发放在结构落盘之后：入队（挂机语义），autoSubmit 连同分镜视频一起按 missing 提交。
      if (autoGenerateImages || autoSubmit) {
        const { submitCanvasQueue } = await import("@/utils/canvas/queue");
        if (autoGenerateImages) for (const nodeId of assetGenNodeIds) await dispatchNodeTool(directory, activeId, nodeId, "node:generateImage", {}, signal);
        if (autoSubmit) await submitCanvasQueue(directory, activeId, { type: "missing" });
      }
      return mutation.result;
    }
    default:
      throw new Error(`未知画布操作：${request.name}`);
  }
}

function mutateResult<T>(directory: string, canvasId: string, mutator: (document: CanvasDocument) => T): Promise<T> {
  let result!: T;
  return mutateCanvasDocument(directory, canvasId, document => { result = mutator(document); }).then(() => result);
}

function defaultNodeData(type: string, typeLabel: string, label?: string) {
  const data: Record<string, unknown> = { label: label ?? typeLabel, handles: defaultHandles(type) };
  if (type.endsWith("GenerationNode")) {
    data.prompt = "";
    data.promptModel = [];
    if (type.includes("image")) { data.size = "2K"; data.ratio = "16:9"; }
    else { data.resolution = ""; data.ratio = "16:9"; data.mode = ""; data.generateAudio = false; }
  }
  return data;
}

function defaultHandles(type: string) {
  if (type.endsWith("GenerationNode")) {
    if (type.includes("image")) return [{ id: "in", type: "target", dataType: ["IMAGE", "STRING"], label: "图片、文本输入" }, { id: "image", type: "source", dataType: "IMAGE", label: "图片输出" }];
    return [{ id: "in", type: "target", dataType: ["IMAGE", "VIDEO", "AUDIO", "STRING"], label: "图片、视频、音频、文本输入" }, { id: "video", type: "source", dataType: "VIDEO", label: "视频输出" }];
  }
  if (type.includes("image")) return [{ id: "in", type: "target", dataType: ["IMAGE", "STRING"], label: "图片、文本输入" }, { id: "image", type: "source", dataType: "IMAGE", label: "图片输出" }];
  if (type.includes("video")) return [{ id: "in", type: "target", dataType: ["VIDEO", "STRING"], label: "视频、文本输入" }, { id: "video", type: "source", dataType: "VIDEO", label: "视频输出" }];
  if (type.includes("audio")) return [{ id: "in", type: "target", dataType: ["AUDIO", "STRING"], label: "音频、文本输入" }, { id: "audio", type: "source", dataType: "AUDIO", label: "音频输出" }];
  return [{ id: "in", type: "target", dataType: ["STRING"], label: "文本输入" }, { id: "text", type: "source", dataType: "STRING", label: "文本输出" }];
}

function guessMimeType(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpeg", "jpg", "webp", "gif", "avif", "bmp"].includes(extension)) return `image/${extension === "jpg" ? "jpeg" : extension}`;
  return "image/png";
}
