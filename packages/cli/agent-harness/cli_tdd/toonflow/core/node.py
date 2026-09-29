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
    if configArgs:
        canvasOperation(obj, directory, "nodeTools",
                        {"nodeId": node["id"], "name": "node:setConfig", "args": configArgs})
    updated = {**configArgs, **({"prompt": prompt} if prompt is not None else {})}
    emit({"nodeId": node["id"], "updated": updated}, obj,
         lambda: f"已更新 {node.get('data', {}).get('label') or node['id']}")


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
