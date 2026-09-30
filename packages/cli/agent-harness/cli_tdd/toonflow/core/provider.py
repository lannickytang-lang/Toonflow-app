"""provider 命令组：自定义媒体供应商的开发接入。

inspect/dryrun 零费用（dryrun 请求不出网，按样例响应验证代码逻辑）·
import/config/models/list 本地与配置操作 · test/delete 破坏性或计费操作需 --yes。
"""
import json
import urllib.error
import urllib.request
from pathlib import Path

from .client import CliError, emit, exitCodes, request, serverBase
from .configProject import fetchSettings


def readSource(file):
    try:
        return Path(file).read_text(encoding="utf-8")
    except OSError as error:
        raise CliError(f"读取供应商文件失败: {file}（{error}）", exitCodes.usage,
                       "文件应为 UTF-8 编码的 TypeScript 源码（文件名须为 <id>.ts）") from error


def providerOf(providerId):
    """从 media/list 定位供应商元数据；不存在时报码 4。"""
    for provider in request("/api/providers/media/list"):
        if provider.get("id") == providerId:
            return provider
    raise CliError(f"供应商不存在: {providerId}", exitCodes.notFound,
                   "用 tdd provider list 查看已安装供应商")


def parseAssignments(pairs, optionName):
    """key=value 多值选项 → dict；凭证值保持字符串原样。"""
    result = {}
    for pair in pairs or ():
        key, separator, value = pair.partition("=")
        if not separator or not key.strip():
            raise CliError(f"无效赋值: {pair}（格式 {optionName} key=value）", exitCodes.usage)
        result[key.strip()] = value
    return result


def maskSecret(key, value):
    if not value or not any(word in key.lower() for word in ("key", "secret", "token", "password")):
        return value
    return "••••••" if len(value) <= 8 else f"{value[:4]}••••{value[-4:]}"


def cmdProviderList(obj):
    providers = request("/api/providers/media/list")
    configured = (fetchSettings().get("mediaProviderConfigs") or {})
    rows = []
    for provider in providers:
        models = provider.get("models") or []
        row = {
            "id": provider.get("id"), "label": provider.get("label"), "version": provider.get("version"),
            "models": {kind: sum(1 for model in models if model.get("type") == kind)
                       for kind in ("image", "video", "audio")},
            "configured": bool(configured.get(provider.get("id"))),
            "fileName": provider.get("fileName"), "revision": provider.get("revision"),
        }
        if provider.get("loadError"):
            row["loadError"] = provider["loadError"]
        rows.append(row)
    def human():
        lines = []
        for row in rows:
            models = " ".join(f"{count}{kind}" for kind, count in row["models"].items() if count)
            line = (f"{row['id']}\t{row['label']}\tv{row['version'] or '?'}\t"
                    f"模型[{models or '无'}]\t{'已配置凭证' if row['configured'] else '缺凭证'}")
            if row.get("loadError"):
                line += f"\t⚠ {row['loadError']}"
            lines.append(line)
        return "\n".join(lines) or "（未安装任何供应商，用 provider import <文件.ts> 安装）"
    emit(rows, obj, human)


def cmdProviderInspect(obj, file):
    """静态校验：语法/导出结构/类型契约（零费用，不运行任何代码）。"""
    result = request("/api/providers/debug/inspect", method="POST", body={"source": readSource(file)})
    def human():
        rules = ", ".join(f"{rule.get('field')}（{rule.get('title')}）" for rule in result.get("rules", [])) or "无凭证字段"
        lines = [f"校验通过: {result.get('id')}（{result.get('label')}）", f"凭证字段: {rules}", "模型:"]
        for model in result.get("models", []):
            lines.append(f"  {model.get('type')}\t{model.get('id')}\t{model.get('label')}")
        lines.append("（inspect 只校验结构，不运行代码；跑逻辑用 provider dryrun）")
        return "\n".join(lines)
    emit(result, obj, human)


