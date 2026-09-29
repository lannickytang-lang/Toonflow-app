#!/usr/bin/env bun
// Toonflow CLI：与 MCP 同语义同后端的命令行门面（headless 画布生产）。
// 规范：--help 自发现（含示例）、--json 结构化输出、退出码语义（0 成功/2 参数/3 冲突/4 不存在/5 有失败任务/6 server 未运行）、报错带 hint。
// 用法：<启动器> <命令组> <命令> [参数]（源码 bun scripts/toonflow.ts / 桌面 toonflow-cli.exe）；工作区用 -w 或环境变量 TOONFLOW_WORKSPACE。

import { dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runInstall } from "./installExtensions.ts";

// CLI 根目录：源码模式为仓库根（scripts/..）；编译版（bun --compile）用 exe 所在目录（桌面安装根）。
function cliRoot() {
  const sourceRoot = join(import.meta.dir, "..");
  if (existsSync(join(sourceRoot, "package.json"))) return sourceRoot;
  return dirname(process.execPath);
}

const exitCodes = { ok: 0, usage: 2, conflict: 3, notFound: 4, hasFailures: 5, serverDown: 6 } as const;

type Options = Record<string, string | boolean | number | undefined>;

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const options: Options = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        options[key] = next;
        index++;
      } else options[key] = true;
    } else if (/^-\w$/.test(token)) {
      const map: Record<string, string> = { w: "workspace" };
      const key = map[token[1]!];
      const next = argv[index + 1];
      if (key && next !== undefined && !next.startsWith("--")) {
        options[key] = next;
        index++;
      } else if (key) options[key] = true;
    } else positional.push(token);
  }
  return { positional, options };
}

const serverBase = () => {
  const value = process.env.TOONFLOW_SERVER ?? "http://127.0.0.1:3000";
  return value.replace(/\/$/, "");
};

class CliError extends Error {
  constructor(message: string, public code: number, public hint?: string) {
    super(message);
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${serverBase()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(120000),
  }).catch(error => {
    throw new CliError(`无法连接 Toonflow server（${serverBase()}）：${error instanceof Error ? error.message : String(error)}`, exitCodes.serverDown, "请先启动 Toonflow（bun run dev 或桌面应用），或用 --server 指定地址");
  });
  const body = await response.json().catch(() => null) as { code?: number; data?: unknown; message?: string } | null;
  if (!response.ok || (body && body.code !== 200)) {
    const message = body?.message ?? `HTTP ${response.status}`;
    const code = response.status === 409 ? exitCodes.conflict : response.status === 404 ? exitCodes.notFound : exitCodes.usage;
    const hint = response.status === 409 ? "画布已被其他端修改：先 canvas get 重读最新画布，再重试修改" : response.status === 404 ? "目标不存在：用 canvas list / canvas get 查询最新 ID 后重试" : undefined;
    throw new CliError(message, code, hint);
  }
  return body?.data;
}

const workspaceCacheFile = () => `${import.meta.dir}/../data/toonflowCliWorkspace.txt`;

function workspaceOf(options: Options, required = true) {
  const directory = (options.workspace as string) ?? process.env.TOONFLOW_WORKSPACE;
  if (directory) return directory;
  const cached = require("node:fs").existsSync(workspaceCacheFile())
    ? require("node:fs").readFileSync(workspaceCacheFile(), "utf8").trim() : "";
  if (cached) return cached;
  if (required) throw new CliError("缺少工作区目录", exitCodes.usage, "用 -w <目录> 指定，或先 project open <目录>（会记住），或设置环境变量 TOONFLOW_WORKSPACE");
  return undefined;
}

async function canvasOperation(directory: string, name: string, args: Record<string, unknown>, options: Options) {
  return request("/api/canvas/operation", {
    method: "POST",
    body: JSON.stringify({ directory, canvasId: options.canvas ?? undefined, name, args }),
  });
}

function emit(value: unknown, options: Options, human: () => string) {
  if (options.json) console.log(JSON.stringify(value, null, 2));
  else console.log(human());
}

function fail(error: unknown): never {
  if (error instanceof CliError) {
    console.error(`error: ${error.message}`);
    if (error.hint) console.error(`hint: ${error.hint}`);
    process.exit(error.code);
  }
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(exitCodes.usage);
}

