"""node 组命令实现：list / get / set / cast。"""
import json

from .client import CliError, canvasOperation, emit, exitCodes, workspaceOf
from .canvas import findNode, getCanvasState, nodeType


def lastStatus(node):
    history = node.get("data", {}).get("generationHistory") or []
    return str(history[-1].get("status")) if history and history[-1].get("status") else "idle"


def cmdNodeList(obj, typeFilter, statusFilter):
    state = getCanvasState(obj)
    rows = []
    for node in state.get("nodes", []):
        typeText = nodeType(node)
        if typeFilter and typeFilter not in typeText:
            continue
        if statusFilter and not ("Generation" in typeText and lastStatus(node) == statusFilter):
            continue
        rows.append({"nodeId": node.get("id"), "label": node.get("data", {}).get("label", ""),
                     "type": typeText, "status": lastStatus(node)})
    def human():
        shown = rows[:50]
        text = "\n".join(f"{str(row['nodeId'])[:8]}  {row['label']}\t{row['type']}\t{row['status']}" for row in shown)
        if len(rows) > 50:
            text += f"\n… 共 {len(rows)} 个（--json 全量）"
        return text
    emit(rows, obj, human)


def requireNode(obj, token):
    state = getCanvasState(obj)
    node = findNode(state, token)
    if not node:
        raise CliError(f"节点不存在: {token}", exitCodes.notFound, "先 canvas get --nodes 查看最新节点列表")
    return state, node


def cmdNodeGet(obj, nodeId):
    _, node = requireNode(obj, nodeId)
    def human():
        label = node.get("data", {}).get("label") or node.get("id")
        detail = json.dumps(node.get("data"), ensure_ascii=False, indent=2)
        return f"{label} ({nodeType(node)})\n{detail[:2000]}"
    emit(node, obj, human)


def cmdNodeSet(obj, nodeId, prompt, model, duration, resolution, ratio, size):
    state, node = requireNode(obj, nodeId)
    directory = workspaceOf(obj)
    if prompt is not None:
        canvasOperation(obj, directory, "nodeTools",
                        {"nodeId": node["id"], "name": "node:setPrompt", "args": {"prompt": prompt}})
    configArgs = {}
    if model is not None:
        parts = model.split("/")
        if len(parts) != 2 or not all(parts):
            raise CliError("--model 格式: providerId/modelId（如 mockProvider/mockVideo）", exitCodes.usage)
        configArgs["providerId"], configArgs["modelId"] = parts
    isVideo = "video" in nodeType(node)
    for key, value in (("duration", duration), ("resolution", resolution), ("ratio", ratio), ("size", size)):
        if value is None:
            continue
        if not isVideo and key in ("duration", "resolution"):
            raise CliError(f"--{key} 仅适用于视频生成节点", exitCodes.usage,
                           "图片生成节点可用: --model / --ratio / --size")
        configArgs[key] = value
    configResult = None
    if configArgs:
        configResult = canvasOperation(obj, directory, "nodeTools",
                                       {"nodeId": node["id"], "name": "node:setConfig", "args": configArgs})
    updated = {**configArgs, **({"prompt": prompt} if prompt is not None else {})}
    def human():
        label = node.get("data", {}).get("label") or node["id"]
        text = f"已更新 {label}"
        if configResult:
            # 回显 server 落盘后的最终生效值（size/ratio/model），多参数一次设置时不靠猜。
            final = dict(configResult)
            modelText = f"{final.pop('providerId')}/{final.pop('modelId')}" if "providerId" in final else None
            parts = ([f"model={modelText}"] if modelText else []) + \
                    [f"{key}={final[key]}" for key in ("duration", "resolution", "ratio", "size") if key in final]
            if parts:
                text += f"（{', '.join(parts)}）"
            if not isVideo and "size" in configArgs and "ratio" in configArgs:
                text += ("\n⚠ --size 与 --ratio 同时设置：size 是分辨率档位，部分模型只在特定档位遵守 ratio"
                         "（如 2K/4K 出图忽略比例），生成后用 canvas report 核对实际参数")
        return text
    emit({"nodeId": node["id"], "updated": updated, **({"effective": configResult} if configResult else {})}, obj, human)