def cmdProviderImport(obj, file):
    """安装供应商到 Toonflow（写入 data/providers/<id>.ts）。"""
    result = request("/api/providers/media/add", method="POST", body={"source": readSource(file)})
    emit(result, obj, lambda: (
        f"已安装 {result.get('id')}（{result.get('label')}，v{result.get('version') or '?'}，"
        f"模型 {len(result.get('models') or [])} 个）\n"
        f"下一步: tdd provider config {result.get('id')} --set apiKey=<密钥>"))


def cmdProviderConfig(obj, providerId, sets):
    """写入供应商凭证/配置（settings.mediaProviderConfigs.<id>）。"""
    providerOf(providerId)
    values = parseAssignments(sets, "--set")
    if not values:
        raise CliError("用法: tdd provider config <id> --set apiKey=<值>（--set 可多次）", exitCodes.usage)
    settings = fetchSettings()
    target = settings.setdefault("mediaProviderConfigs", {}).setdefault(providerId, {})
    masked = {}
    for key, value in values.items():
        target[key] = value
        masked[key] = maskSecret(key, value)
    request("/api/settings/save", method="PUT", body={"settings": settings})
    emit({"id": providerId, "updated": masked}, obj,
         lambda: f"已写入 {providerId}: " + ", ".join(f"{key}={masked[key]}" for key in masked))


def cmdProviderModels(obj, providerId, refresh):
    """查看模型清单；--refresh 从供应商 modelsUrl 拉取最新（零费用连通性验证）。"""
    provider = providerOf(providerId)
    if not refresh:
        rows = [{"modelId": model.get("id"), "label": model.get("label"), "type": model.get("type")}
                for model in provider.get("models") or []]
        emit(rows, obj, lambda: "\n".join(
            f"{row['modelId']}\t{row['type']}\t{row['label']}" for row in rows) or "（无模型）")
        return
    before = {model.get("id") for model in provider.get("models") or []}
    result = request("/api/providers/media/models", method="POST",
                     body={"fileName": provider.get("fileName"), "revision": provider.get("revision")})
    after = [model.get("id") for model in result.get("models") or []]
    added = [modelId for modelId in after if modelId not in before]
    removed = sorted(before - set(after))
    def human():
        text = f"模型列表已刷新: +{len(added)} -{len(removed)}（现存 {len(after)} 个）"
        for modelId in added:
            text += f"\n+ {modelId}"
        for modelId in removed:
            text += f"\n- {modelId}"
        return text
    emit({"id": providerId, "added": added, "removed": removed, "models": result.get("models")}, obj, human)


def streamDebug(body):
    """POST /api/providers/debug/run，逐行消费 NDJSON 事件流。"""
    req = urllib.request.Request(
        f"{serverBase()}/api/providers/debug/run",
        data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/x-ndjson",
                 "x-toonflow-workspace": "1", "Origin": serverBase()})
    events, result, errorMessage = [], None, None
    try:
        with urllib.request.urlopen(req, timeout=1830) as response:
            for line in response:
                line = line.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                events.append(event)
                if event.get("type") == "result":
                    result = event
                elif event.get("type") == "error":
                    errorMessage = event.get("message")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise CliError(f"调试通道请求失败 HTTP {error.code}: {detail}", exitCodes.usage) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise CliError(f"无法连接 Toonflow server（{serverBase()}）：{error}", exitCodes.serverDown,
                       "请先启动 Toonflow（bun run dev 或桌面应用），或用 --server 指定地址") from error
    return events, result, errorMessage


def buildDebugRequest(model, prompt, ratio, size, duration, resolution):
    payload = {"model": model, "prompt": prompt, "text": prompt}
    for key, value in (("ratio", ratio), ("size", size), ("duration", duration), ("resolution", resolution)):
        if value is not None:
            payload[key] = value
    return payload


