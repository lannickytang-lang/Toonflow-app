"""canvas 组命令实现：list / get / import / report / fit。"""
import json
import sys
from pathlib import Path
from urllib.parse import quote

from .client import (CliError, canvasOperation, emit, exitCodes, getCanvasState, request, workspaceOf)

canvasFieldGuide = """画布 JSON 字段说明（nodes[].data 内）：
- label: 节点显示名（资产名 / 分镜N）
- prompt: 生成提示词；promptModel 为其按行拆分的内部结构，可忽略
- model: 模型选择，JSON 字符串 "[providerId, modelId]"，空=未配置
- size/ratio: 图片尺寸与比例；duration/resolution/mode/generateAudio: 视频时长/分辨率/参考模式/声音
- handles: 端口声明（in=输入，image/video/audio=输出），是连线合法性依据
- outputs: 当前产物引用 {image:{dataType:"IMAGE",value:{url:"assets/<nodeId>/xxx.png"}}}，url 为工作区相对路径
- generationHistory: 每次生成记录 {status(running/succeeded/failed), prompt, model, files, error?}，最多 50 条
顶层: toonflowCanvas=true 标记 / nodes / edges / viewport / revision（文档版本，乐观锁序号）
edges: {source, target, sourceHandle, targetHandle}——资产 image 端口连到分镜 in 端口即出镜关系"""

importSchemaExample = """{
  "assets": [
    { "name": "主角", "imagePrompt": "写实人像，9:16" }
  ],
  "scenes": [
    { "sortNum": 1, "videoPrompt": "主角走过街道", "cast": ["主角"], "duration": 3 }
  ],
  "options": {
    "imageModel": { "providerId": "mockProvider", "modelId": "mockImage" },
    "videoModel": { "providerId": "mockProvider", "modelId": "mockVideo" },
    "resolution": "480P"
  }
}

字段说明：
- assets: 出镜资产图清单，先于视频生成；name 是资产名（scenes.cast 按它引用），imagePrompt 是图片生成提示词
- scenes: 分镜清单，每个分镜生成一条视频；sortNum 序号、videoPrompt 视频提示词、cast 出镜资产名列表（须在 assets 里定义）、duration 时长秒（可省略，用 options.duration）
- options: imageModel/videoModel 必填（providerId/modelId 用 tdd models 查询）；resolution 可选（如 480P/720P）；duration 可选（全部分镜的默认时长）；autoSubmit 由 --auto-submit 参数控制无需写入"""

def validateStoryboard(payload):
    """前置结构校验：拦截最常见的结构错误并给中文指引；其余交给 server 校验并透传原文。"""
    if not isinstance(payload, dict):
        raise CliError("分镜 JSON 根节点需为对象", exitCodes.usage, "先 canvas import --schema 查看示例与字段说明")
    problems = []
    if not isinstance(payload.get("assets"), list):
        problems.append("assets 需为数组（出镜资产图清单，每项含 name 与 imagePrompt）")
    if not isinstance(payload.get("scenes"), list):
        problems.append("scenes 需为数组（分镜清单，每项含 videoPrompt，cast 为资产名数组）")
    if isinstance(payload.get("assets"), list):
        for index, asset in enumerate(payload["assets"]):
            if not isinstance(asset, dict) or not isinstance(asset.get("name"), str) or not isinstance(asset.get("imagePrompt"), str):
                problems.append(f"assets[{index}] 需含字符串字段 name 与 imagePrompt")
                break
    if isinstance(payload.get("scenes"), list):
        for index, scene in enumerate(payload["scenes"]):
            if not isinstance(scene, dict) or not isinstance(scene.get("videoPrompt"), str):
                problems.append(f"scenes[{index}] 需含字符串字段 videoPrompt")
                break
            if not isinstance(scene.get("cast", []), list):
                problems.append(f"scenes[{index}].cast 需为资产名数组（引用 assets 里的 name）")
                break
    options = payload.get("options")
    if options is not None:
        for key in ("imageModel", "videoModel"):
            model = options.get(key) if isinstance(options, dict) else None
            if model is not None and (not isinstance(model, dict) or "providerId" not in model or "modelId" not in model):
                problems.append(f"options.{key} 需为 {{providerId, modelId}}（用 tdd models 查询）")
                break
    if problems:
        raise CliError("分镜 JSON 结构不符合要求：" + "；".join(problems), exitCodes.usage,
                       "先 canvas import --schema 查看示例与字段说明")


