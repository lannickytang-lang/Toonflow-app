#!/usr/bin/env python3
"""tdd —— Toonflow headless 画布生产 CLI（与 MCP 同语义同后端）。

用法: tdd [全局选项] <组> <命令> [参数]
全局: --json 结构化输出 | -w, --workspace <目录>（或环境变量 TOONFLOW_WORKSPACE）| --canvas <画布id> | --server <url>
"""
import sys

import click

from cli_tdd.toonflow.core import canvas as canvasModule
from cli_tdd.toonflow.core import configProject, install, node as nodeModule, queue as queueModule
from cli_tdd.toonflow.core.client import CliError
from cli_tdd.toonflow.core.install import cliVersion

@click.group(invoke_without_command=True)
@click.version_option(version=cliVersion(), prog_name="tdd", message="tdd 版本 %(version)s")
@click.option("--json", "use_json", is_flag=True, help="结构化输出")
@click.option("-w", "--workspace", default=None, help="工作区绝对目录（或环境变量 TOONFLOW_WORKSPACE）")
@click.option("--canvas", "canvas_id", default=None,
              help="画布 id（如 画布2.json，省略 .json 自动补全；省略时用第一块；queue 的 submit/status/export 支持逗号分隔多块）")
@click.option("--server", "server_url", default=None, help="server 地址（默认 http://127.0.0.1:3000）")
@click.pass_context
def cli(ctx, use_json, workspace, canvas_id, server_url):
    """tdd —— Toonflow headless 画布生产：导入分镜、批量生成、挂机监控、失败排查与断点重建。

    \b
    退出码: 0 成功 | 2 参数/请求错误 | 3 画布版本冲突(先 canvas get 重读)
    | 4 目标不存在 | 5 有失败任务 | 6 server 未运行

    \b
    典型挂机流程:
    export TOONFLOW_WORKSPACE="D:/prod/demo"
    tdd canvas import storyboard.json --auto-submit
    tdd queue status --watch --interval 60 || true
    tdd queue export --format md --output 清单.md --verify
    """
    from cli_tdd.toonflow.core import client
    if server_url:
        client.serverOverride = server_url
    ctx.obj = {"json": use_json, "workspace": workspace, "canvas": canvas_id}
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


# ---- 单命令 ----


@cli.command("status")
@click.pass_obj
def cmdStatus(obj):
    """自检：server 连接 / 项目数 / 当前工作区。"""
    configProject.cmdStatus(obj)


@cli.command("models")
@click.option("--type", "type_filter", type=click.Choice(["image", "video"]), default=None, help="按类型过滤")
@click.pass_obj
def cmdModels(obj, type_filter):
    """可用模型清单（providerId/modelId 供 import 与 node set 用）。"""
    configProject.cmdModels(obj, type_filter)


@cli.command("install")
@click.option("--hosts", default=None, help="显式指定宿主技能目录（逗号分隔；缺省自动探测）")
@click.option("--force", is_flag=True, help="覆盖重装")
@click.option("--mirror", default=None, help="分发中心基址")
@click.option("--toonflow-only", "toonflow_only", is_flag=True, help="只装 Toonflow 侧插件")
@click.option("--hosts-only", "hosts_only", is_flag=True, help="只装宿主技能")
@click.pass_obj
def cmdInstall(obj, hosts, force, mirror, toonflow_only, hosts_only):
    """一键安装：宿主技能 + Toonflow 侧插件（幂等，秒级）。"""
    try:
        sys.exit(install.runInstall({
            "hosts": hosts, "force": force, "mirror": mirror,
            "toonflowOnly": toonflow_only, "hostsOnly": hosts_only}))
    except Exception as error:  # noqa: BLE001（安装器统一报错并给自愈提示）
        click.echo(f"error: {error}", err=True)
        click.echo(f"hint: 检查网络与镜像地址（--mirror），默认 {install.defaultMirror}", err=True)
        sys.exit(2)


@cli.command("update")
@click.option("--version", "target_version", default=None, help="安装指定版本（可降级，如 1.0.3）")
@click.option("--check", "check_only", is_flag=True, help="干跑：只输出当前/远端版本对比，不安装（网络失败不阻塞）")
@click.option("--list", "list_versions", is_flag=True, help="列出全部历史版本与说明后退出")
@click.option("--mirror", default=None, help="分发中心基址")
def cmdUpdate(target_version, check_only, list_versions, mirror):
    """升级 CLI 到最新版；--check 只查不装；--version 装指定历史版本；--list 看版本历史。"""
    try:
        if list_versions:
            sys.exit(install.runUpdateList(mirror or install.defaultMirror))
        sys.exit(install.runUpdate(mirror or install.defaultMirror, target_version, check_only))
    except Exception as error:  # noqa: BLE001（更新器统一报错并给自愈提示）
        click.echo(f"error: {error}", err=True)
        click.echo(f"hint: 检查网络与镜像地址（--mirror），默认 {install.defaultMirror}", err=True)
        sys.exit(2)


# ---- config / project ----


