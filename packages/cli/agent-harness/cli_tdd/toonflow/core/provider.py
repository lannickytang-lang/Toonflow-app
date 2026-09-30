"""provider 命令组：自定义媒体供应商的开发接入。

inspect/dryrun 零费用（dryrun 请求不出网，按样例响应验证代码逻辑）·
import/config/models/list 本地与配置操作 · test/delete 破坏性或计费操作需 --yes。
"""
import base64
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

from .client import CliError, emit, exitCodes, request, serverBase
from .configProject import fetchSettings


mediaMimeTypes = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
}


def mediaInputOf(value):
    """--image/--audio 等素材值 → MediaInput：http(s) 当 url，其余按本地文件转 base64。"""
    if value.startswith(("http://", "https://")):
        return {"type": "url", "url": value}
    path = Path(value)
    try:
        data = base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError as error:
        raise CliError(f"读取素材文件失败: {value}（{error}）", exitCodes.usage,
                       "素材传 http(s) URL 或本地文件路径") from error
    return {"type": "base64", "data": data, "mimeType": mediaMimeTypes.get(path.suffix.lower(), "application/octet-stream")}


def readSource(file):
    try:
        return Path(file).read_text(encoding="utf-8")
    except OSError as error:
        raise CliError(f"读取供应商文件失败: {file}（{error}）", exitCodes.usage,
                       "文件应为 UTF-8 编码的 TypeScript 源码（文件名须为 <id>.ts）") from error


def extractProviderZip(zipFile):
    """解包供应商 zip：恰好一个 <id>.ts + 可选 config.html（允许单一顶层目录包裹）。"""
    import zipfile as zf
    try:
        with zf.ZipFile(zipFile) as archive:
            names = [name for name in archive.namelist()
                     if not name.startswith("__MACOSX") and not name.endswith("/")]
            prefix = ""
            tops = {name.split("/")[0] for name in names}
            if len(tops) == 1 and all("/" in name for name in names):
                prefix = f"{next(iter(tops))}/"
            relative = [name[len(prefix):] for name in names]
            sourceNames = [name for name in relative if re.fullmatch(r"[a-z][a-zA-Z0-9]*\.ts", name)]
            if len(sourceNames) != 1:
                raise CliError("供应商包须包含恰好一个 <id>.ts 源文件（根级或同名目录内）", exitCodes.usage)
            extras = [name for name in relative if name not in (sourceNames[0], "config.html")]
            if extras:
                raise CliError(f"供应商包只允许 <id>.ts 与 config.html，多余文件: {extras[0]}", exitCodes.usage)
            source = archive.read(prefix + sourceNames[0]).decode("utf-8")
            configHtml = archive.read(prefix + "config.html").decode("utf-8") if f"{prefix}config.html" in names else None
            return source, configHtml
    except CliError:
        raise
    except (zf.BadZipFile, OSError, UnicodeDecodeError) as error:
        raise CliError(f"读取供应商包失败: {zipFile}（{error}）", exitCodes.usage) from error


def readConfigHtml(providerFile):
    """伴生配置界面探测：<id>.ts 同目录的 <id>.html；.zip 包内提取。无则返回 None。"""
    path = Path(providerFile)
    if path.suffix.lower() == ".zip":
        return extractProviderZip(path)[1]
    htmlPath = path.with_name(f"{path.stem}.html")
    try:
        return htmlPath.read_text(encoding="utf-8") if htmlPath.is_file() else None
    except OSError as error:
        raise CliError(f"读取配置界面文件失败: {htmlPath}（{error}）", exitCodes.usage) from error


def checkConfigHtml(html):
    """config.html 静态检查：硬错误抛 CliError，警告原样返回。"""
    problems, warnings = [], []
    if len(html.encode("utf-8")) > 512 * 1024:
        problems.append("超过 512 KB 上限")
    if "<html" in html.lower():
        warnings.append("检测到完整 HTML 文档：宿主只取 <body> 内容，<head> 内脚本样式不会生效")
    for call in ("toonflow.getConfig", "toonflow.setConfig"):
        if call not in html:
            problems.append(f"未调用 {call}（界面须 getConfig 回显配置、setConfig 上报编辑结果）")
    if "toonflow.ready" not in html:
        warnings.append("未调用 toonflow.ready()：界面就绪后应调用（宿主据此结束加载态，10 秒未握手判失败）")
    if re.search(r'(?:src|href)\s*=\s*["\']https?://', html, re.I):
        warnings.append("含外链资源（src/href 指向 http）：建议内联，外链在离线环境不可用")
    if problems:
        raise CliError("config.html 校验失败: " + "；".join(problems), exitCodes.usage,
                       "按 providerSpec.md 的配置界面章节修正后重试")
    return warnings


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


