import { dirname, isAbsolute, resolve } from "node:path";
import { realpath, stat, mkdir, readdir, lstat, rm, rmdir, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { z } from "zod";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CanvasContext } from "@toonflow/tools-scaffold/runtime";
import { canvasOperations } from "@toonflow/tool-canvas/runtime";
import type { McpTool } from "@toonflow/mcp";
import { createAgentTools } from "@/agent/tools";
import { run as runAgent } from "@/agent";
import { getClaudeQuestionContext } from "@/agent/engines/claudeCode";
import type { QuestionRequest } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { applyCanvasOperation } from "@/utils/canvas/ops";
import { callControl, getConnection, listConnections } from "@/utils/mcp/control";
import { appOperations, runAppOperation } from "@/utils/mcp/operations";
import { getMcpRuntime } from "@/utils/mcp/runtime";
import { listTools } from "@/utils/plugins/tools";
import { isWithin, lockWorkspaceFiles, protectWorkspaceRoot, renameWorkspaceFile, resolveWorkspacePath, writeWorkspaceFile } from "@/utils/workspace/files";

const targetSchema = z.strictObject({ connectionId: z.uuid().optional(), directory: z.string().min(1).max(4096).optional(), canvasId: z.string().min(1).max(256).optional() });
const requestSchema = z.strictObject({ target: targetSchema.optional(), args: z.record(z.string(), z.unknown()) });
const canvasOperationNames = new Set<string>(canvasOperations.map(operation => operation.name));
let authorizationController = new AbortController();
for (const key of ["settings.mcp.enabled", "settings.mcp.auth", "settings.mcp.token"] as const) conf.onDidChange(key, () => {
  authorizationController.abort();
  authorizationController = new AbortController();
});

function assertDirectoryAllowed(path: string) {
  const desktop = ["win32", "darwin"].includes(process.platform) && (process.env.NODE_ENV === "dev" || process.env.toonflowDesktop === "1");
  if (desktop) return;
  const rootPath = resolve(dirname(conf.path), "workspaces");
  const root = realpathSync(rootPath);
  if (!isWithin(root, path)) throw new Error("服务器部署只能使用 data/workspaces 内的工作区");
}

async function resolveDirectory(directory?: string) {
  if (!directory || !isAbsolute(directory)) throw new Error("请在 target.directory 指定绝对工作目录，或先打开项目");
  const path = await realpath(directory);
  if (!(await stat(path)).isDirectory()) throw new Error("工作目录不是文件夹");
  assertDirectoryAllowed(path);
  return path;
}