@cli.group(invoke_without_command=True)
@click.pass_context
def config(ctx):
    """配置读写：get/set 点路径（供应商凭证如 mediaProviderConfigs.grsai.ts）。"""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@config.command("get")
@click.argument("key")
@click.pass_obj
def cmdConfigGet(obj, key):
    """读设置，如 mediaProviderConfigs.grsai。"""
    configProject.cmdConfigGet(obj, key)


@config.command("set")
@click.argument("key")
@click.argument("value")
@click.pass_obj
def cmdConfigSet(obj, key, value):
    """写设置，如 mediaProviderConfigs.grsai.ts <apiKey>。"""
    configProject.cmdConfigSet(obj, key, value)


@cli.group(invoke_without_command=True)
@click.pass_context
def project(ctx):
    """工作区：list 项目清单 · open 打开/创建并记住为默认。"""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@project.command("list")
@click.pass_obj
def cmdProjectList(obj):
    """项目清单。"""
    configProject.cmdProjectList(obj)


@project.command("open")
@click.argument("directory")
@click.pass_obj
def cmdProjectOpen(obj, directory):
    """打开工作区（不存在自动创建；记住为默认，后续可省略 -w）。"""
    configProject.cmdProjectOpen(obj, directory)


# ---- canvas ----


@cli.group(invoke_without_command=True)
@click.pass_context
def canvas(ctx):
    """画布：create 新建 · import 导入分镜建图（--new-canvas 建新画布） · list/get 现状 · report 体检排障 · fit 视口适配截图。"""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@canvas.command("list")
@click.pass_obj
def cmdCanvasList(obj):
    """画布清单。"""
    canvasModule.cmdCanvasList(obj)


@canvas.command("get")
@click.option("--nodes", "with_nodes", is_flag=True, help="附节点表（前 50）")
@click.pass_obj
def cmdCanvasGet(obj, with_nodes):
    """画布摘要（节点类型与生成状态计数）。"""
    canvasModule.cmdCanvasGet(obj, with_nodes)


@canvas.command("create")
@click.argument("name", required=False)
@click.pass_obj
def cmdCanvasCreate(obj, name):
    """新建空画布（NAME 缺省自动编号画布N）。"""
    canvasModule.cmdCanvasCreate(obj, name)


@canvas.command("import")
@click.argument("file", required=False)
@click.option("--auto-submit", "auto_submit", is_flag=True, help="导入后立即提交队列")
@click.option("--new-canvas", "new_canvas", is_flag=False, flag_value="", default=None,
              help="导入到全新画布（可带名称，缺省自动编号）")
@click.option("--check", "check_only", is_flag=True, help="干跑：只比对分镜与存量的差异，不修改画布")
@click.option("--force-add", "force_add", is_flag=True, help="同名不一致时仍追加新节点（默认跳过并报告差异）")
@click.option("--schema", "schema_only", is_flag=True, help="打印示例 JSON 后退出")
@click.pass_obj
def cmdCanvasImport(obj, file, auto_submit, new_canvas, check_only, force_add, schema_only):
    """导入分镜一次建图（幂等：与存量一致的资产/分镜自动跳重）。"""
    if schema_only:
        click.echo(canvasModule.importSchemaExample)
        return
    canvasModule.cmdCanvasImport(obj, file, auto_submit, new_canvas, check_only, force_add)


@canvas.command("report")
@click.option("--explain", is_flag=True, help="打印画布 JSON 字段说明后退出")
@click.pass_obj
def cmdCanvasReport(obj, explain):
    """画布体检：拓扑/节点现状/异常检测（产物落盘实测）。"""
    if explain:
        click.echo(canvasModule.canvasFieldGuide)
        return
    canvasModule.cmdCanvasReport(obj, obj.get("canvas"))


@canvas.command("fit")
@click.option("--nodes", "nodes_argument", default=None, help="聚焦节点 id/label 列表（逗号分隔）")
@click.pass_obj
def cmdCanvasFit(obj, nodes_argument):
    """让已打开页面适配视口（配合浏览器截图排查）。"""
    canvasModule.cmdCanvasFit(obj, nodes_argument)


# ---- node ----


@cli.group(invoke_without_command=True)
@click.pass_context
def node(ctx):
    """节点：list/get 查询 · set 改提示词/模型/参数 · cast 整组换出镜资产。"""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@node.command("list")
@click.option("--type", "type_filter", default=None, help="按类型过滤（如 imageGeneration）")
@click.option("--status", "status_filter", default=None, help="按生成状态过滤（如 failed）")
@click.pass_obj
def cmdNodeList(obj, type_filter, status_filter):
    """节点表（label/类型/状态）。"""
    nodeModule.cmdNodeList(obj, type_filter, status_filter)


@node.command("get")
@click.argument("node_id")
@click.pass_obj
def cmdNodeGet(obj, node_id):
    """节点详情（含 data 全量）；NODE_ID 支持 id 前缀或 label。"""
    nodeModule.cmdNodeGet(obj, node_id)


