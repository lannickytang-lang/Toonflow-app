"""status / models / config / project 命令实现。"""
import json
from urllib.parse import quote

from .client import CliError, emit, exitCodes, request, serverBase, workspaceCacheFile, workspaceOf


def cmdStatus(obj):
    import os
    import shutil

    from .install import tddScriptDir
    projects = request("/api/projects/list")
    workspace = workspaceOf(obj, required=False)
    scriptDir = tddScriptDir()
    whichOk = shutil.which("tdd") is not None
    output = {"server": serverBase(), "online": True, "projects": len(projects),
              "workspace": workspace or None, "tddCommandOk": whichOk, "scriptDirectory": scriptDir}
    def human():
        lines = [f"Toonflow server: {serverBase()} 在线", f"项目数: {len(projects)}"]
        if workspace:
            lines.append(f"默认工作区(已记住): {workspace}")
        if not whichOk:
            import sys as sysModule
            lines.append(f"⚠ tdd 命令不在 PATH（安装于 {scriptDir or '未知目录'}）；"
                         f"临时使用：export PATH=\"{scriptDir}:$PATH\"")
            if scriptDir:
                if sysModule.platform == "win32":
                    lines.append(f"永久修复（转达用户执行后重开终端）：setx PATH \"%PATH%;{scriptDir}\"")
                else:
                    lines.append(f"永久修复（转达用户执行后重开终端）：echo 'export PATH=\"{scriptDir}:$PATH\"' >> ~/.zshrc")
        return "\n".join(lines)
    emit(output, obj, human)


def cmdModels(obj, typeFilter):
    providers = request("/api/providers/media/list")
    rows = []
    for provider in providers:
        for model in provider.get("models", []):
            if typeFilter and model.get("type") != typeFilter:
                continue
            rows.append({"providerId": provider.get("id"), "modelId": model.get("id"),
                         "type": model.get("type"), "ref": f"{provider.get('id')}/{model.get('id')}"})
    emit(rows, obj, lambda: "\n".join(f"{row['ref']}  {row['type']}" for row in rows) or "（无模型）")


def fetchSettings():
    # settings/get 的 data 字段即 settings 内容本身（不再包 settings 键）；
    # bun 版曾取 data.settings ?? {} 恒为空，config set 会清空全部既有配置——勿回退。
    data = request("/api/settings/get")
    return data if isinstance(data, dict) else {}


def cmdConfigGet(obj, key):
    if not key:
        raise CliError("用法: tdd config get <点路径>（如 mediaProviderConfigs.grsai）", exitCodes.usage)
    settings = fetchSettings()
    value = settings
    for segment in key.split("."):
        value = value.get(segment) if isinstance(value, dict) else None
    if value is None:
        raise CliError(f"配置项不存在: {key}", exitCodes.notFound)
    isObject = isinstance(value, (dict, list))
    emit({"key": key, "value": "[对象，--json 查看]" if isObject else value}, obj,
         lambda: f"{key} = {json.dumps(value, ensure_ascii=False)[:200] if isObject else value}")


def coerceValue(value):
    """值类型推断：'true'/'false' → 布尔，整数字符串 → 数字，其余原样字符串。
    不做推断时 'false' 会以字符串落盘，server 端 `!== false` 判断失效（如 mcp.enabled）。"""
    if value == "true":
        return True
    if value == "false":
        return False
    try:
        return int(value)
    except ValueError:
        return value


def cmdConfigSet(obj, key, value):
    if not key or value is None:
        raise CliError("用法: tdd config set <点路径> <值>（如 mediaProviderConfigs.grsai.ts <apiKey>）", exitCodes.usage)
    settings = fetchSettings()
    segments = key.split(".")
    cursor = settings
    for segment in segments[:-1]:
        if not isinstance(cursor.get(segment), dict):
            cursor[segment] = {}
        cursor = cursor[segment]
    cursor[segments[-1]] = coerceValue(value)
    request("/api/settings/save", method="PUT", body={"settings": settings})
    emit({"key": key, "updated": True}, obj, lambda: f"已更新 {key}")


def cmdProjectList(obj):
    projects = request("/api/projects/list")
    emit(projects, obj, lambda: "\n".join(f"{p.get('name')}\t{p.get('directory')}" for p in projects) or "（无项目）")


def cmdProjectOpen(obj, directory):
    if not directory:
        raise CliError("用法: tdd project open <绝对目录>（不存在会自动创建）", exitCodes.usage)
    canvases = request(f"/api/canvas/list?directory={quote(directory)}")
    cache = workspaceCacheFile()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(directory, encoding="utf-8")
    emit({"directory": directory, "canvases": len(canvases), "remembered": True}, obj,
         lambda: (f"工作区就绪: {directory}（画布 {len(canvases)} 个）\n"
                  "已记住为默认工作区，后续命令可省略 -w"))
