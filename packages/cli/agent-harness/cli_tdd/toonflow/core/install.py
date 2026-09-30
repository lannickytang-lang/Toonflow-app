"""一键安装（零参数）：
1. 自动探测本机 agent 宿主（claude/codex/zcode/agents 等）技能目录，装入 canvasOperation / tdd 技能
   （tdd 技能为 toonflowCli 的继任者，同时清理宿主里的旧 toonflowCli 目录）；
2. 从分发中心（tudodo-center）全量拉取 Toonflow 侧插件（技能/供应商/工具），版本一致自动跳过。
tdd update 的自更新逻辑也在此（cliVersion/runUpdate）。
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import sysconfig
import tempfile
import urllib.error
import urllib.request
import zipfile
from importlib import metadata
from pathlib import Path

from .client import cliRoot, dataDirectory

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
            # tdd 技能继任 toonflowCli：顺手清理宿主里的旧目录，避免双技能并存误导。
            legacy = Path(host["skillsDirectory"]) / "toonflowCli"
            if legacy.exists():
                shutil.rmtree(legacy, ignore_errors=True)
                print("[清理] 宿主/%s/toonflowCli（已由 tdd 技能继任）" % host["id"])
            for name in ("canvasOperation", "tdd"):
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
    print("技能已装入你的技能目录（新会话或刷新技能列表后可原生发现 tdd / canvasOperation；"
          "当次会话未自动加载时，直接读技能目录下的 tdd/SKILL.md 即可）")
    return 5 if summary["failed"] else 0


# ---- tdd update：CLI 自更新 ----

packageName = "cli-tdd-toonflow"


def cliVersion():
    try:
        return metadata.version(packageName)
    except metadata.PackageNotFoundError:
        return "0.0.0"


def versionTuple(text):
    try:
        return tuple(int(part) for part in str(text).split("."))
    except ValueError:
        return None


def tddScriptDir():
    """tdd 入口脚本实际所在目录（找不到返回 None）。venv 下与 python.exe 同目录，
    系统 python 在 sysconfig 的 scripts 目录（与 _scriptExeCandidates 同口径）。"""
    candidates = []
    if sys.prefix != sys.base_prefix:
        candidates.append(Path(sys.executable).parent)
    candidates.append(Path(sysconfig.get_path("scripts")))
    executable = "tdd.exe" if sys.platform == "win32" else "tdd"
    for directory in candidates:
        if (directory / executable).exists():
            return str(directory)
    return None


def _scriptExeCandidates():
    """console_scripts 的 tdd.exe 位置候选：venv 下与 python.exe 同目录（sysconfig 会错误指向
    基础环境的 Scripts），系统 python 在 sysconfig 的 scripts 目录。"""
    return [Path(sys.executable).parent / "tdd.exe",
            Path(sysconfig.get_path("scripts")) / "tdd.exe"]


def _scriptDirs():
    return {str(candidate.parent) for candidate in _scriptExeCandidates()}


def _unlockScriptExe():
    """Windows：正在运行的 tdd.exe 无法被 pip 覆盖（WinError 32 必现），改名让路——
    运行中的 exe 不能写/删但可以 rename（Chrome/VSCode 自更新同法）。"""
    if sys.platform != "win32":
        return
    for exePath in _scriptExeCandidates():
        if not exePath.exists():
            continue
        stale = exePath.with_name("tdd.exe.old")
        if stale.exists():
            try:
                stale.unlink()
            except OSError:
                stale = exePath.with_name(f"tdd-{os.getpid()}.exe.old")
        try:
            exePath.rename(stale)
        except OSError:
            pass  # 常见于 Git Bash/MSYS 持句柄：rename 也不放行，走延迟安装兜底


def _cleanStaleExe():
    for directory in _scriptDirs():
        for stale in Path(directory).glob("tdd*.exe.old"):
            try:
                stale.unlink()
            except OSError:
                pass  # 旧进程仍锁着则留待下次清理


def runUpdateList(mirror):
    """列出中心全部历史版本与说明（读 versions.json）。返回退出码。"""
    versions = json.loads(fetchText(f"{mirror}/dist/cli/versions.json")).get("versions") or []
    if not versions:
        print(f"中心无版本记录（{mirror}）")
        return 0
    for entry in versions:
        date = f"（{entry.get('date')}）" if entry.get("date") else ""
        print(f"{entry.get('version')}{date}")
        for line in (entry.get("notes") or "").splitlines():
            if line.strip():
                print(f"  {line.strip()}")
    return 0


def runUpdate(mirror, targetVersion, checkOnly=False):
    """CLI 自更新。返回退出码：0 成功或已是最新 / 2 失败。
    targetVersion 指定时跳过比对直接安装（可降级）；checkOnly 干跑：只输出当前/远端版本对比，
    网络失败不阻塞（退 0 提示继续用当前版本）。"""
    root = cliRoot()
    if root is not None and (root / "package.json").exists():
        print(f"检测到源码/开发环境运行（当前 {cliVersion()}），跳过自更新")
        print("开发环境更新方式：git pull 后 python -m pip install -e . --force-reinstall")
        return 0
    current = cliVersion()
    if checkOnly:
        try:
            entry = (json.loads(fetchText(f"{mirror}/manifest.json")).get("cli") or [{}])[0]
            remoteVersion = str(entry.get("version") or "")
        except Exception as error:  # noqa: BLE001（检查更新是尽力而为，网络失败不阻塞任务）
            print(f"检查更新失败（{error}），继续使用当前版本 {current}")
            return 0
        currentTuple, remoteTuple = versionTuple(current), versionTuple(remoteVersion)
        if currentTuple and remoteTuple and currentTuple >= remoteTuple:
            print(f"已是最新版本 {current}（远端 {remoteVersion}）")
        else:
            print(f"当前 {current} → 远端 {remoteVersion}（有新版本：经用户确认后执行 tdd update 升级）")
        return 0
    if targetVersion:
        remoteVersion = targetVersion
        zipUrl = f"{mirror}/dist/cli/{targetVersion}/cli-tdd-toonflow.zip"
    else:
        entry = (json.loads(fetchText(f"{mirror}/manifest.json")).get("cli") or [{}])[0]
        remoteVersion = str(entry.get("version") or "")
        zipUrl = f"{mirror}/{entry.get('file')}"
        currentTuple, remoteTuple = versionTuple(current), versionTuple(remoteVersion)
        if currentTuple and remoteTuple and currentTuple >= remoteTuple:
            print(f"已是最新版本 {current}（远端 {remoteVersion}）")
            return 0
    zipPath = Path(tempfile.gettempdir()) / f"cli-tdd-toonflow-{remoteVersion}.zip"
    try:
        zipPath.write_bytes(fetchBinary(zipUrl))
    except RuntimeError as error:
        print(f"error: {error}")
        print("hint: 先 tdd update --list 查看可用版本后重试")
        return 2
    _unlockScriptExe()
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "--force-reinstall", "--no-deps", str(zipPath)],
        capture_output=True, text=True)
    if result.returncode != 0 and sys.platform == "win32":
        # Windows 常态：运行中的 tdd.exe 无法被覆盖（Git Bash/MSYS 持句柄时 rename 也不放行）。
        # 交由独立进程延迟安装——等本进程退出（约 1.5s）解锁后 pip 覆盖，下次命令即新版本。
        # ACT 上限：异步无回传，失败只能靠 tdd --version 验证发现。
        script = ("import subprocess,sys,time;time.sleep(1.5);raise SystemExit(subprocess.run("
                  f"[sys.executable,'-m','pip','install','--force-reinstall','--no-deps',{str(zipPath)!r}]).returncode)")
        subprocess.Popen(
            [sys.executable, "-c", script],
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"已更新 {current} → {remoteVersion}：后台安装中（约 5 秒完成），稍后用 tdd --version 验证")
        return 0
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()[-500:]
        print(f"error: pip 安装失败：{detail}")
        print(f"hint: 退出当前会话后手动执行：{sys.executable} -m pip install --force-reinstall --no-deps {zipPath}")
        return 2
    _cleanStaleExe()
    print(f"已更新 {current} → {remoteVersion}（新版本下次命令生效）")
    return 0
