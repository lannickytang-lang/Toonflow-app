"""queue 组命令实现：submit / status / logs / retry / cancel / export。"""
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

from .client import (CliError, canvasOperation, emit, exitCodes, getCanvasState, request, workspaceOf)
from .canvas import findNode


def canvasIdsOf(obj):
    """解析 --canvas：None（未指定）/ 单值（原样）/ 逗号分隔多值（逐个补 .json 后缀）。"""
    value = obj.get("canvas")
    if not value:
        return None
    return [token.strip() if token.strip().endswith(".json") else f"{token.strip()}.json"
            for token in value.split(",") if token.strip()]


def cmdQueueSubmit(obj, scope, nodesArgument, concurrency):
    directory = workspaceOf(obj)
    if scope not in ("missing", "all"):
        raise CliError("--scope 取值: missing（默认，断点重建用）| all", exitCodes.usage)
    nodeIds = [token.strip() for token in nodesArgument.split(",") if token.strip()] if nodesArgument else None
    canvasIds = canvasIdsOf(obj) or [None]
    merged = {"submitted": [], "skipped": []}
    for canvasId in canvasIds:
        body = {"directory": directory, "scope": "nodes" if nodeIds else scope}
        if nodeIds:
            body["nodeIds"] = nodeIds
        if canvasId:
            body["canvasId"] = canvasId
        if concurrency is not None:
            body["concurrency"] = concurrency
        result = request("/api/queue/submit", method="POST", body=body) or {}
        merged["submitted"].extend(result.get("submitted", []))
        merged["skipped"].extend(result.get("skipped", []))
    result = merged
    def human():
        lines = [f"已提交 {len(result.get('submitted', []))} 个任务（scope={'nodes' if nodeIds else scope}"
                 + (f"，画布 {len(canvasIds)} 块" if len(canvasIds) > 1 else "") + "）"]
        submitted = result.get("submitted", [])
        if submitted:
            names = "、".join(task.get("label", "") for task in submitted[:20])
            lines.append(f"  {names}{' …' if len(submitted) > 20 else ''}")
        skipped = result.get("skipped", [])
        if skipped:
            detail = "、".join(f"{item.get('label')}({item.get('reason')})" for item in skipped[:5])
            lines.append(f"跳过 {len(skipped)} 个: {detail}{' …' if len(skipped) > 5 else ''}")
        lines.append("用 queue status --watch 盯进度")
        return "\n".join(lines)
    emit(result, obj, human)


def fetchQueueStatus(obj, directory):
    params = []
    if directory:
        params.append(f"directory={quote(directory)}")
    canvasIds = canvasIdsOf(obj)
    if canvasIds:
        params.append(f"canvasId={quote(','.join(canvasIds))}")
    return request(f"/api/queue/status?{'&'.join(params)}") or {}


def humanQueue(status):
    summary = status.get("summary", {})
    concurrency = status.get("concurrency", {})
    return (f"队列: 总 {summary.get('total', 0)} | 成功 {summary.get('succeeded', 0)} | 运行 {summary.get('running', 0)} | "
            f"排队 {summary.get('pending', 0) + summary.get('backoff', 0)} | 跳过 {summary.get('skipped', 0)} | "
            f"取消 {summary.get('cancelled', 0)} | 失败 {summary.get('failed', 0)} | "
            f"并发 {concurrency.get('current', 0)}/{concurrency.get('max', 0)}")


def queueSettled(status):
    summary = status.get("summary", {})
    total = summary.get("total", 0)
    finished = (summary.get("succeeded", 0) + summary.get("skipped", 0)
                + summary.get("cancelled", 0) + summary.get("failed", 0))
    return total > 0 and finished >= total


def cmdQueueStatus(obj, watch, interval):
    directory = workspaceOf(obj, required=False)
    status = fetchQueueStatus(obj, directory)
    if watch:
        while not queueSettled(status):
            if not obj.get("json"):
                print(humanQueue(status))
            time.sleep(interval)
            status = fetchQueueStatus(obj, directory)
        if obj.get("json"):
            return emit(status, obj)
        print(humanQueue(status))
        bad = [task for task in status.get("tasks", []) if task.get("status") in ("skipped", "failed")]
        for task in bad:
            print(f"  ✗ {task.get('label')}: {str(task.get('error') or '')[:80]}（queue logs {task.get('id')} 可看失败原因）")
        if bad:
            sys.exit(exitCodes.hasFailures)
        return
    def human():
        lines = [humanQueue(status)]
        for task in status.get("tasks", [])[:20]:
            attempt = f" 尝试{task['attempt']}" if task.get("attempt") else ""
            error = f" {str(task.get('error'))[:60]}" if task.get("error") else ""
            lines.append(f"  [{task.get('status')}] {task.get('label')}{attempt}{error}")
        return "\n".join(lines)
    emit(status, obj, human)


def cmdQueueLogs(obj, taskId, tail):
    if not taskId:
        raise CliError("用法: tdd queue logs <taskId>", exitCodes.usage)
    logs = request(f"/api/queue/logs?taskId={quote(taskId)}") or {}
    def human():
        lines = [f"任务 {taskId[:8]} [{logs.get('status')}]"]
        if logs.get("error"):
            lines.append(f"失败原因: {logs['error']}")
        for entry in (logs.get("logs") or [])[-tail:]:
            mark = "✗" if entry.get("level") == "error" else "·"
            clock = datetime.fromtimestamp(entry.get("at", 0) / 1000).strftime("%H:%M:%S")
            lines.append(f"  {clock} {mark} {entry.get('message')}")
        return "\n".join(lines)
    emit(logs, obj, human)


