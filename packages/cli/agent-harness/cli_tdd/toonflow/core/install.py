"""一键安装（零参数）：
1. 自动探测本机 agent 宿主（claude/codex/zcode/agents 等）技能目录，装入 canvasOperation / toonflowCli 技能；
2. 从分发中心（tudodo-center）全量拉取 Toonflow 侧插件（技能/供应商/工具），版本一致自动跳过。
"""
import io
import json
import re
import shutil
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from .client import dataDirectory

defaultMirror = "https://gitee.com/comtudodo/tudodo-center/raw/master"


def hostCandidatesOf():
    home = Path.home()
    return [
        {"id": "claude", "skillsDirectory": home / ".claude" / "skills"},
        {"id": "codex", "skillsDirectory": home / ".codex" / "skills"},
        {"id": "zcode", "skillsDirectory": home / ".zcode" / "skills"},
        {"id": "agents", "skillsDirectory": home / ".agents" / "skills"},
    ]


def _fetch(url, timeout):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"下载失败 HTTP {error.code}: {url}") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise RuntimeError(f"下载失败: {url}（{error}）") from error


def fetchText(url):
    return _fetch(url, 30).decode("utf-8")


def fetchBinary(url):
    return _fetch(url, 60)


def unzip(content):
    """中心 zip 解压（store/deflate 均支持），返回 相对路径 -> 内容 字节。"""
    files = {}
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        for name in archive.namelist():
            if not name.endswith("/"):
                files[name] = archive.read(name)
    return files


def writeZipEntries(zipped, target):
    """解压到目标目录，剥掉 zip 内顶层目录（与中心打包结构一致）。"""
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    for path, content in zipped.items():
        relative = "/".join(path.split("/")[1:])
        if not relative:
            continue
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)


def localSkillVersion(skillsRoot, name):
    path = Path(skillsRoot) / name / "SKILL.md"
    if not path.exists():
        return ""
    match = re.search(r"version:\s*([^\s]+)", path.read_text(encoding="utf-8"))
    return match.group(1) if match else ""


def runInstall(options):
    """执行安装，返回退出码（0 成功 / 5 有失败项）。options: hosts/force/mirror/toonflowOnly/hostsOnly。"""
    mirror = options.get("mirror") or defaultMirror
    force = bool(options.get("force"))
    dataDir = dataDirectory()
    installed = []

    def report(category, name, action, detail=None):
        installed.append({"action": action})
        print(f"[{action}] {category}/{name}（{detail}）" if detail else f"[{action}] {category}/{name}")

    def installHostSkills():
        hostsArgument = options.get("hosts")
        if hostsArgument:
            hosts = [{"id": directory, "skillsDirectory": Path(directory)} for directory in hostsArgument.split(",")]
        else:
            hosts = [host for host in hostCandidatesOf() if Path(host["skillsDirectory"]).exists()]
        if not hosts:
            print("未探测到 agent 宿主技能目录（claude/codex/zcode/agents），跳过宿主安装；用 --hosts <目录> 显式指定")
            return
        for host in hosts:
            for name in ("canvasOperation", "toonflowCli"):
                try:
                    target = Path(host["skillsDirectory"]) / name
                    local = localSkillVersion(host["skillsDirectory"], name)
                    # 版本从 zip 内 SKILL.md 读取，避免单独请求。
                    zipped = unzip(fetchBinary(f"{mirror}/dist/skills/{name}.zip"))
                    skillEntry = next((path for path in zipped if path.endswith("SKILL.md")), None)
                    if not skillEntry:
                        raise RuntimeError("zip 内无 SKILL.md")
                    remoteMatch = re.search(r"version:\s*([^\s]+)", zipped[skillEntry].decode("utf-8"))
                    remoteVersion = remoteMatch.group(1) if remoteMatch else ""
                    if not force and local and local == remoteVersion:
                        report(f"宿主/{host['id']}", name, "跳过", f"已同版本 {local}")
                        continue
                    writeZipEntries(zipped, target)
                    report(f"宿主/{host['id']}", name, "覆盖安装" if force else "安装", remoteVersion)
                except Exception as error:  # noqa: BLE001（单项失败不中断整体安装）
                    report(f"宿主/{host['id']}", name, "失败", str(error))

    def installToonflowSide():
        manifest = json.loads(fetchText(f"{mirror}/manifest.json"))
        for skill in manifest.get("skills", []):
            target = dataDir / "skills" / skill["name"]
            local = localSkillVersion(dataDir / "skills", skill["name"])
            if not force and local and local == skill.get("version"):
                report("Toonflow/技能", skill["name"], "跳过", f"已同版本 {local}")
                continue
            zipped = unzip(fetchBinary(f"{mirror}/{skill['file']}"))
            writeZipEntries(zipped, target)
            report("Toonflow/技能", skill["name"], "覆盖安装" if force else "安装", skill.get("version"))
        for provider in manifest.get("providers", []):
            target = dataDir / "providers" / f"{provider['name']}.ts"
            local = ""
            if target.exists():
                match = re.search(r'const version = "([^"]+)"', target.read_text(encoding="utf-8"))
                local = match.group(1) if match else ""
            if not force and local and local == provider.get("version"):
                report("Toonflow/供应商", provider["name"], "跳过", f"已同版本 {local}")
                continue
            source = fetchText(f"{mirror}/{provider['file']}")
            # ACT: 无 Bun.Transpiler 等价物，安装侧不做 TS 语法校验；坏源码由发布侧 sync.py 门禁拦截。
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(source, encoding="utf-8")
            report("Toonflow/供应商", provider["name"], "覆盖安装" if force else "安装", provider.get("version"))
        for tool in manifest.get("tools", []):
            target = dataDir / "tools" / Path(tool["file"]).name
            local = ""
            if target.exists():
                match = re.search(r'"version":\s*"([^"]+)"', target.read_text(encoding="utf-8"))
                local = match.group(1) if match else ""
            if not force and local and local == tool.get("version"):
                report("Toonflow/工具", tool["name"], "跳过", f"已同版本 {local}")
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(fetchText(f"{mirror}/{tool['file']}"), encoding="utf-8")
            report("Toonflow/工具", tool["name"], "覆盖安装" if force else "安装", tool.get("version"))

    if not options.get("hostsOnly"):
        installToonflowSide()
    if not options.get("toonflowOnly"):
        installHostSkills()
    summary = {"installed": 0, "skipped": 0, "failed": 0}
    for entry in installed:
        if entry["action"] == "跳过":
            summary["skipped"] += 1
        elif entry["action"] == "失败":
            summary["failed"] += 1
        else:
            summary["installed"] += 1
    failedText = f"、失败 {summary['failed']}" if summary["failed"] else ""
    print(f"\n完成：安装 {summary['installed']}、跳过 {summary['skipped']}{failedText}")
    print("技能已装入你的技能目录（新会话或刷新技能列表后可原生发现 toonflowCli / canvasOperation）")
    return 5 if summary["failed"] else 0