const canvasFieldGuide = `画布 JSON 字段说明（nodes[].data 内）：
- label: 节点显示名（资产名 / 分镜N）
- prompt: 生成提示词；promptModel 为其按行拆分的内部结构，可忽略
- model: 模型选择，JSON 字符串 "[providerId, modelId]"，空=未配置
- size/ratio: 图片尺寸与比例；duration/resolution/mode/generateAudio: 视频时长/分辨率/参考模式/声音
- handles: 端口声明（in=输入，image/video/audio=输出），是连线合法性依据
- outputs: 当前产物引用 {image:{dataType:"IMAGE",value:{url:"assets/<nodeId>/xxx.png"}}}，url 为工作区相对路径
- generationHistory: 每次生成记录 {status(running/succeeded/failed), prompt, model, files, error?}，最多 50 条
顶层: toonflowCanvas=true 标记 / nodes / edges / viewport / revision（文档版本，乐观锁序号）
edges: {source, target, sourceHandle, targetHandle}——资产 image 端口连到分镜 in 端口即出镜关系`;

// ---- 命令实现 ----

async function cmdModels(options: Options) {
  const providers = (await request("/api/providers/media/list")) as { id: string; label: string; models: { id: string; type: string; mode?: unknown }[] }[];
  const typeFilter = options.type as string | undefined;
  const rows = providers.flatMap(provider => provider.models
    .filter(model => !typeFilter || model.type === typeFilter)
    .map(model => ({ providerId: provider.id, modelId: model.id, type: model.type, ref: `${provider.id}/${model.id}` })));
  emit(rows, options, () => rows.map(row => `${row.ref}  ${row.type}`).join("\n") || "（无模型）");
}

async function fetchSettings() {
  const data = (await request("/api/settings/get")) as { settings?: Record<string, unknown> };
  return data.settings ?? {};
}