def cmdNodeCast(obj, nodeId, assetsArgument):
    if not nodeId or not assetsArgument:
        raise CliError("用法: tdd node cast <分镜nodeId> --assets <资产id1,id2,...>（整组替换出镜连线）", exitCodes.usage)
    state, scene = requireNode(obj, nodeId)
    wanted = [token.strip() for token in assetsArgument.split(",") if token.strip()]
    resolved = []
    for token in wanted:
        asset = findNode(state, token)
        if not asset:
            raise CliError(f"资产不存在: {token}", exitCodes.notFound, "先 canvas get --nodes 查看资产列表")
        resolved.append(asset["id"])
    directory = workspaceOf(obj)
    oldEdges = [edge["id"] for edge in state.get("edges", []) if edge.get("target") == scene["id"]]
    if oldEdges:
        canvasOperation(obj, directory, "deleteEdges", {"edgeIds": oldEdges})
    if resolved:
        canvasOperation(obj, directory, "connectNodes", {"connections": [
            {"source": source, "target": scene["id"], "sourceHandle": "image", "targetHandle": "in"}
            for source in resolved]})
    emit({"nodeId": scene["id"], "assets": resolved}, obj,
         lambda: f"{scene.get('data', {}).get('label') or scene['id']} 出镜连线已替换为 {len(resolved)} 个资产")


def nodeLabelOf(state, nodeId):
    for node in state.get("nodes", []):
        if node.get("id") == nodeId:
            return node.get("data", {}).get("label") or nodeId
    return nodeId


def cmdNodeConnect(obj, nodeId, targetId, sourceHandle, targetHandle):
    """在两个节点间连一条线（默认 image→in，即资产出镜到分镜）。"""
    if not nodeId or not targetId:
        raise CliError("用法: tdd node connect <源节点> <目标节点> [--source-handle] [--target-handle]", exitCodes.usage)
    state, source = requireNode(obj, nodeId)
    target = findNode(state, targetId)
    if not target:
        raise CliError(f"节点不存在: {targetId}", exitCodes.notFound, "先 canvas get --nodes 查看节点列表")
    directory = workspaceOf(obj)
    result = canvasOperation(obj, directory, "connectNodes", {"connections": [
        {"source": source["id"], "target": target["id"],
         "sourceHandle": sourceHandle or "image", "targetHandle": targetHandle or "in"}]})
    edgeId = ((result or {}).get("edges") or [{}])[0].get("id")
    emit({"edgeId": edgeId, "source": source["id"], "target": target["id"]}, obj,
         lambda: f"已连线 {nodeLabelOf(state, source['id'])} → {nodeLabelOf(state, target['id'])}"
                 f"（{sourceHandle or 'image'} → {targetHandle or 'in'}）")


def cmdNodeDisconnect(obj, edgeId):
    """断开一条连线（EDGE_ID 支持 id 前缀；canvas get --json 查 edges[].id）。"""
    if not edgeId:
        raise CliError("用法: tdd node disconnect <边id>（tdd --json canvas get 的 edges[].id，支持前缀）", exitCodes.usage)
    state = getCanvasState(obj)
    matches = [edge for edge in state.get("edges", [])
               if edge.get("id") == edgeId or str(edge.get("id", "")).startswith(edgeId)]
    if not matches:
        raise CliError(f"连线不存在: {edgeId}", exitCodes.notFound, "用 tdd --json canvas get 查看 edges[].id")
    if len(matches) > 1:
        raise CliError(f"边 id 前缀匹配到 {len(matches)} 条连线，请用更长的前缀", exitCodes.usage)
    edge = matches[0]
    directory = workspaceOf(obj)
    canvasOperation(obj, directory, "deleteEdges", {"edgeIds": [edge["id"]]})
    emit({"edgeId": edge["id"]}, obj,
         lambda: f"已断开 {nodeLabelOf(state, edge.get('source'))} → {nodeLabelOf(state, edge.get('target'))}"
                 f"（{edge.get('sourceHandle')} → {edge.get('targetHandle')}）")