def providerIdOfSource(source):
    """从供应商源码轻量解析 id（顶层对象字面量的 id 字段），用于凭证回退定位。"""
    match = re.search(r'^\s*id:\s*"([a-z][a-zA-Z0-9]*)"', source, re.MULTILINE)
    return match.group(1) if match else None


def resolveConfig(source, configPairs):
    """凭证解析：--config 临时值优先；未提供时回退读取已装同 id 供应商的持久化配置。
    不回退时按文档真测会误报"请填写 API Key"——已装已配置的凭证必须自动生效。"""
    explicit = parseAssignments(configPairs, "--config")
    if explicit:
        return explicit, "临时凭证（--config）"
    providerId = providerIdOfSource(source)
    if providerId:
        configured = (fetchSettings().get("mediaProviderConfigs") or {}).get(providerId)
        if isinstance(configured, dict) and any(str(value).strip() for value in configured.values()):
            return dict(configured), f"已装供应商 {providerId} 的持久化凭证"
    return {}, ""


def installedConfigOf(providerId):
    configured = (fetchSettings().get("mediaProviderConfigs") or {}).get(providerId)
    return dict(configured) if isinstance(configured, dict) else {}


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
            "configHtml": bool(provider.get("hasConfigHtml")),
            "fileName": provider.get("fileName"), "revision": provider.get("revision"),
        }
        if provider.get("loadError"):
            row["loadError"] = provider["loadError"]
        rows.append(row)
    def human():
        lines = []
        for row in rows:
            models = " ".join(f"{count}{kind}" for kind, count in row["models"].items() if count)
            configTag = "\t自定义配置界面" if row["configHtml"] else ""
            line = (f"{row['id']}\t{row['label']}\tv{row['version'] or '?'}\t"
                    f"模型[{models or '无'}]\t{'已配置凭证' if row['configured'] else '缺凭证'}{configTag}")
            if row.get("loadError"):
                line += f"\t⚠ {row['loadError']}"
            lines.append(line)
        return "\n".join(lines) or "（未安装任何供应商，用 provider import <文件.ts|.zip> 安装）"
    emit(rows, obj, human)


def cmdProviderInspect(obj, file):
    """静态校验：语法/导出结构/类型契约 + 伴生 config.html 检查（零费用，不运行任何代码）。"""
    path = Path(file)
    if path.suffix.lower() == ".zip":
        source, configHtml = extractProviderZip(path)
    else:
        source = readSource(file)
        configHtml = readConfigHtml(file)
    result = request("/api/providers/debug/inspect", method="POST", body={"source": source})
    htmlWarnings = checkConfigHtml(configHtml) if configHtml is not None else None
    def human():
        rules = ", ".join(f"{rule.get('field')}（{rule.get('title')}）" for rule in result.get("rules", [])) or "无凭证字段"
        lines = [f"校验通过: {result.get('id')}（{result.get('label')}）", f"凭证字段: {rules}"]
        if htmlWarnings is not None:
            lines.append("配置界面: config.html 校验通过")
            lines.extend(f"  ⚠ {warning}" for warning in htmlWarnings)
        lines.append("模型:")
        for model in result.get("models", []):
            lines.append(f"  {model.get('type')}\t{model.get('id')}\t{model.get('label')}")
        lines.append("（inspect 只校验结构，不运行代码；跑逻辑用 provider dryrun；"
                     "界面视觉效果在 设置→媒体模型→编辑供应商 中人工确认）")
        return "\n".join(lines)
    payload = dict(result)
    if htmlWarnings is not None:
        payload["configHtml"] = {"checked": True, "warnings": htmlWarnings}
    emit(payload, obj, human)