async function cmdConfig(positional: string[], options: Options) {
  const action = positional[0];
  const key = positional[1];
  if (action === "get") {
    if (!key) throw new CliError("用法: toonflow config get <点路径>（如 mediaProviderConfigs.grsai）", exitCodes.usage);
    const settings = await fetchSettings();
    const value = key.split(".").reduce<unknown>((node, segment) => (node as Record<string, unknown> | undefined)?.[segment], settings);
    if (value === undefined) throw new CliError(`配置项不存在: ${key}`, exitCodes.notFound);
    emit({ key, value: typeof value === "object" ? "[对象，--json 查看]" : value }, options, () => `${key} = ${typeof value === "object" ? JSON.stringify(value).slice(0, 200) : String(value)}`);
    return;
  }
  if (action !== "set" || !key || positional[2] === undefined) throw new CliError("用法: toonflow config set <点路径> <值>（如 mediaProviderConfigs.grsai.ts <apiKey>）", exitCodes.usage);
  const value = positional[2];
  const current = await fetchSettings();
  const segments = key.split(".");
  let cursor: Record<string, unknown> = current;
  for (const segment of segments.slice(0, -1)) {
    if (!cursor[segment] || typeof cursor[segment] !== "object") cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = value;
  await request("/api/settings/save", { method: "PUT", body: JSON.stringify({ settings: current }) });
  emit({ key, updated: true }, options, () => `已更新 ${key}`);
}

async function cmdStatus(options: Options) {
  const projects = (await request("/api/projects/list")) as { name: string; directory: string }[];
  const workspace = workspaceOf(options, false);
  const output = { server: serverBase(), online: true, projects: projects.length, workspace: workspace ?? null };
  emit(output, options, () => `Toonflow server: ${serverBase()} 在线\n项目数: ${projects.length}${workspace ? `\n默认工作区(已记住): ${workspace}` : ""}`);
}

async function cmdProjectList(options: Options) {
  const projects = (await request("/api/projects/list")) as { name: string; directory: string; modifiedAt: number }[];
  emit(projects, options, () => projects.map(p => `${p.name}\t${p.directory}`).join("\n") || "（无项目）");
}

async function cmdProjectOpen(positional: string[], options: Options) {
  const directory = positional[0];
  if (!directory) throw new CliError("用法: toonflow project open <绝对目录>（不存在会自动创建）", exitCodes.usage);
  const canvases = (await request(`/api/canvas/list?directory=${encodeURIComponent(directory)}`)) as unknown[];
  await require("node:fs/promises").writeFile(workspaceCacheFile(), directory);
  emit({ directory, canvases: canvases.length, remembered: true }, options, () => `工作区就绪: ${directory}（画布 ${canvases.length} 个）\n已记住为默认工作区，后续命令可省略 -w`);
}

async function cmdCanvasList(options: Options) {
  const directory = workspaceOf(options);
  const canvases = (await request(`/api/canvas/list?directory=${encodeURIComponent(directory)}`)) as { id: string; revision: number; nodeCount: number; edgeCount: number }[];
  emit(canvases, options, () => canvases.map(c => `${c.id}\t节点 ${c.nodeCount}\t边 ${c.edgeCount}\trev ${c.revision}`).join("\n") || "（无画布，canvas import 会自动创建）");
}

async function getCanvasState(options: Options) {
  return canvasOperation(workspaceOf(options), "getCanvas", {}, options) as Promise<{
    id: string; revision: number; nodes: Record<string, any>[]; edges: Record<string, any>[]; nodeTools: { nodeId: string; name: string }[];
  }>;
}

async function cmdCanvasGet(options: Options) {
  const state = await getCanvasState(options);
  if (options.json) return emit(state, options, () => "");
  const typeCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  for (const node of state.nodes) {
    const type = String(node.type ?? "?").replace("remote-", "");
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    const history = node.data?.generationHistory ?? [];
    const status = String(history.at(-1)?.status ?? "idle");
    if (type.includes("Generation")) statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }
  const lines = [`画布 ${state.id}（revision ${state.revision}）：${state.nodes.length} 节点 / ${state.edges.length} 边`];
  lines.push(`节点类型: ${Object.entries(typeCounts).map(([type, count]) => `${type}×${count}`).join("  ") || "（空）"}`);
  if (Object.keys(statusCounts).length) lines.push(`生成状态: ${Object.entries(statusCounts).map(([status, count]) => `${status}×${count}`).join("  ")}`);
  if (options.nodes) {
    for (const node of state.nodes.slice(0, 50)) console.log(`  ${node.id.slice(0, 8)}  ${String(node.data?.label ?? "")}\t${String(node.type ?? "").replace("remote-", "")}`);
    if (state.nodes.length > 50) console.log(`  … 共 ${state.nodes.length} 个（--json 查看全部）`);
  }
  console.log(lines.join("\n"));
}

const importSchemaExample = `{
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
}`;

function canvasIdOf(options: Options) {
  return typeof options.canvas === "string" ? options.canvas : undefined;
}

async function cmdCanvasImport(positional: string[], options: Options) {
  if (options.schema) {
    console.log(importSchemaExample);
    return;
  }
  const file = positional[0];
  if (!file) throw new CliError("用法: toonflow canvas import <分镜.json> [--auto-submit] [--schema 查看示例]", exitCodes.usage, "先 --schema 看示例 JSON；模型 providerId/modelId 用 models 命令查询");
  const payload = JSON.parse(readFileSync(file, "utf8"));
  const args = { ...payload, options: { ...payload.options, ...(options["auto-submit"] ? { autoSubmit: true } : {}) } };
  const result = await canvasOperation(workspaceOf(options), "importStoryboard", args, options);
  const summary = result as { assetNodeIds: unknown[]; sceneNodeIds: unknown[]; edgeIds: unknown[]; workspaceDirectory?: string };
  emit(result, options, () => `导入成功: 资产 ${summary.assetNodeIds?.length ?? 0} / 分镜 ${summary.sceneNodeIds?.length ?? 0} / 连线 ${summary.edgeIds?.length ?? 0}${options["auto-submit"] ? "（已提交队列，用 queue status --watch 盯进度）" : ""}
画布: ${canvasIdOf(options) ?? "（默认第一块）"}｜工作区: ${summary.workspaceDirectory}`);
}

type ReportData = {
  summary: { canvasId: string; revision: number; generationNodes: number; succeeded: number; failed: number; queued: number; idle: number; issues: number; warnings: number };
  issues: { level: string; label: string; kind: string; detail: string; suggestion: string }[];
  nodes: { nodeId: string; label: string; type: string; model: string; status: string; promptSummary: string; outputs: string[]; upstream: string[]; error?: string }[];
};

async function cmdCanvasReport(options: Options) {
  if (options.explain) {
    console.log(canvasFieldGuide);
    return;
  }
  const directory = workspaceOf(options);
  const report = (await request(`/api/canvas/report?directory=${encodeURIComponent(directory)}${options.canvas ? `&canvasId=${encodeURIComponent(String(options.canvas))}` : ""}`)) as ReportData;
  if (options.json) return emit(report, options, () => "");
  const { summary } = report;
  console.log(`画布 ${summary.canvasId}（revision ${summary.revision}）｜生成节点 ${summary.generationNodes}：成功 ${summary.succeeded}、失败/跳过 ${summary.failed}、排队/运行 ${summary.queued}、未触发 ${summary.idle}｜异常 ${summary.issues}、警告 ${summary.warnings}`);
  if (report.issues.length) {
    console.log("\n[异常清单]");
    for (const issue of report.issues.slice(0, 30)) {
      console.log(`  ${issue.level === "error" ? "✗" : "⚠"} ${issue.label}｜${issue.kind}：${issue.detail.slice(0, 90)}`);
      console.log(`    → ${issue.suggestion}`);
    }
    if (report.issues.length > 30) console.log(`  … 共 ${report.issues.length} 项（--json 全量）`);
  } else console.log("\n[异常清单] 无（全部健康）");
  console.log("\n[节点表] label｜类型｜模型｜状态｜产物");
  for (const node of report.nodes.slice(0, 40)) {
    console.log(`  ${node.label}｜${node.type}｜${node.model || "(无模型)"}｜${node.status}｜${node.outputs.map(output => output.split("/").pop()).join(",") || "—"}${node.upstream.length ? `｜←[${node.upstream.join(",")}]` : ""}`);
  }
  if (report.nodes.length > 40) console.log(`  … 共 ${report.nodes.length} 个（--json 全量）`);
  if (summary.issues > 0) process.exit(exitCodes.hasFailures);
}

async function cmdCanvasFit(options: Options) {
  const directory = workspaceOf(options);
  const nodeIds = typeof options.nodes === "string" ? options.nodes.split(",").map(value => value.trim()).filter(Boolean) : undefined;
  let resolvedIds = nodeIds;
  if (nodeIds) {
    const state = await getCanvasState(options);
    resolvedIds = nodeIds.map(token => state.nodes.find(item => item.id === token || item.id.startsWith(token) || item.data?.label === token)?.id);
    if (resolvedIds.some(id => !id)) throw new CliError(`节点不存在: ${nodeIds[resolvedIds.findIndex(id => !id)]}`, exitCodes.notFound, "先 canvas get --nodes 查看节点列表");
  }
  const result = await canvasOperation(directory, "fitCanvas", { ...(resolvedIds ? { nodeIds: resolvedIds } : {}) }, options);
  const fitted = result as { fitted?: boolean; viewport?: { zoom?: number } };
  emit(result, options, () => `视口已适配${resolvedIds ? `到指定 ${resolvedIds.length} 个节点` : "到全部节点"}${fitted.viewport?.zoom !== undefined ? `（zoom ${fitted.viewport.zoom.toFixed(2)}）` : ""}——现在可在浏览器截图；节点多看不清时用 --nodes 分组聚焦逐区截图`);
}

async function cmdNodeList(options: Options) {
  const state = await getCanvasState(options);
  const typeFilter = (options.type as string | undefined)?.replace("remote-", "");
  const statusFilter = options.status as string | undefined;
  const rows = state.nodes.filter(node => {
    const type = String(node.type ?? "").replace("remote-", "");
    if (typeFilter && !type.includes(typeFilter)) return false;
    const history = node.data?.generationHistory ?? [];
    const status = String(history.at(-1)?.status ?? "idle");
    return !statusFilter || (type.includes("Generation") && status === statusFilter);
  }).map(node => ({
    nodeId: node.id, label: String(node.data?.label ?? ""), type: String(node.type ?? "").replace("remote-", ""),
    status: String((node.data?.generationHistory ?? []).at(-1)?.status ?? "idle"),
  }));
  emit(rows, options, () => {
    const shown = rows.slice(0, 50);
    return shown.map(row => `${row.nodeId.slice(0, 8)}  ${row.label}\t${row.type}\t${row.status}`).join("\n") + (rows.length > 50 ? `\n… 共 ${rows.length} 个（--json 全量）` : "");
  });
}

async function cmdNodeGet(positional: string[], options: Options) {
  const nodeId = positional[0];
  if (!nodeId) throw new CliError("用法: toonflow node get <nodeId|label>", exitCodes.usage);
  const state = await getCanvasState(options);
  const node = state.nodes.find(item => item.id === nodeId || item.id.startsWith(nodeId) || item.data?.label === nodeId);
  if (!node) throw new CliError(`节点不存在: ${nodeId}`, exitCodes.notFound, "先 canvas get --nodes 查看最新节点列表");
  emit(node, options, () => `${node.data?.label ?? node.id} (${node.type})\n${JSON.stringify(node.data, null, 2).slice(0, 2000)}`);
}

async function cmdNodeSet(positional: string[], options: Options) {
  const nodeId = positional[0];
  if (!nodeId) throw new CliError("用法: toonflow node set <nodeId> [--prompt ...] [--model provider/model] [--duration N] [--resolution R] [--ratio R] [--size S]", exitCodes.usage);
  const state = await getCanvasState(options);
  const node = state.nodes.find(item => item.id === nodeId || item.id.startsWith(nodeId) || item.data?.label === nodeId);
  if (!node) throw new CliError(`节点不存在: ${nodeId}`, exitCodes.notFound);
  const directory = workspaceOf(options);
  if (options.prompt !== undefined) await canvasOperation(directory, "nodeTools", { nodeId: node.id, name: "node:setPrompt", args: { prompt: String(options.prompt) } }, options);
  const configArgs: Record<string, unknown> = {};
  if (options.model !== undefined) {
    const [providerId, modelId] = String(options.model).split("/");
    if (!providerId || !modelId) throw new CliError("--model 格式: providerId/modelId（如 mockProvider/mockVideo）", exitCodes.usage);
    configArgs.providerId = providerId;
    configArgs.modelId = modelId;
  }
  const isVideo = String(node.type ?? "").includes("video");
  for (const key of ["duration", "resolution", "ratio", "size"] as const) {
    if (options[key] === undefined) continue;
    if (!isVideo && ["duration", "resolution"].includes(key)) throw new CliError(`--${key} 仅适用于视频生成节点`, exitCodes.usage, `图片生成节点可用: --model / --ratio / --size`);
    configArgs[key] = key === "duration" ? Number(options[key]) : String(options[key]);
  }
  if (Object.keys(configArgs).length) await canvasOperation(directory, "nodeTools", { nodeId: node.id, name: "node:setConfig", args: configArgs }, options);
  emit({ nodeId: node.id, updated: { ...configArgs, ...(options.prompt !== undefined ? { prompt: options.prompt } : {}) } }, options, () => `已更新 ${node.data?.label ?? node.id}`);
}

async function cmdNodeCast(positional: string[], options: Options) {
  const nodeId = positional[0];
  const assets = options.assets as string | undefined;
  if (!nodeId || !assets) throw new CliError("用法: toonflow node cast <分镜nodeId> --assets <资产id1,id2,...>（整组替换出镜连线）", exitCodes.usage);
  const state = await getCanvasState(options);
  const scene = state.nodes.find(item => item.id === nodeId || item.id.startsWith(nodeId) || item.data?.label === nodeId);
  if (!scene) throw new CliError(`节点不存在: ${nodeId}`, exitCodes.notFound);
  const wanted = assets.split(",").map(value => value.trim()).filter(Boolean);
  const resolved = wanted.map(token => state.nodes.find(item => item.id === token || item.id.startsWith(token) || item.data?.label === token)?.id);
  if (resolved.some(id => !id)) throw new CliError(`资产不存在: ${wanted[resolved.findIndex(id => !id)]}`, exitCodes.notFound, "先 canvas get --nodes 查看资产列表");
  const directory = workspaceOf(options);
  const oldEdges = state.edges.filter(edge => edge.target === scene.id).map(edge => edge.id);
  if (oldEdges.length) await canvasOperation(directory, "deleteEdges", { edgeIds: oldEdges }, options);
  if (resolved.length) await canvasOperation(directory, "connectNodes", { connections: resolved.map(source => ({ source, target: scene.id, sourceHandle: "image", targetHandle: "in" })) }, options);
  emit({ nodeId: scene.id, assets: resolved }, options, () => `${scene.data?.label ?? scene.id} 出镜连线已替换为 ${resolved.length} 个资产`);
}

async function cmdQueueSubmit(options: Options) {
  const directory = workspaceOf(options);
  const scope = (options.scope as string) ?? "missing";
  if (!["missing", "all"].includes(scope)) throw new CliError("--scope 取值: missing（默认，断点重建用）| all", exitCodes.usage);
  const nodeIds = typeof options.nodes === "string" ? options.nodes.split(",").map(v => v.trim()).filter(Boolean) : undefined;
  const body: Record<string, unknown> = { directory, scope: nodeIds ? "nodes" : scope, ...(nodeIds ? { nodeIds } : {}), ...(options.canvas ? { canvasId: options.canvas } : {}) };
  if (options.concurrency !== undefined) body.concurrency = Number(options.concurrency);
  const result = (await request("/api/queue/submit", { method: "POST", body: JSON.stringify(body) })) as { submitted: { taskId: string; nodeId: string; label: string }[]; skipped: { label: string; reason: string }[] };
  emit(result, options, () => {
    const lines = [`已提交 ${result.submitted.length} 个任务（scope=${nodeIds ? "nodes" : scope}）`];
    if (result.submitted.length) lines.push(`  ${result.submitted.map(t => t.label).slice(0, 20).join("、")}${result.submitted.length > 20 ? " …" : ""}`);
    if (result.skipped.length) lines.push(`跳过 ${result.skipped.length} 个: ${result.skipped.slice(0, 5).map(s => `${s.label}(${s.reason})`).join("、")}${result.skipped.length > 5 ? " …" : ""}`);
    lines.push("用 queue status --watch 盯进度");
    return lines.join("\n");
  });
}

function humanQueue(status: { summary: Record<string, number>; concurrency: { current: number; max: number } }) {
  const { total, succeeded, running, pending, backoff, skipped, cancelled } = status.summary;
  const failed = status.summary.failed ?? 0;
  return `队列: 总 ${total} | 成功 ${succeeded} | 运行 ${running} | 排队 ${pending + backoff} | 跳过 ${skipped} | 取消 ${cancelled} | 失败 ${failed} | 并发 ${status.concurrency.current}/${status.concurrency.max}`;
}

async function fetchQueueStatus(directory: string | undefined, options: Options) {
  const params = new URLSearchParams();
  if (directory) params.set("directory", directory);
  if (options.canvas) params.set("canvasId", String(options.canvas));
  return request(`/api/queue/status?${params}`) as Promise<{ tasks: Record<string, any>[]; summary: Record<string, number>; concurrency: { current: number; max: number } }>;
}

function queueSettled(status: { summary: Record<string, number> }) {
  const { total, succeeded, skipped, cancelled } = status.summary;
  const failed = status.summary.failed ?? 0;
  return total > 0 && succeeded + skipped + cancelled + failed >= total;
}

async function cmdQueueStatus(options: Options) {
  const directory = workspaceOf(options, false);
  let status = await fetchQueueStatus(directory, options);
  if (options.watch) {
    const interval = (Number(options.interval ?? 30)) * 1000;
    while (!queueSettled(status)) {
      if (!options.json) console.log(humanQueue(status));
      await new Promise(resolve => setTimeout(resolve, interval));
      status = await fetchQueueStatus(directory, options);
    }
    if (options.json) return emit(status, options, () => "");
    console.log(humanQueue(status));
    const bad = status.tasks.filter(task => ["skipped", "failed"].includes(task.status));
    for (const task of bad) console.log(`  ✗ ${task.label}: ${(task.error ?? "").slice(0, 80)}（queue logs ${task.id} 可看失败原因）`);
    if (bad.length) process.exit(exitCodes.hasFailures);
    return;
  }
  emit(status, options, () => {
    const lines = [humanQueue(status)];
    for (const task of status.tasks.slice(0, 20)) lines.push(`  [${task.status}] ${task.label}${task.attempt ? ` 尝试${task.attempt}` : ""}${task.error ? ` ${(task.error as string).slice(0, 60)}` : ""}`);
    return lines.join("\n");
  });
}

async function cmdQueueLogs(positional: string[], options: Options) {
  const taskId = positional[0];
  if (!taskId) throw new CliError("用法: toonflow queue logs <taskId>", exitCodes.usage);
  const logs = (await request(`/api/queue/logs?taskId=${encodeURIComponent(taskId)}`)) as { status: string; error?: string; logs: { at: number; level: string; message: string }[] };
  const tail = Number(options.tail ?? 20);
  emit(logs, options, () => {
    const lines = [`任务 ${taskId.slice(0, 8)} [${logs.status}]`];
    if (logs.error) lines.push(`失败原因: ${logs.error}`);
    for (const entry of logs.logs.slice(-tail)) lines.push(`  ${new Date(entry.at).toLocaleTimeString()} ${entry.level === "error" ? "✗" : "·"} ${entry.message}`);
    return lines.join("\n");
  });
}

async function cmdQueueRetry(positional: string[], options: Options) {
  const nodeIds = positional.filter(id => !id.startsWith("--"));
  if (!nodeIds.length) throw new CliError("用法: toonflow queue retry <nodeId...> [--set fix.json]", exitCodes.usage);
  const directory = workspaceOf(options);
  const patch = options.set ? JSON.parse(readFileSync(String(options.set), "utf8")) as Record<string, unknown> : undefined;
  if (patch) {
    for (const nodeId of nodeIds) {
      if (patch.prompt !== undefined) await canvasOperation(directory, "nodeTools", { nodeId, name: "node:setPrompt", args: { prompt: patch.prompt } }, options);
      const configArgs = { ...patch };
      delete configArgs.prompt;
      if (Object.keys(configArgs).length) await canvasOperation(directory, "nodeTools", { nodeId, name: "node:setConfig", args: configArgs }, options);
    }
  }
  const result = (await request("/api/queue/submit", { method: "POST", body: JSON.stringify({ directory, scope: "nodes", nodeIds }) })) as { submitted: unknown[] };
  emit(result, options, () => `已重新提交 ${result.submitted.length} 个任务${patch ? "（已应用 --set 修改）" : ""}`);
}

async function cmdQueueCancel(positional: string[], options: Options) {
  const directory = workspaceOf(options, false);
  const body: Record<string, unknown> = {};
  if (options.all) body.all = true;
  else if (positional[0]) body[positional[0]!.length === 36 ? "taskId" : "nodeId"] = positional[0];
  else throw new CliError("用法: toonflow queue cancel <taskId|nodeId> | --all", exitCodes.usage);
  if (directory) body.directory = directory;
  const result = (await request("/api/queue/cancel", { method: "POST", body: JSON.stringify(body) })) as { cancelled: number };
  emit(result, options, () => `已取消 ${result.cancelled} 个任务`);
}

async function cmdQueueExport(options: Options) {
  const directory = workspaceOf(options);
  const state = await getCanvasState(options);
  const { stat } = await import("node:fs/promises");
  const { resolve: resolvePath } = await import("node:path");
  const rows: Record<string, unknown>[] = [];
  for (const node of state.nodes) {
    const type = String(node.type ?? "");
    if (!type.includes("GenerationNode")) continue;
    const history = node.data?.generationHistory ?? [];
    const last = history.at(-1) ?? {};
    const outputs = node.data?.outputs ?? {};
    const files = Object.values(outputs).flatMap((output: any) => output?.value?.url ? [{ url: output.value.url, mimeType: output.value.mimeType }] : []);
    let missing = false;
    if (options.verify) {
      for (const file of files) {
        try {
          const info = await stat(resolvePath(directory, file.url));
          if (!info.size) missing = true;
          (file as { bytes?: number }).bytes = info.size;
        } catch { missing = true; }
      }
    }
    rows.push({
      label: String(node.data?.label ?? node.id), nodeId: node.id, type: type.replace("remote-", ""),
      status: String(last.status ?? "idle"), error: last.error ?? undefined, files, ...(options.verify ? { verified: !missing } : {}),
    });
  }
  const format = String(options.format ?? "md");
  let content: string;
  if (format === "json") content = JSON.stringify(rows, null, 2);
  else if (format === "csv") content = ["label,nodeId,type,status,files", ...rows.map(row => `"${row.label}","${row.nodeId}","${row.type}","${row.status}","${(row.files as { url: string }[]).map(f => f.url).join(" ; ")}"`)].join("\n");
  else content = [`# 产物清单（${state.id}）`, "", "| 分镜 | 类型 | 状态 | 产物 |", "| --- | --- | --- | --- |", ...rows.map(row => `| ${row.label} | ${row.type} | ${row.status}${options.verify && row.verified === false ? "（⚠ 产物缺失）" : ""} | ${(row.files as { url: string }[]).map(f => f.url).join("<br>") || "—" } |`)].join("\n");
  if (options.output) writeFileSync(String(options.output), content, "utf8");
  const missingCount = rows.filter(row => row.verified === false).length;
  emit({ rows, missing: missingCount, output: options.output ?? null }, options, () => {
    const lines = [`产物 ${rows.length} 项${options.output ? ` 已写入 ${options.output}` : ""}`];
    if (options.verify) lines.push(missingCount ? `⚠ ${missingCount} 项产物文件缺失` : "全部产物文件在盘 ✓");
    return lines.join("\n");
  });
  if (missingCount) process.exit(exitCodes.hasFailures);
}

// ---- 帮助 ----

// 调用方式按实际启动器动态显示（源码 bun 脚本 / 桌面 exe 均可执行示例命令）。
// 编译版 process.argv[1] 是 Bun 虚拟路径（B:/~BUN/...），需取 exe 真实路径 process.execPath。
const launcher = ((process.argv[1] ?? "toonflow").includes("~BUN") ? process.execPath : process.argv[1] ?? "toonflow").split("\\").join("/");
const helpText = `Toonflow CLI —— headless 画布生产（与 MCP 同语义同后端）

用法: ${launcher} <组> <命令> [参数]
全局: --json 结构化输出 | -w, --workspace <目录>（或环境变量 TOONFLOW_WORKSPACE）| --canvas <画布id> | --server <url>

命令:
  status                                  自检：server 连接 / 项目数 / 当前工作区
  install [--hosts d1,d2] [--force]       一键安装（P4 提供；当前见 skills/toonflowCli）
  models [--type image|video]             可用模型清单（providerId/modelId 供 import 与 node set 用）
  config set <点路径> <值>                 配置供应商凭证等设置（如 mediaProviderConfigs.grsai.ts <apiKey>）
  project list                            项目清单
  project open <目录>                      打开工作区（不存在自动创建；记住为默认，后续可省略 -w）
  canvas list                             画布清单
  canvas get [--nodes]                    画布摘要（--nodes 附节点表）
  canvas report [--explain]               画布体检：拓扑/节点现状/异常检测（产物落盘实测）；--explain 打印画布 JSON 字段说明
  canvas fit [--nodes id1,id2]            让已打开页面适配视口（全幅或聚焦节点），配合浏览器截图排查
  canvas import <分镜.json> [--auto-submit]
                                          导入分镜一次建图；--auto-submit 导入后立即提交队列
                                          JSON 示例：canvas import --schema（含 options 模型字段）
  node list [--type imageGeneration|videoGeneration] [--status failed|succeeded|...]
  node get <nodeId|label>
  node set <nodeId> [--prompt "…"] [--model provider/model] [--duration N] [--resolution 480P] [--ratio 9:16] [--size 2K]
  node cast <分镜nodeId> --assets <资产id1,id2>   整组替换该分镜的出镜连线
  queue submit [--scope missing|all] [--nodes id1,id2] [--concurrency N]
                                          批量入队（默认 missing=只补未完成，重启后重建就重跑本命令）
  queue status [--watch] [--interval 30]  队列状态；--watch 挂机轮询到终态（有失败退出码 5）
  queue logs <taskId> [--tail 20]         任务日志与失败原因原文
  queue retry <nodeId...> [--set fix.json] 按修改重提（--set 如 {"prompt":"…"}）
  queue cancel <taskId|nodeId> | --all
  queue export [--format md|json|csv] [--output 文件] [--verify]
                                          产物路径清单；--verify 校验落盘

退出码: 0 成功 | 2 参数/请求错误 | 3 画布版本冲突(先 canvas get 重读) | 4 目标不存在 | 5 完成但存在失败任务 | 6 server 未运行

典型挂机流程:
  export TOONFLOW_WORKSPACE="D:/prod/demo"
  ${launcher} canvas import storyboard.json --auto-submit
  ${launcher} queue status --watch --interval 60 || true
  ${launcher} queue export --format md --output 清单.md --verify`;

// ---- 分发 ----

// 单命令组（status/models/install）没有子命令，其 flag 不能被当成子命令吃掉。
const rawArgs = process.argv.slice(2);
const group = rawArgs[0];
const singleCommandGroups = new Set(["status", "models", "install"]);
const hasSubCommand = !!rawArgs[1] && !rawArgs[1]!.startsWith("-") && !singleCommandGroups.has(rawArgs[0]!);
const command = hasSubCommand ? rawArgs[1] : undefined;
const rest = rawArgs.slice(hasSubCommand ? 2 : 1);
if (!group || group === "--help" || group === "help") {
  console.log(helpText);
  process.exit(0);
}
const { positional, options } = parseArgs(rest);
try {
  if (group === "status") await cmdStatus(options);
  else if (group === "models") await cmdModels(options);
  else if (group === "config") await cmdConfig(positional, options);
  else if (group === "install") {
    const argv = process.argv.slice(3);
    const installArgs = new Set(argv.filter(arg => arg.startsWith("--")));
    const value = (name: string) => {
      const index = argv.indexOf(`--${name}`);
      return index >= 0 ? argv[index + 1] : undefined;
    };
    try {
      process.exit(await runInstall({ args: installArgs, value, rootDirectory: cliRoot() }));
    } catch (error) {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`hint: 检查网络与镜像地址（--mirror），默认 https://gitee.com/comtudodo/tudodo-center/raw/master`);
      process.exit(2);
    }
  }
  else if (group === "project" && command === "list") await cmdProjectList(options);
  else if (group === "project" && command === "open") await cmdProjectOpen(positional, options);
  else if (group === "canvas" && command === "list") await cmdCanvasList(options);
  else if (group === "canvas" && (command === "get" || command === undefined)) await cmdCanvasGet(options);
  else if (group === "canvas" && command === "import") await cmdCanvasImport(positional, options);
  else if (group === "canvas" && command === "report") await cmdCanvasReport(options);
  else if (group === "canvas" && command === "fit") await cmdCanvasFit(options);
  else if (group === "node" && command === "list") await cmdNodeList(options);
  else if (group === "node" && command === "get") await cmdNodeGet(positional, options);
  else if (group === "node" && command === "set") await cmdNodeSet(positional, options);
  else if (group === "node" && command === "cast") await cmdNodeCast(positional, options);
  else if (group === "queue" && command === "submit") await cmdQueueSubmit(options);
  else if (group === "queue" && (command === "status" || command === undefined)) await cmdQueueStatus(options);
  else if (group === "queue" && command === "logs") await cmdQueueLogs(positional, options);
  else if (group === "queue" && command === "retry") await cmdQueueRetry(positional, options);
  else if (group === "queue" && command === "cancel") await cmdQueueCancel(positional, options);
  else if (group === "queue" && command === "export") await cmdQueueExport(options);
  else throw new CliError(`未知命令: ${group} ${command ?? ""}`, exitCodes.usage, "运行 --help 查看全部命令");
} catch (error) {
  fail(error);
}