// openProject 专用：目录不存在时先按部署边界校验再创建，让 Agent 能为新项目代劳建目录。
async function ensureProjectDirectory(directory: string) {
  if (!isAbsolute(directory)) throw new Error("请提供绝对工作目录");
  try {
    return await resolveDirectory(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    assertDirectoryAllowed(resolve(directory));
    await mkdir(directory, { recursive: true });
    return await resolveDirectory(directory);
  }
}

async function resolveTarget(target: z.infer<typeof targetSchema> = {}, requireDirectory = true) {
  const requestedDirectory = target.directory ? await resolveDirectory(target.directory) : undefined;
  const connection = getConnection(target.connectionId, requestedDirectory);
  if (target.connectionId && requestedDirectory && connection?.state.directory !== requestedDirectory) throw new Error("目标页面的工作区已切换，请重新获取 getAppState");
  if (target.canvasId && connection?.state.canvasId !== target.canvasId) throw new Error("目标画布已切换，请重新获取 getAppState");
  const directory = requireDirectory ? requestedDirectory ?? await resolveDirectory(connection?.state.directory ?? undefined) : undefined;
  return { connection, directory };
}

// headless 画布目标解析：页面连接不是必需，工作区目录才是（headless 主路径：target.directory 直接指定）。
// 显式指定的目录不存在时自动创建（与 openProject 语义一致），保证无页面流程可用。
async function resolveCanvasTarget(target: z.infer<typeof targetSchema> = {}) {
  const requestedDirectory = target.directory ? await ensureProjectDirectory(target.directory) : undefined;
  const connection = target.connectionId ? getConnection(target.connectionId, requestedDirectory) : getConnection(undefined, requestedDirectory);
  if (target.connectionId && requestedDirectory && connection?.state.directory !== requestedDirectory) throw new Error("目标页面的工作区已切换，请重新获取 getAppState");
  const directory = requestedDirectory ?? await resolveDirectory(connection?.state.directory ?? undefined);
  return { connection, directory };
}

function wrapTool(name: string, description: string, schema: object, execute: (args: Record<string, unknown>, target: z.infer<typeof targetSchema>, signal: AbortSignal) => Promise<unknown>): McpTool {
  // 插件 JSON Schema 的根引用在包裹后仍指向原来的参数对象。
  const argsSchema = JSON.parse(JSON.stringify(schema).replace(/"\$ref":"#(?=\/|")/g, '"$ref":"#/properties/args'));
  return {
    name, description,
    inputSchema: { type: "object", properties: { target: z.toJSONSchema(targetSchema), args: argsSchema }, required: ["args"], additionalProperties: false },
    async execute(input, signal) {
      const { args, target = {} } = requestSchema.parse(input);
      return execute(args, target, signal);
    },
  };
}

const uiSchemas = {
  openProject: z.strictObject({ directory: z.string().min(1).max(4096) }),
  switchPanel: z.strictObject({ panel: z.enum(["canvas", "document"]) }),
  getDocument: z.strictObject({}),
  openDocument: z.strictObject({ path: z.string().max(4096).optional(), canvasPath: z.string().max(4096).optional(), nodeId: z.string().max(256).optional(), handleId: z.string().max(256).optional() }),
  writeDocument: z.strictObject({ text: z.string().max(10_000_000), expectedText: z.string().max(10_000_000) }),
  getSettings: z.strictObject({}),
  updateSettings: z.strictObject({ patch: z.record(z.string(), z.json()).refine(patch => !["mcp", "stores"].some(key => Object.hasOwn(patch, key)), "不能通过 MCP 修改连接凭证或项目列表") }),
};
const uiDescriptions: Record<keyof typeof uiSchemas, string> = {
  openProject: "在目标 Toonflow 页面打开工作目录并等待工作区就绪；目录不存在时会先创建（服务器部署限 data/workspaces 内）。首次使用建议先 getAppState 获取 connectionId，无页面连接时先调用 openApp。",
  switchPanel: "切换工作区的 canvas 画布或 document 文档面板，先保存当前编辑。",
  getDocument: "读取当前文档内容和选择状态。writeDocument 必须携带本次读取的 text 作为 expectedText。",
  openDocument: "打开工作区中的文档文件(path)，或画布中的文本节点(canvasPath、nodeId，可选handleId)。",
  writeDocument: "通过文档编辑器保存当前文档；expectedText 必须匹配当前内容，防止覆盖用户新输入。",
  getSettings: "读取页面当前设置，访问凭证脱敏。",
  updateSettings: "合并保存指定顶层设置项，同时更新页面；不修改 mcp 凭证与 stores 项目列表，嵌套设置应先读取再合并。",
};

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /(?:api.?key|access.?token|refresh.?token|password|secret|authorization)$|^token$/i.test(key) ? (item ? "[REDACTED]" : "") : redactSecrets(item)]));
}

function assertFileNotOpen(directory: string, path: string) {
  for (const { state } of listConnections()) {
    if (state.directory !== directory) continue;
    const document = state.document as { selection?: { filePath?: string; canvasPath?: string } } | undefined;
    const openPaths = [state.canvasId, document?.selection?.filePath, document?.selection?.canvasPath];
    if (openPaths.some(file => file && isWithin(resolve(directory, path), resolve(directory, file)))) {
      throw new Error("文件正在 Toonflow 中打开，请使用画布或文档工具修改，关闭后再执行文件操作");
    }
  }
}