def findNode(state, token):
    """节点查找：id 精确 → id 前缀 → label。"""
    for item in state.get("nodes", []):
        if item.get("id") == token or str(item.get("id", "")).startswith(token):
            return item
        if item.get("data", {}).get("label") == token:
            return item
    return None


def nodeType(node):
    return str(node.get("type") or "").replace("remote-", "")


def cmdCanvasList(obj):
    directory = workspaceOf(obj)
    canvases = request(f"/api/canvas/list?directory={quote(directory)}")
    emit(canvases, obj, lambda: "\n".join(
        f"{c.get('id')}\t节点 {c.get('nodeCount')}\t边 {c.get('edgeCount')}\trev {c.get('revision')}"
        for c in canvases) or "（无画布，canvas import 会自动创建）")


def cmdCanvasGet(obj, withNodes):
    state = getCanvasState(obj)
    if obj.get("json"):
        return emit(state, obj)
    typeCounts = {}
    statusCounts = {}
    for node in state.get("nodes", []):
        typeText = nodeType(node) or "?"
        typeCounts[typeText] = typeCounts.get(typeText, 0) + 1
        history = node.get("data", {}).get("generationHistory") or []
        status = str(history[-1].get("status")) if history and history[-1].get("status") else "idle"
        if "Generation" in typeText:
            statusCounts[status] = statusCounts.get(status, 0) + 1
    lines = [f"画布 {state.get('id')}（revision {state.get('revision')}）：{len(state.get('nodes', []))} 节点 / {len(state.get('edges', []))} 边"]
    lines.append("节点类型: " + ("  ".join(f"{k}×{v}" for k, v in typeCounts.items()) or "（空）"))
    if statusCounts:
        lines.append("生成状态: " + "  ".join(f"{k}×{v}" for k, v in statusCounts.items()))
    if withNodes:
        for node in state.get("nodes", [])[:50]:
            print(f"  {str(node.get('id'))[:8]}  {node.get('data', {}).get('label', '')}\t{nodeType(node)}")
        if len(state.get("nodes", [])) > 50:
            print(f"  … 共 {len(state['nodes'])} 个（--json 查看全部）")
    print("\n".join(lines))


def cmdCanvasCreate(obj, name):
    """新建空画布（server 能力 addCanvas 的 CLI 暴露）。"""
    directory = workspaceOf(obj)
    result = canvasOperation(obj, directory, "addCanvas", {"name": name} if name else {})
    canvasId = (result or {}).get("id") or name
    def human():
        return f"画布已创建: {canvasId}\n下一步: tdd canvas import <分镜.json> --canvas {canvasId}"
    emit(result, obj, human)


def cmdCanvasImport(obj, file, autoSubmit, newCanvas):
    if not file:
        raise CliError("用法: tdd canvas import <分镜.json> [--auto-submit] [--new-canvas [名称]] [--schema 查看示例]",
                       exitCodes.usage,
                       "先 --schema 看示例 JSON；模型 providerId/modelId 用 models 命令查询")
    try:
        payload = json.loads(Path(file).read_text(encoding="utf-8"))
    except ValueError as error:
        raise CliError(f"分镜 JSON 解析失败: {error}", exitCodes.usage) from error
    validateStoryboard(payload)
    directory = workspaceOf(obj)
    obj = dict(obj)
    if newCanvas is not None:
        # --new-canvas（自动编号）或 --new-canvas <名称>：先建画布再定向导入。
        created = canvasOperation(obj, directory, "addCanvas", {"name": newCanvas} if newCanvas else {})
        obj["canvas"] = (created or {}).get("id")
        targetNote = f"新建画布: {obj['canvas']}"
    else:
        canvases = request(f"/api/canvas/list?directory={quote(directory)}") or []
        wanted = obj.get("canvas")
        if wanted:
            normalized = wanted if wanted.endswith(".json") else f"{wanted}.json"
            if not any(canvas.get("id") == normalized for canvas in canvases):
                raise CliError(f"画布不存在: {normalized}", exitCodes.notFound,
                               "canvas list 查看；canvas create 新建；或 import 加 --new-canvas 建新画布导入")
        if canvases:
            state = getCanvasState(obj)
            existingNodes = state.get("nodes", [])
            targetNote = f"目标画布: {state.get('id')}（已有 {len(existingNodes)} 节点，本次追加）"
            existingLabels = {node.get("data", {}).get("label") for node in existingNodes}
            duplicated = [asset.get("name") for asset in payload.get("assets", [])
                          if isinstance(asset, dict) and asset.get("name") in existingLabels]
            if duplicated:
                targetNote += f"\n⚠ 与现有节点同名: {'、'.join(duplicated)}（如非有意追加，请改用 --new-canvas）"
        else:
            targetNote = "工作区暂无画布，导入将自动创建画布1"
    options = dict(payload.get("options") or {})
    if autoSubmit:
        options["autoSubmit"] = True
    args = {**payload, "options": options}
    result = canvasOperation(obj, directory, "importStoryboard", args)
    summary = result or {}
    def human():
        counts = (f"导入成功: 资产 {len(summary.get('assetNodeIds') or [])} / "
                  f"分镜 {len(summary.get('sceneNodeIds') or [])} / 连线 {len(summary.get('edgeIds') or [])}")
        if autoSubmit:
            counts += "（已提交队列，用 queue status --watch 盯进度）"
        return f"{targetNote}\n{counts}\n画布: {obj.get('canvas') or '（默认第一块）'}"
    emit(result, obj, human)


