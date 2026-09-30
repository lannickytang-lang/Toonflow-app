#!/usr/bin/env python3
"""发布自检门禁：三层检查全部通过才允许打包发布（由 tudodo-center/scripts/sync.py --publish 调用）。

层1 静态（语法/元数据）→ 层2 离线命令级（help 全树/参数契约/纯函数）→ 层3 真实场景冒烟（需 dev server + mockProvider）。
用法：python selfcheck.py [--server http://127.0.0.1:3000] [--offline]
退出码：0 全部通过；1 存在失败项。
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HARNESS = Path(__file__).resolve().parent
sys.path.insert(0, str(HARNESS))
DEFAULT_SERVER = "http://127.0.0.1:3000"

passedCount = 0
failedCount = 0


def check(name, ok, detail=""):
    global passedCount, failedCount
    print(f"[{'pass' if ok else 'FAIL'}] {name}" + (f"：{detail}" if detail and not ok else ""))
    if ok:
        passedCount += 1
    else:
        failedCount += 1


def runTdd(args, server=None, timeout=90):
    env = dict(os.environ)
    if server:
        env["TOONFLOW_SERVER"] = server
    return subprocess.run([sys.executable, "-m", "cli_tdd.toonflow", *args],
                          cwd=str(HARNESS), capture_output=True, text=True,
                          encoding="utf-8", env=env, timeout=timeout)


# ---- 层 1：静态 ----


def layerStatic():
    print("── 层1 静态检查")
    for py in sorted(HARNESS.rglob("*.py")):
        if {".egg-info", "__pycache__"} & set(py.relative_to(HARNESS).parts):
            continue
        try:
            compile(py.read_text(encoding="utf-8"), str(py), "exec")
        except SyntaxError as error:
            check(f"语法编译 {py.name}", False, str(error))
            return
    check("全部 .py 语法编译", True)
    setupText = (HARNESS / "setup.py").read_text(encoding="utf-8")
    check("包名约定", 'name="cli-tdd-toonflow"' in setupText)
    version = re.search(r'version="([^"]+)"', setupText)
    check("版本可解析", bool(version))
    check("入口约定", "tdd=cli_tdd.toonflow.toonflow_cli:main" in setupText)
    skillRoot = HARNESS / "cli_tdd/toonflow/skills"
    skillText = (skillRoot / "SKILL.md").read_text(encoding="utf-8")
    skillLines = len(skillText.splitlines())
    check("技能 SKILL.md 精简（≤160 行）", skillLines <= 160, f"当前 {skillLines} 行")
    check("技能意图路由与自学/源码节（/tdd 入口）",
          "按意图路由" in skillText and "自学能力" in skillText and "server 能力与源码" in skillText and "任务收尾" in skillText)
    check("能力清单 api.md 随技能分发", (skillRoot / "references/api.md").is_file()
          and "画布操作能力清单" in (skillRoot / "references/api.md").read_text(encoding="utf-8"))
    check("技能渐进式结构", all((skillRoot / name).is_file() for name in
          ("references/environment.md", "references/commands.md", "references/errors.md")))
    scenarioFiles = list((skillRoot / "references/scenarios").glob("*.md"))
    check("技能场景文件齐全（≥8）", len(scenarioFiles) >= 8, f"当前 {len(scenarioFiles)} 个")
    if version:
        changelog = (HARNESS / "CHANGELOG.md").read_text(encoding="utf-8")
        check(f"CHANGELOG 含 {version.group(1)} 段",
              bool(re.search(rf"## {re.escape(version.group(1))}\n", changelog)))


# ---- 层 2：离线命令级 ----

commandTree = {
    "canvas": ["fit", "get", "import", "list", "report"],
    "config": ["get", "set"],
    "node": ["cast", "get", "list", "set"],
    "project": ["list", "open"],
    "queue": ["cancel", "export", "logs", "retry", "status", "submit"],
}
singleCommands = ["status", "models", "install", "update"]

contractKeywords = [
    (["--help"], ["--workspace", "--canvas", "--json"]),
    (["canvas", "import", "--help"], ["--schema", "--auto-submit", "--new-canvas"]),
    (["canvas", "create", "--help"], ["自动编号"]),
    (["canvas", "fit", "--help"], ["--nodes"]),
    (["canvas", "report", "--help"], ["--explain"]),
    (["node", "set", "--help"], ["--prompt", "--model", "--duration", "--resolution", "--ratio", "--size"]),
    (["node", "cast", "--help"], ["--assets"]),
    (["queue", "submit", "--help"], ["--scope", "--nodes", "--concurrency"]),
    (["queue", "status", "--help"], ["--watch", "--interval"]),
    (["queue", "retry", "--help"], ["--set"]),
    (["queue", "export", "--help"], ["--format", "--output", "--verify"]),
    (["update", "--help"], ["--version", "--list", "--check", "--mirror"]),
]


def layerOffline():
    print("── 层2 离线命令级")
    result = runTdd(["--help"])
    check("根 help", result.returncode == 0 and "典型挂机流程" in result.stdout)
    for group, subs in commandTree.items():
        groupHelp = runTdd([group, "--help"])
        check(f"组 help {group}", groupHelp.returncode == 0)
        bare = runTdd([group])
        check(f"组无参展示 help {group}", bare.returncode == 0 and "Usage" in bare.stdout)
        for sub in subs:
            subHelp = runTdd([group, sub, "--help"])
            check(f"子命令 help {group} {sub}", subHelp.returncode == 0)
    for command in singleCommands:
        check(f"单命令 help {command}", runTdd([command, "--help"]).returncode == 0)
    for args, keywords in contractKeywords:
        text = runTdd(args).stdout
        missing = [keyword for keyword in keywords if keyword not in text]
        check(f"参数契约 {' '.join(args[:2])}", not missing, f"缺少 {missing}")
    check("未知命令退出码 2", runTdd(["badcmd"]).returncode == 2)
    check("server 不可达退出码 6", runTdd(["--server", "http://127.0.0.1:1", "status"], timeout=20).returncode == 6)

    from cli_tdd.toonflow.core.canvas import importSchemaExample, validateStoryboard
    from cli_tdd.toonflow.core.client import CliError, cliRoot
    from cli_tdd.toonflow.core.configProject import coerceValue
    from cli_tdd.toonflow.core.install import versionTuple
    check("versionTuple 比较", versionTuple("1.0.10") > versionTuple("1.0.9") and versionTuple("x") is None)
    check("coerceValue 类型推断",
          coerceValue("false") is False and coerceValue("42") == 42 and coerceValue("abc") == "abc")
    good = {"assets": [{"name": "主角", "imagePrompt": "写实"}],
            "scenes": [{"sortNum": 1, "videoPrompt": "微笑", "cast": ["主角"]}],
            "options": {"imageModel": {"providerId": "m", "modelId": "i"}}}
    try:
        validateStoryboard(good)
        check("validateStoryboard 合法通过", True)
    except CliError as error:
        check("validateStoryboard 合法通过", False, str(error))
    rejected = False
    try:
        validateStoryboard({"wrong": 1})
    except CliError:
        rejected = True
    check("validateStoryboard 非法拒绝", rejected)
    check("--schema 示例完整", all(k in importSchemaExample for k in ("assets", "scenes", "options", "字段说明")))
    root = cliRoot()
    if root:
        genScript = root / "scripts/genApiDoc.ts"
        import shutil as shutilModule
        bun = shutilModule.which("bun")
        if not bun:
            check("api.md 与 runtime.ts 无漂移", False, "未找到 bun，无法校验能力清单")
        else:
            result = subprocess.run([bun, str(genScript), "--check"], capture_output=True, text=True,
                                    cwd=str(root), timeout=60)
            check("api.md 与 runtime.ts 无漂移", result.returncode == 0,
                  (result.stderr or result.stdout or "").strip()[:200])
    check("cliRoot 源码态命中", root is not None and (root / "package.json").exists())


# ---- 层 3：真实场景冒烟 ----


def layerServer(server):
    print(f"── 层3 真实场景冒烟（{server}）")
    from cli_tdd.toonflow.core.client import cliRoot
    workspace = Path(tempfile.mkdtemp(prefix="tddSelfcheck")).as_posix()
    cacheFile = None
    cacheBackup = None
    try:
        root = cliRoot()
        if root:
            cacheFile = root / "data" / "tddWorkspace.txt"
            cacheBackup = cacheFile.read_bytes() if cacheFile.exists() else None

        def tdd(args, **kwargs):
            # -w 是全局选项，必须前置（后置会被 Click 拒绝）。
            return runTdd(["-w", workspace, *args], server=server, **kwargs)

        result = runTdd(["status"], server=server)
        check("status 在线", result.returncode == 0 and "在线" in result.stdout)
        result = runTdd(["models"], server=server)
        check("models 含 mockProvider", result.returncode == 0 and "mockProvider/mockImage" in result.stdout)
        result = tdd(["project", "open", workspace])
        check("project open", result.returncode == 0 and "工作区就绪" in result.stdout)
        result = runTdd(["status"], server=server)
        check("工作区记忆生效", "默认工作区(已记住)" in result.stdout)

        storyboard = {"assets": [{"name": "主角", "imagePrompt": "写实人像，9:16"},
                                 {"name": "街道", "imagePrompt": "夜晚街道"}],
                      "scenes": [{"sortNum": 1, "videoPrompt": "主角走过街道", "cast": ["主角", "街道"], "duration": 2},
                                 {"sortNum": 2, "videoPrompt": "主角回头", "cast": ["主角"], "duration": 3}],
                      "options": {"imageModel": {"providerId": "mockProvider", "modelId": "mockImage"},
                                  "videoModel": {"providerId": "mockProvider", "modelId": "mockVideo"}}}
        storyboardPath = Path(workspace) / "storyboard.json"
        storyboardPath.write_text(json.dumps(storyboard, ensure_ascii=False), encoding="utf-8")
        result = tdd(["canvas", "import", str(storyboardPath), "--auto-submit"], timeout=120)
        check("canvas import 建图", result.returncode == 0 and "导入成功: 新增资产 2 / 新增分镜 2" in result.stdout)
        result = tdd(["queue", "status", "--watch", "--interval", "2"], timeout=180)
        check("queue watch 全成功",
              result.returncode == 0 and "成功 4" in result.stdout and "失败 0" in result.stdout)
        result = tdd(["canvas", "report"])
        check("canvas report 健康", result.returncode == 0 and "异常 0" in result.stdout)
        check("node list", tdd(["node", "list"]).returncode == 0)
        result = tdd(["node", "set", "分镜1", "--prompt", "冒烟修改后的提示词"])
        check("node set（label 解析）", result.returncode == 0 and "已更新 分镜1" in result.stdout)
        result = tdd(["--json", "node", "get", "分镜1"])
        check("node get --json 含修改", "冒烟修改后的提示词" in result.stdout)
        result = tdd(["node", "cast", "分镜1", "--assets", "主角"])
        check("node cast 整组替换", result.returncode == 0 and "已替换为 1 个资产" in result.stdout)
        result = tdd(["queue", "retry", "分镜1"], timeout=120)
        check("queue retry（label 解析）", result.returncode == 0 and "已重新提交 1 个" in result.stdout)
        tdd(["queue", "status", "--watch", "--interval", "2"], timeout=180)
        manifest = str(Path(workspace) / "清单.md")
        result = tdd(["queue", "export", "--format", "md", "--output", manifest, "--verify"])
        check("queue export --verify", result.returncode == 0 and "全部产物文件在盘" in result.stdout
              and Path(manifest).exists())
        check("错误节点退出码 4", tdd(["node", "get", "__no_such__"]).returncode == 4)
        check("画布冲突类退出码 3（fit 无页面）", tdd(["canvas", "fit"]).returncode == 3)
        # 画布生命周期断言放在交付之后：追加/新建产生的未生成节点不能破坏 export --verify 前提。
        result = tdd(["canvas", "import", str(storyboardPath)])
        # 幂等重导发生在 node set 改过分镜1 之后：分镜1 差异跳过，其余一致跳过，总新增为 0。
        check("import 幂等重导零新增", result.returncode == 0 and "新增资产 0 / 新增分镜 0" in result.stdout
              and "跳过 3（与存量一致）" in result.stdout and "差异 1（默认跳过）" in result.stdout)
        variantPath = Path(workspace) / "storyboardVariant.json"
        variant = {**storyboard, "scenes": [{**scene, "videoPrompt": "冒烟变体提示词"} for scene in storyboard["scenes"]]}
        variantPath.write_text(json.dumps(variant, ensure_ascii=False), encoding="utf-8")
        result = tdd(["canvas", "import", str(variantPath), "--check"])
        check("import --check 差异报告", result.returncode == 0 and "比对报告" in result.stdout and "提示词不同" in result.stdout)
        result = tdd(["canvas", "import", str(variantPath)])
        check("冲突默认跳过不导入", result.returncode == 0 and "差异 2（默认跳过）" in result.stdout)
        result = tdd(["canvas", "report"])
        check("report 参数列", result.returncode == 0 and "2s/" in result.stdout)
        result = tdd(["canvas", "create", "自检画布"])
        check("canvas create 指定名", result.returncode == 0 and "画布已创建: 自检画布.json" in result.stdout)
        result = tdd(["canvas", "create", "自检画布"])
        import re as reModule
        check("同名 create 自动时间戳", result.returncode == 0
              and reModule.search(r"自检画布-\d{14}\.json", result.stdout) is not None)
        result = tdd(["canvas", "import", str(storyboardPath), "--new-canvas"])
        check("import --new-canvas 自动编号", result.returncode == 0 and "新建画布: 画布2.json" in result.stdout)
        check("--canvas 后缀自动补全", tdd(["--canvas", "自检画布", "node", "list"]).returncode == 0)
        check("多画布 queue status", tdd(["--canvas", "画布1,画布2", "queue", "status"]).returncode == 0)
        result = tdd(["--canvas", "画布1.json,画布2.json", "queue", "export", "--format", "md", "--output", str(Path(workspace) / "多画布清单.md")])
        multiContent = Path(workspace).joinpath("多画布清单.md")
        check("多画布 export 含画布列", result.returncode == 0 and multiContent.exists()
              and "| 画布 |" in multiContent.read_text(encoding="utf-8"))
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
        if cacheFile is not None:
            if cacheBackup is None:
                cacheFile.unlink(missing_ok=True)
            else:
                cacheFile.write_bytes(cacheBackup)


def main():
    server = DEFAULT_SERVER
    offline = "--offline" in sys.argv
    for index, argument in enumerate(sys.argv):
        if argument == "--server" and index + 1 < len(sys.argv):
            server = sys.argv[index + 1]
    layerStatic()
    layerOffline()
    if not offline:
        layerServer(server)
    else:
        print("── 层3 跳过（--offline）")
    print(f"\n自检结果：通过 {passedCount}、失败 {failedCount}")
    return 1 if failedCount else 0


if __name__ == "__main__":
    sys.exit(main())