// ACT: 独立 dev server 不托管前端，页面在 vite dev（默认 5173）；探测不到时留给调用方报错。地址一律 127.0.0.1，避免 localhost 解析异常。
async function resolvePageUrl(): Promise<string | undefined> {
  if (process.env.NODE_ENV === "dev" && process.env.toonflowDesktop !== "1") {
    try {
      const response = await fetch("http://127.0.0.1:5173/", { signal: AbortSignal.timeout(1500) });
      if (response.ok) return "http://127.0.0.1:5173/#/workspace";
    } catch { /* vite 未启动 */ }
    return undefined;
  }
  const origin = getMcpRuntime().appOrigin;
  return origin ? `${origin}/#/workspace` : undefined;
}

export async function getMcpTools(): Promise<McpTool[]> {
  const authorizationSignal = authorizationController.signal;
  let pluginError: string | undefined;
  const tools: McpTool[] = [{
    name: "getAppState", description: "列出连接的 Toonflow 页面及其 connectionId、工作目录、画布、项目列表和节点能力。多个页面时必须用 target.connectionId 明确操作对象；无页面连接时只有显式 target.directory 的服务端工具可用，此时建议优先用你宿主的内嵌浏览器（右侧网页面板）打开返回的 suggestedPageUrl，无该能力再调用 openApp。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      const workspaceRoot = resolve(dirname(conf.path), "workspaces");
      await mkdir(workspaceRoot, { recursive: true });
      const suggestedPageUrl = await resolvePageUrl();
      return { connections: listConnections(), workspaceRoot, ...(suggestedPageUrl ? { suggestedPageUrl } : {}), ...(pluginError ? { pluginError } : {}) };
    },
  }];
  for (const [name, schema] of Object.entries(uiSchemas)) {
    tools.push(wrapTool(name, uiDescriptions[name as keyof typeof uiSchemas], z.toJSONSchema(schema), async (input, target, signal) => {
      const args = schema.parse(input);
      const { connection, directory } = await resolveTarget(target, !["openProject", "getSettings", "updateSettings"].includes(name));
      if (!connection) throw new Error("请先打开 Toonflow 桌面或网页，可调用 openApp 自动打开页面");
      if (name === "openProject") await ensureProjectDirectory((args as { directory: string }).directory);
      const result = await callControl(connection.id, name, args, signal, directory);
      return name === "getSettings" || name === "updateSettings" ? redactSecrets(result) : result;
    }));
  }
  tools.push(wrapTool("openApp", "用系统默认浏览器打开 Toonflow 工作区页面。若你具备内嵌浏览器/网页面板能力，优先自行打开 getAppState 返回的 suggestedPageUrl 并截图核验，本工具是无浏览器能力时的兜底；调用后等页面加载完成（几秒）再重试原操作。", z.toJSONSchema(z.strictObject({})), async () => {
    const url = await resolvePageUrl();
    if (!url) {
      // ACT: 独立 dev server 不托管前端，vite 未启动时明确指出，避免外部 Agent 反复探测。
      if (process.env.NODE_ENV === "dev" && process.env.toonflowDesktop !== "1") throw new Error("前端 dev server 未启动（127.0.0.1:5173 无响应），请先启动前端开发服务后再打开页面");
      throw new Error("Toonflow 服务尚未就绪，请稍后重试");
    }
    const command = process.platform === "win32" ? ["cmd", "/c", "start", "", url]
      : process.platform === "darwin" ? ["open", url] : ["xdg-open", url];
    const child = Bun.spawn({ cmd: command, stdout: "ignore", stderr: "ignore" });
    await child.exited;
    if (child.exitCode !== 0) throw new Error(`打开浏览器失败（exit ${child.exitCode}），请手动访问 ${url}`);
    // ACT: dev 页面经 vite 代理注册在主服务实例上；多实例场景下提示外部 Agent 改连主服务 /mcp。
    const hint = process.env.NODE_ENV === "dev" && process.env.toonflowDesktop !== "1"
      ? "dev 页面经 vite 代理注册在主服务实例上；若本 MCP 实例 getAppState 仍无连接，请改连主服务 MCP（默认 http://127.0.0.1:47392/mcp）" : undefined;
    return { url, opened: true, ...(hint ? { hint } : {}) };
  }));
  // 画布生成队列域：批量提交/状态/日志/取消（挂机生产主入口；scope=missing 幂等重建）。
  const submitQueueSchema = z.strictObject({
    scope: z.enum(["missing", "all"]).default("missing"),
    nodeIds: z.array(z.string().min(1).max(256)).max(500).optional(),
    concurrency: z.number().int().min(1).max(20).optional(),
    canvasId: z.string().min(1).max(256).optional(),
  });
  tools.push(wrapTool("submitQueue", "把画布生成类节点批量提交到生成队列挂机执行：依赖自动编排（资产图先生成，完成后视频才调度）、并发受控、限流退避、单任务失败 3 次自动跳过。scope=missing（默认）只提交未完成且产物不在盘的节点——server 重启后重跑同一命令即可幂等重建未完成任务；scope=all 提交全部生成节点。返回 submitted 与 skipped 明细。", z.toJSONSchema(submitQueueSchema, { io: "input" }), async (input, target, signal) => {
    const args = submitQueueSchema.parse(input);
    const { directory } = await resolveCanvasTarget(target);
    void signal;
    const { submitCanvasQueue } = await import("@/utils/canvas/queue");
    const result = await submitCanvasQueue(directory!, args.canvasId, { type: args.scope, nodeIds: args.nodeIds }, { concurrency: args.concurrency });
    return { ...result, workspaceDirectory: directory, note: "状态用 queueStatus 轮询；失败原因用 queueLogs 查询" };
  }));
  tools.push(wrapTool("queueStatus", "查询生成队列状态：任务明细（nodeId/label/status/attempt/error）与 summary 汇总、当前并发。任务状态含 pending/backoff/running/succeeded/skipped/cancelled；完成判定=目标集合内 succeeded+skipped+cancelled 之和等于目标数。", z.toJSONSchema(z.strictObject({ canvasId: z.string().min(1).max(256).optional() }), { io: "input" }), async (input, target) => {
    const { canvasId } = z.strictObject({ canvasId: z.string().min(1).max(256).optional() }).parse(input);
    const { directory } = await resolveCanvasTarget(target);
    const { queueStatus } = await import("@/utils/canvas/queue");
    return queueStatus({ workspace: directory, canvasId });
  }));
  tools.push(wrapTool("queueLogs", "查询指定队列任务的日志与失败原因原文（如提示词被拒）；taskId 从 submitQueue 返回或 queueStatus 明细获取。", z.toJSONSchema(z.strictObject({ taskId: z.string().min(1).max(256) }), { io: "input" }), async (input) => {
    const { taskId } = z.strictObject({ taskId: z.string().min(1).max(256) }).parse(input);
    const { taskLogs } = await import("@/utils/canvas/queue");
    return taskLogs(taskId);
  }));
  tools.push(wrapTool("cancelQueue", "取消队列任务：按 taskId、nodeId 或全部（all=true）。进行中任务发出停止请求，排队任务直接移除；不删除已有产物。", z.toJSONSchema(z.strictObject({ taskId: z.string().min(1).max(256).optional(), nodeId: z.string().min(1).max(256).optional(), all: z.boolean().optional() }), { io: "input" }), async (input, target) => {
    const args = z.strictObject({ taskId: z.string().min(1).max(256).optional(), nodeId: z.string().min(1).max(256).optional(), all: z.boolean().optional() }).parse(input);
    const { directory } = await resolveCanvasTarget(target);
    const { cancelQueueTask, queueStatus } = await import("@/utils/canvas/queue");
    if (args.all) {
      const status = queueStatus({ workspace: directory });
      const pendingAll = status.tasks.filter(task => ["pending", "backoff", "running"].includes(task.status));
      let cancelled = 0;
      for (const task of pendingAll) cancelled += cancelQueueTask({ taskId: task.id }).cancelled;
      return { cancelled };
    }
    return cancelQueueTask({ taskId: args.taskId, nodeId: args.nodeId, workspace: directory });
  }));

  const canvasStub: CanvasContext = { id: "mcp", tools: [], async call() { throw new Error("尚未绑定画布"); } };
  // ACT: 插件损坏时仍保留应用管理工具，允许读取错误并修复插件。
  const definitions = await createAgentTools(dirname(conf.path), canvasStub).catch(error => {
    pluginError = error instanceof Error ? error.message : String(error);
    return [];
  });

  // 画布后端执行：canvas 工具插件注入的 context 不再转发页面，直接由 server 端
  // 操作画布文档（结构/配置/生成/状态全部 headless 可用，页面是否打开不影响）。
  function makeBackendCanvas(directory: string, connectionId?: string): CanvasContext {
    return {
      id: "mcp", tools: [],
      async call(request, callSignal) {
        const signal = callSignal ?? new AbortController().signal;
        // 页面动作（视口适配等）转发已打开的页面执行；其余操作走后端文档。
        const pageCall = connectionId
          ? (pageRequest: { name: string; args: Record<string, unknown> }, pageSignal: AbortSignal) => callControl(connectionId, pageRequest.name, pageRequest.args, pageSignal, directory)
          : undefined;
        const result = await applyCanvasOperation(directory, undefined, request, signal, pageCall);
        // 外部 Agent 用 workspaceDirectory 加结果中的相对路径定位生成文件。
        return result && typeof result === "object" && !Array.isArray(result)
          ? { ...result, workspaceDirectory: directory, ...(connectionId ? { connectionId } : {}) } : result;
      },
    };
  }

  for (const definition of definitions) {
    if (tools.some(tool => tool.name === definition.name)) throw new Error(`MCP 工具名称重复：${definition.name}`);
    tools.push(wrapTool(definition.name, [definition.description, ...(definition.promptGuidelines ?? [])].join("\n"), definition.parameters, async (args, target, signal) => {
      // 画布工具只需工作区目录：有页面连接时沿用其目录，否则要求 target.directory（headless 主路径）。
      const { connection, directory } = await resolveCanvasTarget(target);
      if (["write", "edit"].includes(definition.name) && typeof args.path === "string") assertFileNotOpen(directory!, args.path);
      const isCanvasPluginTool = canvasOperationNames.has(definition.name);
      const canvas = isCanvasPluginTool && directory ? makeBackendCanvas(directory, connection?.id) : undefined;
      const current = (await createAgentTools(directory!, canvas)).find(tool => tool.name === definition.name);
      if (!current) throw new Error("工具已禁用，或缺少工作区目标（target.directory），可先调用 getAppState 查看工作区");
      // ACT: 现有插件依赖 createTools 注入的宿主能力；MCP 没有 Pi 对话，访问会话能力时明确报错。
      const context = new Proxy({ cwd: directory, mode: "rpc", hasUI: false, model: undefined, signal }, {
        get(value, key) { if (Reflect.has(value, key)) return Reflect.get(value, key); throw new Error(`MCP 不提供内置 Agent 会话能力：${String(key)}`); },
      }) as unknown as ExtensionContext;
      return current.execute(crypto.randomUUID(), args, signal, undefined, context);
    }));
  }
  const fileSchema = z.strictObject({
    action: z.enum(["list", "mkdir", "rename", "remove", "readBinary", "writeBinary"]), path: z.string().max(4096).default(""),
    target: z.string().max(4096).optional(), recursive: z.boolean().default(false),
    base64: z.string().max(28_000_000).base64().optional(), exclusive: z.boolean().default(true),
  });
  tools.push(wrapTool("workspaceFiles", "列出、创建目录、重命名或删除工作区文件；readBinary/writeBinary通过base64传输不超过20MB的媒体，写入默认不覆盖。文本读写复用已启用的文件工具；打开中的画布或文档必须通过专门工具修改。", z.toJSONSchema(fileSchema, { io: "input" }), async (input, target, signal) => {
    const args = fileSchema.parse(input);
    const workspaceTool = (await listTools()).find(tool => tool.name === "workspace");
    if (!workspaceTool?.enabled || workspaceTool.loadError) throw new Error("工作区文件工具未启用或加载失败");
    if (!["list", "readBinary"].includes(args.action) && "readOnly" in workspaceTool.config && workspaceTool.config.readOnly === true) throw new Error("当前工作区文件工具为只读模式");
    const { directory } = await resolveTarget(target);
    const source = await resolveWorkspacePath(directory!, args.path);
    signal.throwIfAborted();
    if (args.action === "list") return (await readdir(source.path, { withFileTypes: true })).filter(item => item.isFile() || item.isDirectory()).map(item => ({ name: item.name, type: item.isDirectory() ? "directory" : "file" }));
    if (args.action === "readBinary") {
      const info = await stat(source.path);
      if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error("文件必须是不超过20MB的普通文件");
      return { path: args.path, base64: (await readFile(source.path, { signal })).toString("base64") };
    }
    protectWorkspaceRoot(directory!, source.path);
    assertFileNotOpen(directory!, args.path);
    const destination = args.action === "rename" && args.target ? await resolveWorkspacePath(directory!, args.target) : undefined;
    if (args.action === "rename" && !destination) throw new Error("重命名需要提供 args.target");
    if (destination) protectWorkspaceRoot(directory!, destination.path);
    const release = lockWorkspaceFiles([source.path, ...(destination ? [destination.path] : [])]);
    try {
      if (args.action === "writeBinary") {
        if (args.base64 === undefined) throw new Error("写入二进制文件需要 base64");
        const bytes = Buffer.from(args.base64, "base64");
        if (bytes.length > 20 * 1024 * 1024) throw new Error("文件不能超过20MB");
        await writeWorkspaceFile(source.path, bytes, args.exclusive);
      } else if (args.action === "mkdir") await mkdir(source.path);
      else if (destination) await renameWorkspaceFile(source.path, destination.path);
      else if ((await lstat(source.path)).isDirectory() && !args.recursive) await rmdir(source.path);
      else await rm(source.path, { recursive: args.recursive });
    } finally { release(); }
    return { success: true };
  }));
  tools.push(wrapTool("listAppOperations", "按需查询插件、媒体供应商、素材库和 Agent 历史管理操作及其参数。先查询 schema，再调用 appOperation。", z.toJSONSchema(z.strictObject({ name: z.string().optional() })), async args => {
    return appOperations.filter(item => !args.name || item.name === args.name).map(({ name, description, parameters, path }) => {
      const schema = z.toJSONSchema(parameters);
      if (path.startsWith("/api/agent/")) {
        delete schema.properties?.directory;
        schema.required = schema.required?.filter(key => key !== "directory");
      }
      return { name, description, parameters: schema };
    });
  }));
  tools.push(wrapTool("appOperation", "执行 listAppOperations 公布的应用管理操作，parameters 必须符合对应 schema。文件与节点操作使用专门工具；安装来源、覆盖和卸载须符合用户请求。", z.toJSONSchema(z.strictObject({ name: z.string(), parameters: z.record(z.string(), z.json()) })), async (args, target, signal) => {
    const operation = appOperations.find(item => item.name === args.name);
    if (!operation) throw new Error("应用操作不存在，请查询 listAppOperations");
    const parameters = { ...args.parameters as Record<string, unknown> };
    if (operation.path.startsWith("/api/agent/")) parameters.directory = (await resolveTarget(target)).directory;
    const result = await runAppOperation(operation.name, parameters, signal);
    const refreshErrors: string[] = [];
    if (operation.refresh) {
      const name = operation.refresh.nameField ? parameters[operation.refresh.nameField] : (result as { name?: string } | null)?.name;
      for (const connection of listConnections()) {
        try { await callControl(connection.id, "refreshResources", {
          type: operation.refresh.type, name,
          ...(operation.name === "deleteMediaProvider" ? { removedProviderId: (parameters.fileName as string).slice(0, -3) } : {}),
        }, signal); }
        catch (error) { refreshErrors.push(error instanceof Error ? error.message : String(error)); }
      }
    }
    return { result: redactSecrets(result), ...(refreshErrors.length ? { refreshErrors } : {}) };
  }));
  const runAgentSchema = z.strictObject({
    prompt: z.string().trim().min(1), providerId: z.string().min(1), modelId: z.string().min(1),
    sessionFile: z.string().regex(/^[\w-]+\.jsonl$/).optional(), thinkingLevel: z.enum(["off", "low", "medium", "high"]).optional(),
  });
  tools.push(wrapTool("runAgent", "按用户请求调用 Toonflow 内置 Agent，等待本轮完成并返回对话文件与回复；会使用配置的模型。外部 Agent 可直接操作其他工具，仅需要委托内置 Agent 时调用。支持 MCP 取消，历史保存到工作区。", z.toJSONSchema(runAgentSchema), async (input, target, signal) => {
    const args = runAgentSchema.parse(input);
    const { directory, connection } = await resolveTarget(target);
    const canvas: CanvasContext | undefined = connection ? {
      id: connection.state.canvasId ?? "mcp", tools: connection.state.tools,
      call: (request, callSignal) => callControl(connection.id, request.name, request.args, callSignal ?? signal, directory),
    } : undefined;
    const blocks = new Map<string, string>();
    let sessionFile = args.sessionFile;
    await runAgent({ ...args, cwd: directory!, canvas, signal }, event => {
      if (event.type === "session") sessionFile = event.file;
      if (event.type === "text") blocks.set(event.blockId, event.content ?? (blocks.get(event.blockId) ?? "") + (event.delta ?? ""));
    });
    return { sessionFile, text: [...blocks.values()].join("\n") };
  }));
  const askUserSchema = z.strictObject({
    title: z.string().max(200).optional(),
    question: z.string().min(1).max(4000),
    options: z.array(z.string().min(1).max(500)).max(10).optional(),
  });
  // 官方引擎（平台内 claude code）的提问通道：按 target.directory 路由到对应运行中对话，未带目录时取唯一活跃对话。
  tools.push(wrapTool("askUser", "向当前 Toonflow 用户提问并等待回答（界面弹出问答卡片）。需要用户确认、在多个方案间选择或补充信息时调用；用户不回答会一直阻塞，尽量提供 options 快捷选项。", z.toJSONSchema(askUserSchema), async (args, target, signal) => {
    const parsed = askUserSchema.parse(args);
    const directory = target.directory ? await resolveDirectory(target.directory) : undefined;
    const context = getClaudeQuestionContext(directory);
    if (!context) throw new Error("当前工作区没有运行中的官方引擎对话，无法提问");
    const request: QuestionRequest = { title: parsed.title ?? parsed.question.slice(0, 60), question: parsed.question, options: parsed.options };
    const answer = await context.ask(crypto.randomUUID(), request, signal);
    return { answer: answer.answer, values: answer.values, skipped: answer.skipped };
  }));
  return tools.map(tool => ({
    ...tool,
    execute(input, signal) {
      const requestSignal = AbortSignal.any([signal, authorizationSignal]);
      requestSignal.throwIfAborted();
      return tool.execute(input, requestSignal);
    },
  }));
}