def cmdProviderImport(obj, file):
    """安装供应商到 Toonflow（.ts 自动携带同目录 <id>.html；或整包 .zip）。"""
    path = Path(file)
    if path.suffix.lower() == ".zip":
        source, configHtml = extractProviderZip(path)
    else:
        source = readSource(file)
        configHtml = readConfigHtml(path)
    body = {"source": source}
    if configHtml is not None:
        body["configHtml"] = configHtml
    result = request("/api/providers/media/add", method="POST", body=body)
    emit(result, obj, lambda: (
        f"已安装 {result.get('id')}（{result.get('label')}，v{result.get('version') or '?'}，"
        f"模型 {len(result.get('models') or [])} 个"
        + ("，含自定义配置界面" if result.get("hasConfigHtml") else "") + "）\n"
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


def buildDebugRequest(model, prompt, ratio, size, duration, resolution, images=(), audios=(), firstFrame=None, lastFrame=None):
    payload = {"model": model, "prompt": prompt, "text": prompt}
    for key, value in (("ratio", ratio), ("size", size), ("duration", duration), ("resolution", resolution)):
        if value is not None:
            payload[key] = value
    # 参考素材：图生视频/多参考模型（如 ref_image 必填工作流）必须能带素材真测，否则 CLI 测试止步于本地校验。
    if images:
        payload["images"] = [mediaInputOf(item) for item in images]
    if audios:
        payload["audios"] = [mediaInputOf(item) for item in audios]
    if firstFrame:
        payload["firstFrame"] = mediaInputOf(firstFrame)
    if lastFrame:
        payload["lastFrame"] = mediaInputOf(lastFrame)
    return payload


def foldPollLogs(logs):
    """折叠轮询冗余：连续同 method+url+status 的日志合并为一条（返回 (log, count) 列表）。
    49 次轮询曾产生 98 条重复事件把输出撑到 47KB——结果藏在尾部。"""
    folded = []
    for log in logs:
        key = (log.get("method"), log.get("url"), log.get("status"))
        if folded and folded[-1][1] == key:
            folded[-1] = (log, key, folded[-1][2] + 1)
            continue
        folded.append((log, key, 1))
    return [(log, count) for log, _, count in folded]


def reportDebug(obj, mode, providerFile, model, events, result, errorMessage, note=""):
    logs = [event.get("log") for event in events if event.get("type") == "log"]
    if obj.get("json"):
        emit({"mode": mode, "file": providerFile, "model": model, "logs": logs,
              "result": result, "error": errorMessage, "note": note or None}, obj)
        return errorMessage is not None
    print(f"── {mode}（{providerFile} · {model}）──{note}")
    for log, count in foldPollLogs(logs):
        state = "mock" if log.get("mock") else str(log.get("state") or "")
        status = f" HTTP {log.get('status')}" if log.get("status") else ""
        duration = f" {log.get('duration')}ms" if log.get("duration") is not None else ""
        repeats = f"（连续 {count} 次）" if count > 1 else ""
        print(f"[{log.get('id')}] {log.get('method')} {log.get('url')} → {state}{status}{duration}{repeats}")
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


def cmdProviderDryrun(obj, file, model, prompt, samples, config, ratio, size, duration, resolution,
                      images, audios, firstFrame, lastFrame):
    """离线干跑：请求不出网，按样例响应验证入参构造与结果解析（零费用）。"""
    if not model:
        raise CliError("用法: tdd provider dryrun <文件.ts> --model <模型id> [--samples 样例.json]", exitCodes.usage)
    mockSamples = []
    if samples:
        try:
            raw = json.loads(Path(samples).read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise CliError(f"读取样例文件失败: {samples}（{error}）", exitCodes.usage,
                           "样例文件为 JSON 数组: [{\"match\":\"api.example\",\"method\":\"POST\",\"status\":200,\"body\":{…}}]") from error
        for item in raw if isinstance(raw, list) else [raw]:
            if not isinstance(item, dict):
                raise CliError(f"样例必须是对象: {item}", exitCodes.usage)
            body = item.get("body", {})
            # 缺省的 match/method 必须整个省略（None 序列化为 null 会被服务端 optional 拒绝）。
            sample = {
                "times": item.get("times", 1),
                "status": item.get("status", 200),
                "contentType": item.get("contentType", "application/json"),
                "body": body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)}
            for optionalKey in ("match", "method"):
                if item.get(optionalKey):
                    sample[optionalKey] = str(item[optionalKey])
            mockSamples.append(sample)
    source = readSource(file)
    config, configOrigin = resolveConfig(source, config)
    body = {"source": source, "config": config,
            "request": buildDebugRequest(model, prompt or "dryrun 测试提示词", ratio, size, duration, resolution,
                                         images, audios, firstFrame, lastFrame)}
    # dryrun 承诺"请求不出网"：无样例也强制 mock 模式（未匹配请求返回可诊断 404），绝不真实出网。
    body["mock"] = {"samples": mockSamples}
    events, result, errorMessage = streamDebug(body)
    credentialNote = f"（凭证来源：{configOrigin}）" if configOrigin else ""
    failed = reportDebug(obj, "dryrun 干跑", file, model, events, result, errorMessage, credentialNote)
    if failed:
        raise CliError("dryrun 未通过：按上方请求日志定位入参构造或结果解析问题", exitCodes.usage)


def cmdProviderTest(obj, file, model, prompt, config, yes, ratio, size, duration, resolution,
                    images, audios, firstFrame, lastFrame):
    """真实调用上游接口验证（会产生实际费用，必须 --yes 确认）。"""
    source = readSource(file)
    configValues, configOrigin = resolveConfig(source, config)
    if not yes:
        raise CliError(f"拒绝执行：将真实调用 {file} 的模型 {model or '(未指定)'}，上游接口会产生实际费用。",
                       exitCodes.usage,
                       "确认调用无误后，加 --yes 重新执行本命令")
    if not model:
        raise CliError("用法: tdd provider test <文件.ts> --model <模型id> --yes", exitCodes.usage)
    body = {"source": source, "config": configValues,
            "request": buildDebugRequest(model, prompt or "真实测试提示词", ratio, size, duration, resolution,
                                         images, audios, firstFrame, lastFrame)}
    events, result, errorMessage = streamDebug(body)
    credentialNote = f"（凭证来源：{configOrigin}）" if configOrigin else "（未找到凭证：未配置且未传 --config，若报鉴权错先 provider config）"
    failed = reportDebug(obj, "test 真测", file, model, events, result, errorMessage, credentialNote)
    if failed:
        raise CliError("真测失败：按上方请求日志排查（鉴权/参数/上游错误）", exitCodes.usage)


def cmdProviderDelete(obj, providerId, yes):
    """删除供应商及其凭证配置（破坏性操作，需 --yes）。"""
    if not yes:
        raise CliError(f"拒绝执行：将删除供应商 {providerId} 及其凭证配置。", exitCodes.usage,
                       "确认后加 --yes 重新执行（提示：删除会连带清除已配置凭证，重装后需重新 config）")
    provider = providerOf(providerId)
    request("/api/providers/media/delete", method="DELETE",
            body={"fileName": provider.get("fileName"), "revision": provider.get("revision")})
    emit({"id": providerId, "deleted": True}, obj,
         lambda: f"已删除 {providerId}（{provider.get('fileName')}）；其凭证配置已一并清除，重装后需重新 config")


def cmdProviderProbe(obj, providerId, url, config):
    """只读拉取上游模型列表（零费用）：预检密钥权限覆盖哪些模型。"""
    if not providerId and not url:
        raise CliError("用法: tdd provider probe <供应商id>（用其 modelsUrl 与已配凭证）"
                       "或 tdd provider probe --url <https://…/v1/models> --config apiKey=<key>", exitCodes.usage)
    if providerId:
        provider = providerOf(providerId)
        url = provider.get("modelsUrl")
        if not url:
            raise CliError(f"供应商 {providerId} 未配置 modelsUrl", exitCodes.usage,
                           "改用: tdd provider probe --url <模型列表地址> --config apiKey=<key>")
        configValues = installedConfigOf(providerId)
    else:
        configValues = parseAssignments(config, "--config")
    headers = {"Accept": "application/json", "Origin": serverBase()}
    apiKey = next((str(value) for key, value in configValues.items()
                   if "key" in key.lower() and str(value).strip()), "")
    if apiKey:
        headers["Authorization"] = f"Bearer {apiKey.strip().removeprefix('Bearer').strip()}"
    req = urllib.request.Request(url, method="GET", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:300]
        raise CliError(f"拉取模型列表失败 HTTP {error.code}: {detail}", exitCodes.usage,
                       "401/403=密钥无效；404=地址不对；确认地址与密钥后重试") from error
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
        raise CliError(f"拉取模型列表失败: {error}", exitCodes.usage,
                       "确认地址可达；JSON 解析失败说明该地址不是模型列表接口") from error
    models = payload.get("data") if isinstance(payload, dict) else payload
    rows = [{"modelId": item.get("id")} for item in models if isinstance(item, dict) and item.get("id")]
    if not rows:
        raise CliError("响应中没有模型（无 data[].id）", exitCodes.usage,
                       "该地址可能不是 OpenAI 兼容的模型列表接口；手动核对上游文档")
    emit({"url": url, "count": len(rows), "models": rows}, obj,
         lambda: f"上游可用模型 {len(rows)} 个:\n" + "\n".join(f"  {row['modelId']}" for row in rows))