def cmdCanvasReport(obj, canvasId):
    directory = workspaceOf(obj)
    params = f"directory={quote(directory)}"
    if canvasId:
        params += f"&canvasId={quote(canvasId)}"
    report = request(f"/api/canvas/report?{params}")
    if obj.get("json"):
        return emit(report, obj)
    summary = report.get("summary", {})
    print(f"画布 {summary.get('canvasId')}（revision {summary.get('revision')}）｜生成节点 {summary.get('generationNodes')}："
          f"成功 {summary.get('succeeded')}、失败/跳过 {summary.get('failed')}、排队/运行 {summary.get('queued')}、"
          f"未触发 {summary.get('idle')}｜异常 {summary.get('issues')}、警告 {summary.get('warnings')}")
    issues = report.get("issues", [])
    if issues:
        print("\n[异常清单]")
        for issue in issues[:30]:
            print(f"  {'✗' if issue.get('level') == 'error' else '⚠'} {issue.get('label')}｜{issue.get('kind')}：{str(issue.get('detail'))[:90]}")
            print(f"    → {issue.get('suggestion')}")
        if len(issues) > 30:
            print(f"  … 共 {len(issues)} 项（--json 全量）")
    else:
        print("\n[异常清单] 无（全部健康）")
    print("\n[节点表] label｜类型｜模型｜状态｜产物")
    nodes = report.get("nodes", [])
    for node in nodes[:40]:
        outputs = ",".join(part.split("/")[-1] for part in node.get("outputs", [])) or "—"
        upstream = f"｜←[{','.join(node.get('upstream', []))}]" if node.get("upstream") else ""
        print(f"  {node.get('label')}｜{node.get('type')}｜{node.get('model') or '(无模型)'}｜{node.get('status')}｜{outputs}{upstream}")
    if len(nodes) > 40:
        print(f"  … 共 {len(nodes)} 个（--json 全量）")
    if summary.get("issues", 0) > 0:
        sys.exit(exitCodes.hasFailures)


def cmdCanvasFit(obj, nodesArgument):
    directory = workspaceOf(obj)
    nodeIds = [token.strip() for token in nodesArgument.split(",") if token.strip()] if nodesArgument else None
    resolvedIds = nodeIds
    if nodeIds:
        state = getCanvasState(obj)
        resolvedIds = [findNode(state, token) for token in nodeIds]
        resolvedIds = [node["id"] if node else None for node in resolvedIds]
        if any(nodeId is None for nodeId in resolvedIds):
            missing = nodeIds[[i for i, nodeId in enumerate(resolvedIds) if nodeId is None][0]]
            raise CliError(f"节点不存在: {missing}", exitCodes.notFound, "先 canvas get --nodes 查看节点列表")
    result = canvasOperation(obj, directory, "fitCanvas", {"nodeIds": resolvedIds} if resolvedIds else {})
    fitted = result or {}
    zoom = (fitted.get("viewport") or {}).get("zoom")
    emit(result, obj, lambda: (
        f"视口已适配{'到指定 %d 个节点' % len(resolvedIds) if resolvedIds else '到全部节点'}"
        + (f"（zoom {zoom:.2f}）" if zoom is not None else "")
        + "——现在可在浏览器截图；节点多看不清时用 --nodes 分组聚焦逐区截图"))
