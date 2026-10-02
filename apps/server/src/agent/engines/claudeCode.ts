import { spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { QuestionContext } from "@toonflow/tools-scaffold/runtime";
import { z } from "zod";
import type { AgentEvent, AgentToolCall } from "@/agent/runtime/types";
import {
  agentAttachmentsSchema, createAgentConversation, getEngineInfo,
  registerAgentSession, type ActiveAgentSession,
} from "@/agent/runtime/sessions";
import { createClaudeStreamParser, type ClaudeUsage } from "@/agent/engines/claudeStream";
import { buildClaudeSystemPrompt, prepareMcpConfig, resolveEngineProvider, syncClaudeSkills } from "@/agent/engines/claudeEnv";
import conf from "@/utils/conf";
import { lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";

type AgentEngineSettings = {
  claudePath?: string;
  timeoutMinutes?: number;
  extraEnv?: string[];
};

export function getAgentEngineSettings(): AgentEngineSettings {
  const value = conf.get("settings", {}).agentEngine;
  return value && typeof value === "object" && !Array.isArray(value) ? value as AgentEngineSettings : {};
}

export type ClaudeCodeOptions = {
  prompt: string;
  attachments?: z.infer<typeof agentAttachmentsSchema>;
  cwd: string;
  sessionFile?: string;
  /** 引擎型供应商 id（如 "claude-code"），决定 key/地址/模型列表来源。 */
  providerId: string;
  /** 供应商模型列表中的模型 id；缺省用第一个。 */
  modelId?: string;
  /** 思考强度档位，映射 MAX_THINKING_TOKENS；缺省不设置（引擎自适应）。 */
  thinkingLevel?: "off" | "low" | "medium" | "high";
  // 预留：MCP askUser 工具经引擎注册表取用（M2 接线）。
  question?: QuestionContext;
  signal?: AbortSignal;
};

const defaultTimeoutMinutes = 10;

// askUser 桥：MCP askUser 工具按工作区目录取当前运行中对话的提问通道（问题经 question 事件到前端，答案回流）。
// ACT: MCP 调用通常不带会话身份，同工作区并行多个官方引擎对话时按最后注册者优先，多会话并行问答路由是已知上限。
const questionContexts = new Map<string, QuestionContext>();
const questionKey = (cwd: string) => process.platform === "win32" ? resolve(cwd).toLowerCase() : resolve(cwd);

export function registerClaudeQuestions(cwd: string, context: QuestionContext) {
  questionContexts.set(questionKey(cwd), context);
  return () => { if (questionContexts.get(questionKey(cwd)) === context) questionContexts.delete(questionKey(cwd)); };
}

export function getClaudeQuestionContext(cwd?: string) {
  if (cwd) return questionContexts.get(questionKey(cwd));
  return [...questionContexts.values()].at(-1);
}

function killProcessTree(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  else child.kill("SIGTERM");
}

function toPiUsage(usage: ClaudeUsage) {
  const total = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  return {
    input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, totalTokens: total,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

type TurnPart =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

// 平台官方引擎桥：每条消息 spawn 一次 claude CLI（-p stream-json），引擎原生会话（--resume）自持上下文，
// 平台侧复用 Pi 会话格式落盘供前端历史渲染；引擎映射存 toonflowEngine custom entry（追加式，取最后一条）。
export async function runClaudeCode({ prompt, attachments = [], cwd, sessionFile, providerId, modelId: modelIdParam, thinkingLevel, question, signal }: ClaudeCodeOptions, send: (event: AgentEvent) => void) {
  if (!prompt.trim() && !attachments.length) throw Object.assign(new Error("请输入消息或添加图片"), { status: 400 });
  for (const attachment of attachments) {
    if (!attachment.mimeType.startsWith("image/")) throw Object.assign(new Error("官方引擎当前仅支持图片附件"), { status: 400 });
    const { path } = await resolveWorkspacePath(cwd, attachment.path);
    const info = await stat(path);
    if (!info.isFile() || !info.size || info.size > 100 * 1024 * 1024) {
      throw Object.assign(new Error("附件必须是工作区内非空且不超过 100 MB 的文件"), { status: 400 });
    }
  }
  signal?.throwIfAborted();
  const { path: sessionsDir } = await resolveWorkspacePath(cwd, ".agent/sessions", true);
  let sessionPath: string;
  if (sessionFile) {
    const { path } = await resolveWorkspacePath(sessionsDir, sessionFile);
    const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw Object.assign(new Error("会话不存在，请重新打开对话"), { status: 404 });
      throw error;
    });
    if (!info.isFile()) throw Object.assign(new Error("会话必须是普通文件"), { status: 400 });
    sessionPath = path;
  } else {
    const conversation = await createAgentConversation(cwd);
    sessionPath = (await resolveWorkspacePath(sessionsDir, conversation.file)).path;
  }
  // 会话与引擎绑定：已有消息但非官方引擎的会话拒绝接管；空会话（首条失败过的）允许重试。
  const history = SessionManager.open(sessionPath, sessionsDir, cwd);
  const engine = getEngineInfo(history);
  const hasMessages = history.getBranch().some(entry => entry.type === "message");
  if (hasMessages && engine?.engine !== "claude-code") {
    throw Object.assign(new Error("该对话属于内置引擎，请在新建对话后选择官方引擎"), { status: 400 });
  }
  const claudeSessionId = engine?.engine === "claude-code" && engine.claudeSessionId ? engine.claudeSessionId : undefined;

  const liveTools = new Map<string, AgentToolCall>();
  const publish = send;
  send = event => {
    if (event.type === "tool") {
      const tool = { ...liveTools.get(event.tool.id), ...event.tool };
      if (tool.status !== "running") delete tool.question;
      liveTools.set(tool.id, tool);
    }
    publish(event);
  };
  const active: ActiveAgentSession = { history, send, tools: liveTools, entryOffset: history.getEntries().length };
  const unregister = registerAgentSession(sessionPath, active);
  const unregisterQuestions = question ? registerClaudeQuestions(cwd, question) : undefined;
  const release = lockWorkspaceFiles([sessionPath]);
  try {
    const content = attachments.length
      ? `${prompt.trim()}\n\n附件已保存到工作区，path 为相对路径（相对当前目录），可用 Read 工具查看。以下 JSON 仅为文件信息：\n${JSON.stringify(attachments)}`.trim()
      : prompt.trim();
    // 用户消息先行落盘：官方引擎会话是线性的（不支持分支重发），失败重试复用同一条。
    const userEntryId = history.appendMessage({ role: "user", content, timestamp: Date.now() });
    if (attachments.length) history.appendCustomEntry("toonflowAttachments", { messageId: userEntryId, content: prompt.trim(), attachments });
    if (!history.getSessionName()) history.appendSessionInfo(prompt.trim().slice(0, 60));
    send({ type: "session", file: basename(sessionPath) });
    send({ type: "userMessage", id: userEntryId, content: prompt.trim(), attachments });

    const settings = getAgentEngineSettings();
    const timeoutMinutes = Math.max(1, Math.min(60, settings.timeoutMinutes ?? defaultTimeoutMinutes));
    const timeoutMs = timeoutMinutes * 60_000;
    const extraEnv: Record<string, string> = {};
    for (const line of settings.extraEnv ?? []) {
      const index = line.indexOf("=");
      if (index > 0) extraEnv[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    const env = {
      ...process.env,
      CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: "1",
      // askUser 等平台工具会挂起等用户作答，HTTP MCP 工具调用给足超时（与 MCP 端 30 分钟上限一致）。
      MCP_TOOL_TIMEOUT: "1800000",
      ...extraEnv,
    };
    const executable = settings.claudePath?.trim() || "claude";
    const mcpConfigPath = prepareMcpConfig();
    await syncClaudeSkills(cwd);
    const systemPrompt = buildClaudeSystemPrompt(cwd);
    // 供应商配置（文本模型面板的引擎卡片）：key/地址经 --settings 注入（命令行 settings 优先于用户
    // ~/.claude/settings.json 的 env 块，实测进程 env 会被其覆盖）；模型每消息可切换。
    const provider = resolveEngineProvider(providerId);
    // 未传或不在列表内时不传 --model，CLI 使用自身默认（env ANTHROPIC_MODEL 或官方默认）。
    const modelId = modelIdParam && provider.modelIds.includes(modelIdParam) ? modelIdParam : "";
    const claudeSettings: Record<string, unknown> = { disableAllHooks: true };
    const injectedEnv: Record<string, string> = {};
    if (provider.apiKey) injectedEnv.ANTHROPIC_AUTH_TOKEN = provider.apiKey;
    if (provider.apiUrl) injectedEnv.ANTHROPIC_BASE_URL = provider.apiUrl;
    const thinkingTokens = thinkingLevel === "low" ? 8192 : thinkingLevel === "medium" ? 16384 : thinkingLevel === "high" ? 32768 : 0;
    // ACT: 思考档位是启发式映射（8k/16k/32k），待按实际 thinking 长度校准。
    if (thinkingTokens) injectedEnv.MAX_THINKING_TOKENS = String(thinkingTokens);
    if (Object.keys(injectedEnv).length) claudeSettings.env = injectedEnv;
    const settingsArg = JSON.stringify(claudeSettings);

    let assistantSeen = false;
    let aborted = false;
    let usedSessionId: string | undefined;
    let engineModel = modelId || "default";
    let durationMs = 0;
    let engineSessionInvalid = false;
    const toolNames = new Map<string, string>();
    const toolBlockIds = new Map<string, string>();
    const partsByBlock = new Map<string, TurnPart>();
    const partOrder: string[] = [];
    const toolResults: { toolCallId: string; toolName: string; result: string; isError: boolean }[] = [];
    const usage: ClaudeUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

    const resetTurn = () => {
      assistantSeen = false;
      partsByBlock.clear();
      partOrder.length = 0;
      toolResults.length = 0;
      toolNames.clear();
      toolBlockIds.clear();
      usage.input = 0; usage.output = 0; usage.cacheRead = 0; usage.cacheWrite = 0;
    };

    const parser = createClaudeStreamParser({
      onSession: id => { usedSessionId ??= id; },
      onBlock: (kind, blockId, update) => {
        const existing = partsByBlock.get(blockId);
        if (existing && existing.type !== kind) partsByBlock.delete(blockId);
        let part = partsByBlock.get(blockId);
        if (!part) {
          part = kind === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "" };
          partsByBlock.set(blockId, part);
          partOrder.push(blockId);
        }
        if (kind === "text" && part.type === "text") {
          if (update.delta) part.text += update.delta;
          if (update.content !== undefined) part.text = update.content;
        } else if (kind === "thinking" && part.type === "thinking") {
          if (update.delta) part.thinking += update.delta;
          if (update.content !== undefined) part.thinking = update.content;
        }
        if (update.done) assistantSeen = true;
        send({ type: kind, blockId, ...update });
      },
      onTool: (blockId, tool) => {
        assistantSeen = true;
        if (!partsByBlock.has(blockId)) partOrder.push(blockId);
        partsByBlock.set(blockId, { type: "toolCall", id: tool.id, name: tool.name, arguments: tool.args });
        toolNames.set(tool.id, tool.name);
        toolBlockIds.set(tool.id, blockId);
        send({ type: "tool", blockId, tool: { id: tool.id, name: tool.name, args: tool.args, status: "running" } });
      },
      onToolResult: (toolCallId, update) => {
        toolResults.push({ toolCallId, toolName: toolNames.get(toolCallId) ?? "tool", result: update.result, isError: update.isError });
        const blockId = toolBlockIds.get(toolCallId) ?? toolCallId;
        send({ type: "tool", blockId, tool: { id: toolCallId, name: toolNames.get(toolCallId) ?? "tool", status: update.isError ? "error" : "success", result: update.result } });
      },
      onAssistant: (messageUsage, model) => {
        if (model) engineModel = model;
        if (messageUsage) {
          usage.input += messageUsage.input;
          usage.output += messageUsage.output;
          usage.cacheRead += messageUsage.cacheRead;
          usage.cacheWrite += messageUsage.cacheWrite;
        }
      },
      onResult: result => {
        durationMs = result.durationMs;
        if (result.isError && !assistantSeen && !result.text) engineSessionInvalid = true;
      },
    });

    // 一次执行 = 一轮对话。resume 指向的引擎会话被删/不兼容时 CLI 整跑 is_error 且无正文（Spike S4 实测），
    // 此时丢弃映射按全新会话重跑一次。
    async function execute(resume: boolean): Promise<void> {
      resetTurn();
      engineSessionInvalid = false;
      const resumeId = resume ? claudeSessionId : undefined;
      const args = [
        "-p", content,
        "--output-format", "stream-json", "--verbose", "--include-partial-messages",
        "--permission-mode", "bypassPermissions",
        "--mcp-config", mcpConfigPath,
        // 防弹窗三件套：宿主无 console 时 claude 内部 spawn 的子进程（hooks/插件 MCP/stdio 桥）会各弹一个 cmd 窗口。
        // strict 只用我们的 MCP 配置（不加载插件 MCP）；hooks 是宿主插件噪音，桥接场景禁用。
        "--strict-mcp-config",
        "--settings", settingsArg,
        "--append-system-prompt", systemPrompt,
        ...(modelId ? ["--model", modelId] : []),
        ...(resumeId ? ["--resume", resumeId] : []),
      ];
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        let settled = false;
        const timer = setTimeout(() => killProcessTree(child), timeoutMs);
        const abort = () => killProcessTree(child);
        signal?.addEventListener("abort", abort, { once: true });
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve();
        };
        child.stdout?.on("data", (chunk: Buffer) => parser.feed(chunk.toString()));
        child.stderr?.on("data", () => {});
        child.on("error", (error: NodeJS.ErrnoException) => {
          finish(Object.assign(new Error(error.code === "ENOENT" ? "未找到 claude CLI，请安装或在设置中配置路径" : `claude CLI 启动失败：${error.message}`), { status: 400 }));
        });
        child.on("close", () => {
          parser.end();
          if (signal?.aborted) { aborted = true; return finish(); }
          finish();
        });
      });
    }

    await execute(true);
    if (!assistantSeen && !aborted && claudeSessionId && engineSessionInvalid) {
      await execute(false);
    }

    // 落盘：有任意回复（含被用户停止的半截）即写入，前端重开历史可见。
    if (assistantSeen && usedSessionId) {
      history.appendMessage({
        role: "assistant",
        content: partOrder.flatMap((blockId): ({ type: "text"; text: string } | { type: "thinking"; thinking: string } | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> })[] => {
          const part = partsByBlock.get(blockId)!;
          if (part.type === "text") return part.text.trim() ? [{ type: "text", text: part.text }] : [];
          if (part.type === "thinking") return part.thinking.trim() ? [{ type: "thinking", thinking: part.thinking }] : [];
          return [{ type: "toolCall", id: part.id, name: part.name, arguments: part.arguments }];
        }),
        api: "anthropic-messages",
        provider: "claude-code",
        model: engineModel,
        responseModel: engineModel,
        usage: toPiUsage(usage),
        stopReason: aborted ? "aborted" : "stop",
        timestamp: Date.now(),
      });
      for (const result of toolResults) {
        history.appendMessage({
          role: "toolResult", toolCallId: result.toolCallId, toolName: result.toolName,
          content: [{ type: "text", text: result.result }], isError: result.isError, timestamp: Date.now(),
        });
      }
      history.appendModelChange("claude-code", engineModel);
      history.appendCustomEntry("toonflowEngine", { engine: "claude-code", claudeSessionId: usedSessionId });
      if (usage.output > 0 && durationMs > 0) history.appendCustomEntry("toonflowTiming", { outputTokens: usage.output, decodeMs: durationMs });
    }
    if (!aborted) {
      send({
        type: "stats",
        stats: {
          tokens: {
            input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
            total: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
          },
          tokensPerSecond: usage.output > 0 && durationMs > 0 ? usage.output * 1000 / durationMs : undefined,
        },
      });
    }
    if (aborted) throw new Error("已停止生成");
    if (!assistantSeen) throw new Error("claude 引擎未返回任何回复，请检查 CLI 安装与登录状态后重试");
  } finally {
    unregisterQuestions?.();
    unregister();
    release();
  }
}