def cmdQueueRetry(obj, nodeIds, setFile):
    if not nodeIds:
        raise CliError("用法: tdd queue retry <nodeId...> [--set fix.json]", exitCodes.usage)
    directory = workspaceOf(obj)
    # 与 node get/set/cast 一致：支持完整 id / id 前缀 / label；解析失败明确报错，
    # 不允许静默提交 0 个任务（server 按 nodeId 找不到时不报错）。
    state = getCanvasState(obj)
    resolved = []
    for token in nodeIds:
        node = findNode(state, token)
        if not node:
            raise CliError(f"节点不存在: {token}", exitCodes.notFound,
                           "先 canvas get --nodes 查看最新节点列表（支持完整 id / id 前缀 / label）")
        resolved.append(node["id"])
    patch = None
    if setFile:
        try:
            patch = json.loads(Path(setFile).read_text(encoding="utf-8"))
        except ValueError as error:
            raise CliError(f"--set JSON 解析失败: {error}", exitCodes.usage) from error
    if patch:
        for nodeId in resolved:
            if patch.get("prompt") is not None:
                canvasOperation(obj, directory, "nodeTools",
                                {"nodeId": nodeId, "name": "node:setPrompt", "args": {"prompt": patch["prompt"]}})
            configArgs = {key: value for key, value in patch.items() if key != "prompt"}
            if configArgs:
                canvasOperation(obj, directory, "nodeTools",
                                {"nodeId": nodeId, "name": "node:setConfig", "args": configArgs})
    result = request("/api/queue/submit", method="POST",
                     body={"directory": directory, "scope": "nodes", "nodeIds": resolved}) or {}
    submitted = result.get("submitted", [])
    if not submitted:
        raise CliError(f"重提了 {len(resolved)} 个节点但 server 未入队（可能产物已全部完成）", exitCodes.usage,
                       "想强制重跑已完成节点用 queue submit --nodes <id> --scope all 的节点范围语义，或先 node set 修改后重试")
    emit(result, obj, lambda: f"已重新提交 {len(submitted)} 个任务"
         + ("（已应用 --set 修改）" if patch else ""))


def cmdQueueCancel(obj, target, cancelAll):
    directory = workspaceOf(obj, required=False)
    body = {}
    if cancelAll:
        body["all"] = True
    elif target:
        body["taskId" if len(target) == 36 else "nodeId"] = target
    else:
        raise CliError("用法: tdd queue cancel <taskId|nodeId> | --all", exitCodes.usage)
    if directory:
        body["directory"] = directory
    result = request("/api/queue/cancel", method="POST", body=body) or {}
    emit(result, obj, lambda: f"已取消 {result.get('cancelled', 0)} 个任务")


def cmdQueueExport(obj, formatName, output, verify):
    directory = workspaceOf(obj)
    states = []
    for canvasId in canvasIdsOf(obj) or [None]:
        # export 单画布直接取状态；多画布逐块循环（--canvas 支持逗号分隔数组）。
        states.append(canvasOperation({"canvas": canvasId} if canvasId else obj, directory, "getCanvas", {}))
    rows = []
    for state in states:
        canvasId = state.get("id")
        for node in state.get("nodes", []):
            if "GenerationNode" not in str(node.get("type") or ""):
                continue
            history = node.get("data", {}).get("generationHistory") or []
            last = history[-1] if history else {}
            files = []
            for outputValue in (node.get("data", {}).get("outputs") or {}).values():
                url = ((outputValue or {}).get("value") or {}).get("url")
                if url:
                    files.append({"url": url, "mimeType": (outputValue or {}).get("value", {}).get("mimeType")})
            missing = False
            if verify:
                for file in files:
                    try:
                        info = Path(directory).joinpath(file["url"]).stat()
                        if not info.st_size:
                            missing = True
                        file["bytes"] = info.st_size
                    except OSError:
                        missing = True
            row = {"label": node.get("data", {}).get("label") or node["id"], "nodeId": node["id"],
                   "canvasId": canvasId, "type": str(node.get("type")).replace("remote-", ""),
                   "status": last.get("status") or "idle", "files": files}
            if last.get("error") is not None:
                row["error"] = last["error"]
            if verify:
                row["verified"] = not missing
            rows.append(row)
    if formatName == "json":
        content = json.dumps(rows, ensure_ascii=False, indent=2)
    elif formatName == "csv":
        content = "\n".join(["canvasId,label,nodeId,type,status,files"] + [
            f"\"{row['canvasId']}\",\"{row['label']}\",\"{row['nodeId']}\",\"{row['type']}\",\"{row['status']}\","
            f"\"{' ; '.join(file['url'] for file in row['files'])}\"" for row in rows])
    else:
        lines = [f"# 产物清单（{states[0].get('id') if len(states) == 1 else '、'.join(s.get('id', '') for s in states)}）",
                 "", "| 画布 | 分镜 | 类型 | 状态 | 产物 |", "| --- | --- | --- | --- | --- |"]
        for row in rows:
            status = row["status"] + ("（⚠ 产物缺失）" if verify and row["verified"] is False else "")
            products = "<br>".join(file["url"] for file in row["files"]) or "—"
            lines.append(f"| {row['canvasId']} | {row['label']} | {row['type']} | {status} | {products} |")
        content = "\n".join(lines)
    if output:
        Path(output).write_text(content, encoding="utf-8")
    missingCount = sum(1 for row in rows if row.get("verified") is False)
    emit({"rows": rows, "missing": missingCount, "output": output or None}, obj, lambda: (
        f"产物 {len(rows)} 项" + (f" 已写入 {output}" if output else "")
        + ((f"\n⚠ {missingCount} 项产物文件缺失" if missingCount else "\n全部产物文件在盘 ✓") if verify else "")))
    if missingCount:
        sys.exit(exitCodes.hasFailures)
