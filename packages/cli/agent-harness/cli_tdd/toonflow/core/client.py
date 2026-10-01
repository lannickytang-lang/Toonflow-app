"""HTTP 客户端与公共设施：退出码映射、hint、workspace 记忆、server 探测。纯标准库。"""
import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote


class exitCodes:
    ok = 0
    usage = 2
    conflict = 3
    notFound = 4
    hasFailures = 5
    serverDown = 6


class CliError(Exception):
    def __init__(self, message, code, hint=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.hint = hint


serverOverride = None


def serverBase():
    value = serverOverride or os.environ.get("TOONFLOW_SERVER") or "http://127.0.0.1:47392"
    return value.rstrip("/")


def cliRoot():
    """数据根推导：仅认 …/cli/agent-harness 目录结构（源码 packages/cli/ 或桌面安装根 cli/）。
    源码与桌面的目录层级不同（packages/cli/… 多一级），从 cli 目录向上逐级找
    package.json（源码仓库）或 views（桌面安装）特征；site-packages 发行态返回 None。
    不能无限向上找特征文件——嵌在仓库里的 venv 会误命中。"""
    for parent in Path(__file__).resolve().parents:
        if parent.name == "agent-harness" and parent.parent.name == "cli":
            for root in parent.parents[1:]:
                if (root / "package.json").exists() or (root / "views").is_dir():
                    return root
            return None
    return None


def dataDirectory():
    root = cliRoot()
    return (root / "data") if root else (Path.home() / ".tdd")


def workspaceCacheFile():
    return dataDirectory() / "tddWorkspace.txt"


def readWorkspaceCache():
    try:
        return workspaceCacheFile().read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def workspaceOf(obj, required=True):
    """工作区三级解析：-w 参数 → 环境变量 → 缓存文件记忆。"""
    directory = obj.get("workspace") or os.environ.get("TOONFLOW_WORKSPACE")
    if directory:
        return directory
    cached = readWorkspaceCache()
    if cached:
        return cached
    if required:
        raise CliError(
            "缺少工作区目录", exitCodes.usage,
            "用 -w <目录> 指定，或先 project open <目录>（会记住），或设置环境变量 TOONFLOW_WORKSPACE")
    return None


def request(path, method="GET", body=None):
    """统一请求：{code,data,message} 解包；HTTP 状态 → 退出码映射；连接失败 → 码 6。"""
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        f"{serverBase()}{path}", data=payload, method=method,
        # settings 等接口走 assertAppRequest：要求同源 origin + x-toonflow-workspace 头。
        headers={"Content-Type": "application/json", "x-toonflow-workspace": "1", "Origin": serverBase()})
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            status = response.status
            text = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        status = error.code
        text = error.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise CliError(
            f"无法连接 Toonflow server（{serverBase()}）：{error}", exitCodes.serverDown,
            "请先启动 Toonflow（bun run dev 或桌面应用），或用 --server 指定地址") from error
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    if status >= 400 or (isinstance(data, dict) and data.get("code") != 200):
        message = data.get("message") if isinstance(data, dict) else None
        message = message or f"HTTP {status}"
        if status == 409:
            hint = ("供应商已安装：改源码请先 tdd provider delete <id> --yes 再 import；改模型列表用 provider models <id> --refresh"
                    if "/api/providers/" in path else
                    "画布已被其他端修改：先 canvas get 重读最新画布，再重试修改")
            raise CliError(message, exitCodes.conflict, hint)
        if status == 404:
            raise CliError(message, exitCodes.notFound,
                           "目标不存在：用 canvas list / canvas get 查询最新 ID 后重试")
        raise CliError(message, exitCodes.usage)
    return data.get("data") if isinstance(data, dict) else None


def canvasOperation(obj, directory, name, args):
    body = {"directory": directory, "name": name, "args": args}
    canvasId = obj.get("canvas")
    if canvasId:
        # 画布 id 即文件名（如 画布2.json）；省略 .json 后缀是自然习惯且无歧义（带后缀才是合法 id），统一补全。
        body["canvasId"] = canvasId if canvasId.endswith(".json") else f"{canvasId}.json"
    return request("/api/canvas/operation", method="POST", body=body)


def getCanvasState(obj):
    return canvasOperation(obj, workspaceOf(obj), "getCanvas", {})


def emit(data, obj, human=""):
    """--json 输出结构化结果，否则输出人类可读文案。"""
    if obj.get("json"):
        print(json.dumps(data, ensure_ascii=False, indent=2, default=str))
    elif human:
        value = human() if callable(human) else human
        if value:
            print(value)