@node.command("set")
@click.argument("node_id")
@click.option("--prompt", default=None, help="生成提示词")
@click.option("--model", default=None, help="模型 providerId/modelId")
@click.option("--duration", type=int, default=None, help="视频时长秒（仅视频节点）")
@click.option("--resolution", default=None, help="视频分辨率（仅视频节点）")
@click.option("--ratio", default=None, help="画面比例")
@click.option("--size", default=None, help="图片尺寸")
@click.pass_obj
def cmdNodeSet(obj, node_id, prompt, model, duration, resolution, ratio, size):
    """修改节点提示词/模型/参数。"""
    nodeModule.cmdNodeSet(obj, node_id, prompt, model, duration, resolution, ratio, size)


@node.command("cast")
@click.argument("node_id")
@click.option("--assets", required=True, help="资产 id/label 列表（逗号分隔），整组替换出镜连线")
@click.pass_obj
def cmdNodeCast(obj, node_id, assets):
    """整组替换分镜的出镜连线。"""
    nodeModule.cmdNodeCast(obj, node_id, assets)


# ---- queue ----


@cli.group(invoke_without_command=True)
@click.pass_context
def queue(ctx):
    """队列：submit 入队 · status --watch 挂机 · logs/retry 排障重提 · export 交付清单（--canvas 可逗号分隔多块）。"""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@queue.command("submit")
@click.option("--scope", type=click.Choice(["missing", "all"]), default="missing",
              help="missing=只补未完成（断点重建）| all=全部")
@click.option("--nodes", "nodes_argument", default=None, help="指定节点 id 列表（逗号分隔）")
@click.option("--concurrency", type=int, default=None, help="并发上限")
@click.pass_obj
def cmdQueueSubmit(obj, scope, nodes_argument, concurrency):
    """批量入队（默认 missing=只补未完成，重启后重建就重跑本命令）。"""
    queueModule.cmdQueueSubmit(obj, scope, nodes_argument, concurrency)


@queue.command("status")
@click.option("--watch", is_flag=True, help="挂机轮询到终态（有失败退出码 5）")
@click.option("--interval", type=int, default=30, help="轮询间隔秒（配合 --watch）")
@click.pass_obj
def cmdQueueStatus(obj, watch, interval):
    """队列状态；--watch 挂机到终态。"""
    queueModule.cmdQueueStatus(obj, watch, interval)


@queue.command("logs")
@click.argument("task_id")
@click.option("--tail", type=int, default=20, help="只显示最后 N 条")
@click.pass_obj
def cmdQueueLogs(obj, task_id, tail):
    """任务日志与失败原因原文。"""
    queueModule.cmdQueueLogs(obj, task_id, tail)


@queue.command("retry")
@click.argument("node_ids", nargs=-1)
@click.option("--set", "set_file", default=None, help="修改 JSON 文件路径（如 {\"prompt\":\"…\"}）")
@click.pass_obj
def cmdQueueRetry(obj, node_ids, set_file):
    """按修改重提：NODE_IDS 一个或多个节点 id。"""
    queueModule.cmdQueueRetry(obj, list(node_ids), set_file)


@queue.command("cancel")
@click.argument("target", required=False)
@click.option("--all", "cancel_all", is_flag=True, help="取消全部任务")
@click.pass_obj
def cmdQueueCancel(obj, target, cancel_all):
    """取消任务（taskId 或 nodeId，或 --all）。"""
    queueModule.cmdQueueCancel(obj, target, cancel_all)


@queue.command("export")
@click.option("--format", "format_name", type=click.Choice(["md", "json", "csv"]), default="md", help="输出格式")
@click.option("--output", default=None, help="写入文件路径")
@click.option("--verify", is_flag=True, help="校验产物文件落盘（缺失退出码 5）")
@click.pass_obj
def cmdQueueExport(obj, format_name, output, verify):
    """产物路径清单（分镜 × 产物表格）。"""
    queueModule.cmdQueueExport(obj, format_name, output, verify)


# ---- 入口 ----


def main():
    try:
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (AttributeError, OSError):
                pass
        # 首命令自动安装宿主技能（幂等标记，stderr 提示不污染 --json；install/update 自管故跳过）。
        firstPositional = next((argument for argument in sys.argv[1:] if not argument.startswith("-")), None)
        if firstPositional not in ("install", "update"):
            install.autoInstallSkill()
        cli(standalone_mode=False)
    except CliError as error:
        click.echo(f"error: {error.message}", err=True)
        if error.hint:
            click.echo(f"hint: {error.hint}", err=True)
        sys.exit(error.code)
    except click.exceptions.Exit as error:
        sys.exit(error.exit_code)
    except click.exceptions.UsageError as error:
        message = error.format_message()
        click.echo(f"error: {message}", err=True)
        if any(token in message for token in ("-w", "--workspace", "--canvas", "--json", "--server")):
            click.echo("hint: 全局选项（-w / --canvas / --json / --server）必须写在子命令之前，"
                       "如 tdd --json -w <目录> queue status", err=True)
        else:
            click.echo("hint: 运行 tdd --help 查看全部命令（全局选项写在子命令之前）", err=True)
        sys.exit(2)
    except click.ClickException as error:
        error.show()
        sys.exit(2)


if __name__ == "__main__":
    main()