def reportDebug(obj, mode, providerFile, model, events, result, errorMessage):
    logs = [event.get("log") for event in events if event.get("type") == "log"]
    if obj.get("json"):
        emit({"mode": mode, "file": providerFile, "model": model, "logs": logs,
              "result": result, "error": errorMessage}, obj)
        return errorMessage is not None
    print(f"── {mode}（{providerFile} · {model}）──")
    for log in logs:
        state = "mock" if log.get("mock") else str(log.get("state") or "")
        status = f" HTTP {log.get('status')}" if log.get("status") else ""
        duration = f" {log.get('duration')}ms" if log.get("duration") is not None else ""
        print(f"[{log.get('id')}] {log.get('method')} {log.get('url')} → {state}{status}{duration}")
        for part in ("request", "response"):
            text = log.get(part)
            if text:
                print(f"  {part}: {str(text)[:400]}")
    if result:
        assets = result.get("assets") or []
        kinds = ", ".join(str(asset.get("mediaType")) for asset in assets)
        print(f"成功: {len(assets)} 个媒体（{kinds}），总耗时 {result.get('duration')}ms")
    elif errorMessage:
        print(f"失败: {errorMessage}")
    return errorMessage is not None


def cmdProviderDryrun(obj, file, model, prompt, samples, config, ratio, size, duration, resolution):
    """离线干跑：请求不出网，按样例响应验证入参构造与结果解析（零费用）。"""
    if not model:
        raise CliError("用法: tdd provider dryrun <文件.ts> --model <模型id> [--samples 样例.json]", exitCodes.usage)
    mockSamples = []
    if samples:
        try:
            raw = json.loads(Path(samples).read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise CliError(f"读取样例文件失败: {samples}（{error}）", exitCodes.usage,
                           "样例文件为 JSON 数组: [{\"match\":\"api.example\",\"status\":200,\"body\":{…}}]") from error
        for item in raw if isinstance(raw, list) else [raw]:
            if not isinstance(item, dict):
                raise CliError(f"样例必须是对象: {item}", exitCodes.usage)
            body = item.get("body", {})
            mockSamples.append({
                "match": item.get("match"), "times": item.get("times", 1),
                "status": item.get("status", 200), "contentType": item.get("contentType", "application/json"),
                "body": body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)})
    body = {"source": readSource(file), "config": parseAssignments(config, "--config"),
            "request": buildDebugRequest(model, prompt or "dryrun 测试提示词", ratio, size, duration, resolution)}
    # dryrun 承诺"请求不出网"：无样例也强制 mock 模式（未匹配请求返回可诊断 404），绝不真实出网。
    body["mock"] = {"samples": mockSamples}
    events, result, errorMessage = streamDebug(body)
    failed = reportDebug(obj, "dryrun 干跑", file, model, events, result, errorMessage)
    if failed:
        raise CliError("dryrun 未通过：按上方请求日志定位入参构造或结果解析问题", exitCodes.usage)


def cmdProviderTest(obj, file, model, prompt, config, yes, ratio, size, duration, resolution):
    """真实调用上游接口验证（会产生实际费用，必须 --yes 确认）。"""
    if not yes:
        raise CliError(f"拒绝执行：将真实调用 {file} 的模型 {model or '(未指定)'}，上游接口会产生实际费用。",
                       exitCodes.usage,
                       "确认调用无误后，加 --yes 重新执行本命令")
    if not model:
        raise CliError("用法: tdd provider test <文件.ts> --model <模型id> --yes", exitCodes.usage)
    body = {"source": readSource(file), "config": parseAssignments(config, "--config"),
            "request": buildDebugRequest(model, prompt or "真实测试提示词", ratio, size, duration, resolution)}
    events, result, errorMessage = streamDebug(body)
    failed = reportDebug(obj, "test 真测", file, model, events, result, errorMessage)
    if failed:
        raise CliError("真测失败：按上方请求日志排查（鉴权/参数/上游错误）", exitCodes.usage)


def cmdProviderDelete(obj, providerId, yes):
    """删除供应商及其凭证配置（破坏性操作，需 --yes）。"""
    if not yes:
        raise CliError(f"拒绝执行：将删除供应商 {providerId} 及其凭证配置。", exitCodes.usage,
                       "确认后加 --yes 重新执行")
    provider = providerOf(providerId)
    request("/api/providers/media/delete", method="DELETE",
            body={"fileName": provider.get("fileName"), "revision": provider.get("revision")})
    emit({"id": providerId, "deleted": True}, obj,
         lambda: f"已删除 {providerId}（{provider.get('fileName')}）及其凭证配置")
