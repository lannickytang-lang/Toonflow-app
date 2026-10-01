import { inject, nextTick, type Ref } from "vue";
import { useVueFlow, type XYPosition } from "@vue-flow/core";
import { useNodeEvent, useNodeToolsContext, validateConnection } from "@toonflow/nodes-scaffold/runtime";
import { canvasSchemas, type CanvasContext, type CanvasToolCall } from "@toonflow/tool-canvas/runtime";
import { arrangeCanvas } from "./arrangeCanvas";

type StoryboardImportArgs = {
  assets: { name: string; imagePrompt?: string; filePath?: string }[];
  scenes: ({ sortNum: number; videoPrompt: string; cast: string[]; duration?: number } & Record<string, unknown>)[];
  options?: {
    autoGenerateImages?: boolean;
    imageModel?: { providerId: string; modelId: string };
    videoModel?: { providerId: string; modelId: string };
    duration?: number;
    resolution?: string;
  };
};

type StoryboardImportResult = {
  assetNodeIds: { name: string; nodeId: string }[];
  sceneNodeIds: { sortNum: number; nodeId: string }[];
  edgeIds: string[];
  arrangedNodeIds?: string[];
  warnings?: string[];
};

function guessMimeType(filePath: string) {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "image/png";
}

export function useCanvasTools(options: {
  availableNodes: Ref<{ type: string; label: string }[]>;
  flushSave(): Promise<void>;
  menu(): {
    getCanvases(): { id: string; name: string }[];
    addCanvas(name?: string, signal?: AbortSignal): Promise<string>;
    switchCanvas(canvasId: string, signal?: AbortSignal): Promise<void>;
    renameCanvas(canvasId: string, name: string, signal?: AbortSignal): Promise<void>;
  };
  getCanvasBinding(): { id: string; signal: AbortSignal };
  resolveCanvasContext?(id: string): CanvasContext | undefined;
}) {
  const flow = useVueFlow();
  const getNodeTools = useNodeToolsContext();
  const batchCanvasHistory = inject<((action: () => Promise<void>) => Promise<void>) | undefined>("batchCanvasHistory", undefined);

  function findNode(nodeId: string) {
    const node = flow.findNode(nodeId);
    if (!node) throw new Error(`节点不存在：${nodeId}`);
    return node;
  }

  function nodeInfo(nodeId: string, snapshot = flow.toObject()) {
    findNode(nodeId);
    return {
      node: snapshot.nodes.find(node => node.id === nodeId),
      nodeTools: getNodeTools().tools.filter(tool => tool.nodeId === nodeId),
    };
  }

  function nodePosition(position: XYPosition) {
    if (!flow.snapToGrid.value) return position;
    const [x, y] = flow.snapGrid.value;
    return { x: Math.round(position.x / x) * x, y: Math.round(position.y / y) * y };
  }

  return (id: string, canvasSignal: AbortSignal, workspaceSignal: AbortSignal): CanvasContext => {
    let redirected: CanvasContext | undefined;
    return {
      get id() { return redirected?.id ?? options.getCanvasBinding().id; },
      get tools() { return redirected?.tools ?? getNodeTools().tools; },
      getNodeLabel(nodeId) {
        if (redirected) return redirected.getNodeLabel?.(nodeId);
        const node = flow.findNode(nodeId);
        const label = node?.data.label ?? node?.label;
        return typeof label === "string" && label.trim() ? label : undefined;
      },
      async call(request, signal) {
        if (redirected) return redirected.call(request, signal);
        canvasSignal.throwIfAborted();
        id = options.getCanvasBinding().id;
        const changesCanvas = request.name === "addCanvas" || request.name === "switchCanvas" || request.name === "renameCanvas";
        const callSignal = AbortSignal.any([workspaceSignal, ...(changesCanvas ? [] : [canvasSignal]), AbortSignal.timeout(120000), ...(signal ? [signal] : [])]);
        callSignal.throwIfAborted();
        let cancel = () => {};
        try {
          return await Promise.race([
            Promise.resolve().then(async () => {
              canvasSignal.throwIfAborted();
              let result = await execute(request, callSignal, id);
              callSignal.throwIfAborted();
              if (changesCanvas) {
                const nextContext = options.resolveCanvasContext?.(String(result));
                if (nextContext) {
                  redirected = nextContext;
                  return nextContext.call({ name: "getCanvas", args: {} }, callSignal);
                }
                const binding = options.getCanvasBinding();
                if (binding.id !== result) throw new Error("画布已再次切换，请重新发送消息");
                binding.signal.throwIfAborted();
                id = binding.id;
                canvasSignal = binding.signal;
                result = await execute({ name: "getCanvas", args: {} }, callSignal, id);
              }
              if (request.name !== "getCanvas" && request.name !== "selectNodes") {
                try {
                  await options.flushSave();
                } catch (error) {
                  // 操作已在内存画布生效、仅保存失败：明确告知部分成功，避免调用方盲目重试造成重复节点。
                  const detail = error instanceof Error ? error.message : String(error);
                  throw new Error(`画布操作 ${request.name} 已执行，但保存画布文件失败：${detail}。画布内存状态已变更，请先 getCanvas 核对现状再决定是否重试`);
                }
              }
              callSignal.throwIfAborted();
              canvasSignal.throwIfAborted();
              return result;
            }),
            new Promise<never>((_resolve, reject) => {
              cancel = () => reject(callSignal.reason);
              callSignal.addEventListener("abort", cancel, { once: true });
            }),
          ]);
        } finally {
          callSignal.removeEventListener("abort", cancel);
        }
      },
      };
  };

  async function execute(request: CanvasToolCall, signal: AbortSignal, canvasId: string): Promise<unknown> {
    signal.throwIfAborted();
    switch (request.name) {
      case "getCanvas": {
        canvasSchemas.getCanvas.parse(request.args);
        return {
          id: canvasId,
          canvases: options.menu().getCanvases(),
          ...flow.toObject(),
          selectedNodeIds: flow.getSelectedNodes.value.map(node => node.id),
          availableNodeTypes: options.availableNodes.value,
          nodeTools: getNodeTools().tools,
        };
      }
      case "addCanvas": {
        const { name } = canvasSchemas.addCanvas.parse(request.args);
        return options.menu().addCanvas(name, signal);
      }
      case "switchCanvas": {
        const { canvasId: targetId } = canvasSchemas.switchCanvas.parse(request.args);
        await options.menu().switchCanvas(targetId, signal);
        return targetId;
      }
      case "renameCanvas": {
        const { canvasId: targetId = canvasId, name } = canvasSchemas.renameCanvas.parse(request.args);
        const renamedId = options.menu().getCanvases().find(canvas => canvas.id === targetId)?.name === name ? targetId : name + ".json";
        await options.menu().renameCanvas(targetId, name, signal);
        return targetId === canvasId ? renamedId : canvasId;
      }
      case "addNode": {
        const args = canvasSchemas.addNode.parse(request.args);
        const type = options.availableNodes.value.find(node => node.type === args.type);
        if (!type) throw new Error("节点类型未启用或尚未加载，请先查询 getCanvas");
        const id = crypto.randomUUID();
        flow.addNodes({ id, type: type.type, position: nodePosition(args.position), data: { label: args.label ?? type.label } });
        await nextTick();
        signal.throwIfAborted();
        return nodeInfo(id);
      }
      case "deleteNodes": {
        const { nodeIds } = canvasSchemas.deleteNodes.parse(request.args);
        const idSet = new Set(nodeIds);
        const nodes = nodeIds.map(findNode);
        nodes.forEach(node => {
          if (node.deletable === false) throw new Error(`节点不允许删除：${node.id}`);
          if (flow.getNodes.value.some(item => item.parentNode === node.id && !idSet.has(item.id))) {
            throw new Error(`请先删除此节点的子节点：${node.id}`);
          }
          if (flow.getConnectedEdges(node.id).some(edge => edge.deletable === false)) throw new Error(`节点存在不可删除的连接：${node.id}`);
        });
        for (const node of nodes) {
          await useNodeEvent(node.id, flow).emit("delete");
          signal.throwIfAborted();
          if (flow.findNode(node.id) !== node) throw new Error("节点已被替换，请重新查询画布");
        }
        const edgeIds = flow.getEdges.value.filter(edge => idSet.has(edge.source) || idSet.has(edge.target)).map(edge => edge.id);
        flow.removeNodes(nodeIds, true);
        await nextTick();
        return { nodeIds, removedEdgeIds: edgeIds };
      }
      case "moveNodes": {
        const { moves } = canvasSchemas.moveNodes.parse(request.args);
        moves.forEach(move => { if (findNode(move.nodeId).draggable === false) throw new Error(`节点不允许移动：${move.nodeId}`); });
        moves.forEach(move => flow.updateNode(move.nodeId, { position: nodePosition(move.position) }));
        await nextTick();
        const snapshot = flow.toObject();
        return { nodes: moves.map(move => nodeInfo(move.nodeId, snapshot)) };
      }
      case "renameNodes": {
        const { renames } = canvasSchemas.renameNodes.parse(request.args);
        renames.forEach(rename => findNode(rename.nodeId));
        renames.forEach(rename => flow.updateNodeData(rename.nodeId, { label: rename.label }));
        await nextTick();
        const snapshot = flow.toObject();
        return { nodes: renames.map(rename => nodeInfo(rename.nodeId, snapshot)) };
      }
      case "connectNodes": {
        const { connections } = canvasSchemas.connectNodes.parse(request.args);
        const edges = [...flow.getEdges.value];
        const entries = connections.map(connection => {
          const sourceNode = findNode(connection.source);
          const targetNode = findNode(connection.target);
          if (!flow.nodesConnectable.value || sourceNode.connectable === false || targetNode.connectable === false) {
            throw new Error(`节点不允许连接：${connection.source} -> ${connection.target}`);
          }
          const existing = edges.find(edge => edge.source === connection.source && edge.target === connection.target
            && edge.sourceHandle === connection.sourceHandle && edge.targetHandle === connection.targetHandle);
          if (existing) return { id: existing.id, connection, isNew: false };
          if (!validateConnection(connection, { sourceNode, targetNode, nodes: flow.getNodes.value, edges })) {
            throw new Error(`连接无效：${connection.source} -> ${connection.target}，请检查端口方向、数据类型以及目标节点的连接规则`);
          }
          const id = crypto.randomUUID();
          // ACT: 候选边只参与本批校验，全部通过后再一次提交画布。
          edges.push({
            ...connection, id, type: "default", selected: false, data: {}, events: {}, sourceNode, targetNode,
            sourceX: sourceNode.computedPosition.x, sourceY: sourceNode.computedPosition.y,
            targetX: targetNode.computedPosition.x, targetY: targetNode.computedPosition.y,
          });
          return { id, connection, isNew: true };
        });
        flow.addEdges(entries.filter(entry => entry.isNew).map(entry => ({ id: entry.id, ...entry.connection })));
        await nextTick();
        const toObject = flow.toObject();
        return { edges: entries.map(entry => toObject.edges.find(edge => edge.id === entry.id)) };
      }
      case "deleteEdges": {
        const { edgeIds } = canvasSchemas.deleteEdges.parse(request.args);
        edgeIds.forEach(edgeId => {
          const edge = flow.findEdge(edgeId);
          if (!edge) throw new Error(`连线不存在：${edgeId}`);
          if (edge.deletable === false) throw new Error(`连线不允许删除：${edgeId}`);
        });
        const snapshot = flow.toObject();
        const nodeIds = [...new Set(edgeIds.flatMap(id => {
          const edge = flow.findEdge(id)!;
          return [edge.source, edge.target];
        }))];
        flow.removeEdges(edgeIds);
        await nextTick();
        return { edgeIds, nodes: nodeIds.map(id => nodeInfo(id, snapshot)) };
      }
      case "selectNodes": {
        const { nodeIds } = canvasSchemas.selectNodes.parse(request.args);
        const nodes = nodeIds.map(findNode);
        if (nodes.some(node => node.selectable === false)) throw new Error("节点不允许选择");
        flow.removeSelectedElements();
        flow.addSelectedNodes(nodes);
        await nextTick();
        return { selectedNodeIds: flow.getSelectedNodes.value.map(node => node.id) };
      }
      case "arrangeCanvas": {
        canvasSchemas.arrangeCanvas.parse(request.args);
        const { arrangedNodeIds, viewport } = await arrangeCanvas(flow, signal);
        return { arrangedNodeIds, viewport };
      }
      case "fitCanvas": {
        const { nodeIds } = canvasSchemas.fitCanvas.parse(request.args);
        nodeIds?.forEach(findNode);
        await nextTick();
        signal.throwIfAborted();
        flow.updateNodeInternals(nodeIds ?? flow.getNodes.value.map(node => node.id));
        const fitted = await flow.fitView({ nodes: nodeIds, padding: 0.2, duration: 0 });
        signal.throwIfAborted();
        return { fitted, nodeIds: nodeIds ?? flow.getNodes.value.map(node => node.id), viewport: flow.toObject().viewport };
      }
      case "nodeTools": {
        const args = canvasSchemas.nodeTools.parse(request.args);
        return getNodeTools().call(args, signal);
      }
      case "getGenerationStatuses": {
        const args = canvasSchemas.getGenerationStatuses.parse(request.args);
        const nodeTools = getNodeTools();
        const statuses = nodeTools.tools.filter(tool => tool.name === "node:getGenerationStatus");
        const targets = args.nodeIds ? [...new Set(args.nodeIds)] : [...new Set(statuses.map(tool => tool.nodeId))];
        const nodes = await Promise.all(targets.map(async nodeId => {
          const label = statuses.find(tool => tool.nodeId === nodeId)?.nodeLabel;
          try {
            const status = await nodeTools.call({ nodeId, name: "node:getGenerationStatus", args: {} }, signal) as Record<string, unknown>;
            return { nodeId, label, status: status.status, error: status.error, outputs: status.outputs };
          } catch (error) {
            return { nodeId, label, status: "unknown", error: error instanceof Error ? error.message : String(error), outputs: undefined };
          }
        }));
        // 汇总计数让轮询一眼可判：succeeded+failed 等于目标数即结束；idle 为未触发，不计入等待。
        const summary = nodes.reduce<Record<string, number>>((counts, node) => {
          counts[String(node.status)] = (counts[String(node.status)] ?? 0) + 1;
          return counts;
        }, { total: nodes.length, succeeded: 0, failed: 0, running: 0, idle: 0, unknown: 0 });
        return { nodes, summary };
      }
      case "importStoryboard": {
        const args = canvasSchemas.importStoryboard.parse(request.args);
        let result: StoryboardImportResult | undefined;
        const run = async () => { result = await runStoryboardImport(args, signal, canvasId); };
        if (batchCanvasHistory) await batchCanvasHistory(run);
        else await run();
        return result;
      }
      default: throw new Error(`未知画布操作：${request.name}`);
    }
  }

  async function runStoryboardImport(args: StoryboardImportArgs, signal: AbortSignal, canvasId: string): Promise<StoryboardImportResult> {
    const snapshot = await execute({ name: "getCanvas", args: {} }, signal, canvasId) as { availableNodeTypes: { type: string; label: string }[] };
    const findType = (...names: string[]) => snapshot.availableNodeTypes.find(item => names.some(name => item.type === `remote-${name}` || item.type === name))?.type;
    const imageType = findType("imageNode");
    const imageGenType = findType("imageGenerationNode");
    const videoGenType = findType("videoGenerationNode");
    if (!videoGenType) throw new Error("未找到视频生成节点，请确认节点插件已安装并启用");
    const addStoryboardNode = async (type: string, label: string) =>
      await execute({ name: "addNode", args: { type, position: { x: 0, y: 0 }, label } }, signal, canvasId) as { node: { id: string } };
    const callNodeTool = async (nodeId: string, name: string, nodeArgs: Record<string, unknown>) =>
      await execute({ name: "nodeTools", args: { nodeId, name, args: nodeArgs } }, signal, canvasId);

    const { videoModel, duration, resolution, imageModel } = args.options ?? {};
    const assetNodeIds: { name: string; nodeId: string }[] = [];
    const assetGenNodeIds: string[] = [];
    let importedAssets = 0;
    let importedScenes = 0;
    try {
      for (const asset of args.assets) {
        signal.throwIfAborted();
        if (asset.filePath && imageType) {
          const info = await addStoryboardNode(imageType, asset.name);
          await callNodeTool(info.node.id, "node:setImage", { path: asset.filePath, mimeType: guessMimeType(asset.filePath) });
          assetNodeIds.push({ name: asset.name, nodeId: info.node.id });
        } else if (imageGenType && (asset.imagePrompt || asset.filePath)) {
          const info = await addStoryboardNode(imageGenType, asset.name);
          await callNodeTool(info.node.id, "node:setPrompt", { prompt: asset.imagePrompt || `参考图：${asset.filePath}` });
          if (imageModel) await callNodeTool(info.node.id, "node:setConfig", { providerId: imageModel.providerId, modelId: imageModel.modelId });
          assetNodeIds.push({ name: asset.name, nodeId: info.node.id });
          if (asset.imagePrompt) assetGenNodeIds.push(info.node.id);
        }
        importedAssets++;
      }

      const sortedScenes = [...args.scenes].sort((left, right) => left.sortNum - right.sortNum);
      const sceneNodeIds: { sortNum: number; nodeId: string; cast: string[] }[] = [];
      let castCapacityChecked = false;
      for (const scene of sortedScenes) {
        signal.throwIfAborted();
        const info = await addStoryboardNode(videoGenType, `分镜${scene.sortNum}`);
        await callNodeTool(info.node.id, "node:setPrompt", { prompt: scene.videoPrompt });
        // 非标准字段归集：videoPromptZh → promptZh，其余进 tags；cast 序持久化供参考顺序对照。
        const sceneData = flow.findNode(info.node.id)?.data as Record<string, unknown> | undefined;
        if (sceneData) {
          if (typeof scene.videoPromptZh === "string" && scene.videoPromptZh) sceneData.promptZh = scene.videoPromptZh;
          const standardSceneFields = new Set(["sortNum", "videoPrompt", "cast", "duration", "videoPromptZh"]);
          const tags = Object.fromEntries(Object.entries(scene).filter(([key, value]) => !standardSceneFields.has(key) && value !== undefined));
          if (Object.keys(tags).length) sceneData.tags = tags;
          sceneData.cast = scene.cast;
        }
        // 分镜级 duration 优先，缺省回落 options.duration；两者皆无则不传，沿用节点当前配置。
        const sceneDuration = scene.duration ?? duration;
        if (videoModel) {
          await callNodeTool(info.node.id, "node:setConfig", {
            providerId: videoModel.providerId, modelId: videoModel.modelId,
            ...(sceneDuration !== undefined ? { duration: sceneDuration } : {}), ...(resolution !== undefined ? { resolution } : {}),
          });
        }
        // 首个视频节点配置完成后做一次 cast 容量校验，在建边前拦下多参考超限，避免导入成功却集体无法生成。
        if (!castCapacityChecked) {
          castCapacityChecked = true;
          await checkCastCapacity(info.node.id, sortedScenes, new Set(assetNodeIds.map(asset => asset.name)));
        }
        sceneNodeIds.push({ sortNum: scene.sortNum, nodeId: info.node.id, cast: scene.cast });
        importedScenes++;
      }

      // cast 中匹配不到资产的名字只跳过连线不报错中断，但必须显式返回让调用方知情。
      const knownAssets = new Set(assetNodeIds.map(asset => asset.name));
      const unmatchedCasts = [...new Set(sceneNodeIds.flatMap(({ cast }) => cast.filter(name => !knownAssets.has(name))))];
      const connections = sceneNodeIds.flatMap(({ nodeId, cast }) => cast
        .map(name => assetNodeIds.find(asset => asset.name === name)?.nodeId)
        .filter((source): source is string => !!source)
        .map(source => ({ source, target: nodeId, sourceHandle: "image", targetHandle: "in" })));
      let edgeIds: string[] = [];
      if (connections.length) {
        const connected = await execute({ name: "connectNodes", args: { connections } }, signal, canvasId) as { edges: { id: string }[] };
        edgeIds = connected.edges.map(edge => edge.id);
      }

      const arranged = await execute({ name: "arrangeCanvas", args: {} }, signal, canvasId) as { arrangedNodeIds?: string[] };
      await execute({ name: "fitCanvas", args: {} }, signal, canvasId);
      // 生成触发放在建图全部完成之后：配置类失败不再留下半成品导入，仅生成阶段本身失败。
      if (args.options?.autoGenerateImages === true) {
        for (const nodeId of assetGenNodeIds) {
          signal.throwIfAborted();
          await callNodeTool(nodeId, "node:generateImage", {});
        }
      }
      return {
        assetNodeIds,
        sceneNodeIds: sceneNodeIds.map(({ sortNum, nodeId }) => ({ sortNum, nodeId })),
        edgeIds,
        arrangedNodeIds: arranged.arrangedNodeIds,
        warnings: unmatchedCasts.map(name => `cast 资产「${name}」不存在，相关连线已跳过`),
      };
    } catch (error) {
      // 中断时报告已建进度与清理方式，避免调用方盲目重试造成重复节点。
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`导入中断（已建 ${importedAssets}/${args.assets.length} 个资产节点、${importedScenes}/${args.scenes.length} 个分镜节点，画布内存已变更）：${detail}。可先 getCanvas 核对，重复导入前建议 deleteNodes 清理本次已建节点`);
    }

    // 从视频节点 getConfig 的模型能力推导最大图片参考数；cast 只统计实际存在的资产。
    async function checkCastCapacity(nodeId: string, scenes: StoryboardImportArgs["scenes"], assetNames: Set<string>) {
      signal.throwIfAborted();
      const config = await callNodeTool(nodeId, "node:getConfig", {}) as {
        config?: { providerId?: string; modelId?: string };
        models?: { providerId?: string; modelId?: string; mode?: unknown[] }[];
      };
      const current = config.models?.find(item => item.providerId === config.config?.providerId && item.modelId === config.config?.modelId);
      const modes = Array.isArray(current?.mode) ? current.mode : [];
      const maxImageReference = modes.reduce<number>((max, mode) => {
        if (Array.isArray(mode)) {
          const limit = mode.find(item => typeof item === "string" && item.startsWith("imageReference:")) as string | undefined;
          const count = Number(limit?.split(":")[1]);
          return Math.max(max, Number.isFinite(count) ? count : 0);
        }
        if (mode === "singleImage") return Math.max(max, 1);
        if (mode === "startEndRequired" || mode === "endFrameOptional" || mode === "startFrameOptional") return Math.max(max, 2);
        return max;
      }, 0);
      const conflicts = scenes
        .map(scene => ({ sortNum: scene.sortNum, count: scene.cast.filter(name => assetNames.has(name)).length }))
        .filter(scene => scene.count > maxImageReference);
      if (conflicts.length) {
        throw new Error(`视频模型 ${config.config?.modelId ?? "(默认)"} 最大支持 ${maxImageReference} 张图片参考，以下分镜超出：${conflicts.map(scene => `分镜${scene.sortNum}（${scene.count} 个资产）`).join("、")}。请减少 cast、换支持多参考的模型，或拆分分镜`);
      }
    }
  }
}
