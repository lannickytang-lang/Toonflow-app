import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { QuestionContext } from "@toonflow/tools-scaffold/runtime";
import type { z } from "zod";
import type { AgentEvent, AgentToolCall } from "@/agent/runtime/types";
import { agentAttachmentsSchema, createAgentConversation, getEngineInfo, registerAgentSession } from "@/agent/runtime/sessions";
import { claimEngineWorkspace, killProcessTree, registerEngineQuestions } from "@/agent/engines/engineRuntime";
import { buildCodexFirstPrompt, codexBootstrapWasSubmitted, prepareCodexEnvironment } from "@/agent/engines/codexEnv";
import { createCodexStreamParser } from "@/agent/engines/codexStream";
import { syncEngineSkills } from "@/agent/engines/skillLinks";
import { lockWorkspaceFiles, resolveWorkspacePath } from "@/utils/workspace/files";

export type CodexCodeOptions = {
  prompt: string; cwd: string; providerId: string; modelId?: string; sessionFile?: string;
  attachments?: z.infer<typeof agentAttachmentsSchema>; question?: QuestionContext; signal?: AbortSignal;
  codexReasoningEffort?: string;
};
type TurnPart = { type: "text"; text: string } | { type: "thinking"; thinking: string } | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

export async function runCodexCode({ prompt, cwd, providerId, modelId, sessionFile, attachments = [], question, signal, codexReasoningEffort }: CodexCodeOptions, publish: (event: AgentEvent) => void) {
  if (!prompt.trim() && !attachments.length) throw Object.assign(new Error("请输入消息或添加图片"), { status: 400 });
  const images: string[] = [];
  for (const attachment of attachments) {
    if (!attachment.mimeType.startsWith("image/")) throw Object.assign(new Error("官方引擎当前仅支持图片附件"), { status: 400 });
    const { path } = await resolveWorkspacePath(cwd, attachment.path);
    const info = await stat(path);
    if (!info.isFile() || !info.size || info.size > 100 * 1024 * 1024) throw Object.assign(new Error("附件必须是工作区内非空且不超过 100 MB 的文件"), { status: 400 });
    images.push(path);
  }
  signal?.throwIfAborted();
  const environment = await prepareCodexEnvironment(providerId, modelId, codexReasoningEffort);
  signal?.throwIfAborted();
  if (/\.(?:cmd|bat|ps1)$/i.test(environment.executable)) throw new Error("请配置 Codex 原生可执行文件路径，不能使用命令脚本");
  const releaseWorkspace = claimEngineWorkspace(cwd);
  let releaseSession: (() => void) | undefined;
  let unregister: (() => void) | undefined;
  let unregisterQuestions: (() => Promise<void>) | undefined;
  try {
    const { path: sessionsDir } = await resolveWorkspacePath(cwd, ".agent/sessions", true);
    const file = sessionFile ?? (await createAgentConversation(cwd)).file;
    const { path: sessionPath } = await resolveWorkspacePath(sessionsDir, file);
    if (!(await stat(sessionPath)).isFile()) throw new Error("会话必须是普通文件");
    releaseSession = lockWorkspaceFiles([sessionPath]);
    const history = SessionManager.open(sessionPath, sessionsDir, cwd);
    const engine = getEngineInfo(history);
    if (history.getBranch().some(entry => entry.type === "message") && engine?.engine !== "codex") throw Object.assign(new Error("该对话属于其他引擎，请新建对话后选择 Codex"), { status: 400 });
    let threadId = engine?.engine === "codex" ? engine.codexThreadId : undefined;
    let instructionsSent = engine?.codexInstructionsSent ?? Boolean(threadId);
    const { names, conflicts } = await syncEngineSkills(cwd, "codex");
    const parts = new Map<string, TurnPart>();
    const tools = new Map<string, AgentToolCall>();
    const results = new Map<string, { name: string; result: string; isError: boolean }>();
    const sanitize = (value: unknown): unknown => typeof value === "string" ? environment.redact(value)
      : Array.isArray(value) ? value.map(sanitize)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)])) : value;
    const send = (raw: AgentEvent) => {
      const event = sanitize(raw) as AgentEvent;
      if (event.type === "text") parts.set(event.blockId, { type: "text", text: event.content ?? ((parts.get(event.blockId) as { text?: string } | undefined)?.text ?? "") + (event.delta ?? "") });
      if (event.type === "thinking") parts.set(event.blockId, { type: "thinking", thinking: event.content ?? ((parts.get(event.blockId) as { thinking?: string } | undefined)?.thinking ?? "") + (event.delta ?? "") });
      if (event.type === "tool") {
        const tool = { ...tools.get(event.tool.id), ...event.tool };
        if (tool.status !== "running") delete tool.question;
        tools.set(tool.id, tool);
        parts.set(event.blockId, { type: "toolCall", id: tool.id, name: tool.name, arguments: tool.args ?? {} });
        if (tool.status !== "running") results.set(tool.id, { name: tool.name, result: tool.result ?? "", isError: tool.status !== "success" });
      }
      publish(event);
    };
    unregister = registerAgentSession(sessionPath, { history, send, tools, entryOffset: history.getEntries().length });
    unregisterQuestions = question ? registerEngineQuestions(cwd, question, send) : undefined;
    if (!engine) history.appendCustomEntry("toonflowEngine", { engine: "codex", codexInstructionsSent: false });
    history.appendModelChange(providerId, modelId || "default");
    history.appendCustomEntry("toonflowReasoning", { engine: "codex", effort: codexReasoningEffort || "" });
    const userId = history.appendMessage({ role: "user", content: prompt.trim(), timestamp: Date.now() });
    if (attachments.length) history.appendCustomEntry("toonflowAttachments", { messageId: userId, content: prompt.trim(), attachments });
    if (!history.getSessionName()) history.appendSessionInfo(prompt.trim().slice(0, 60) || attachments[0]?.name || "新对话");
    send({ type: "session", file: basename(sessionPath) });
    send({ type: "userMessage", id: userId, content: prompt.trim(), attachments });
    if (conflicts.length) send({ type: "text", blockId: "skillConflicts", content: `以下同名技能目录已保留，未由平台接管：${conflicts.join("、")}`, done: true });
    const deadline = Date.now() + environment.timeoutMs;
    let timedOut = false;
    async function execute(resumeId?: string) {
      const parser = createCodexStreamParser(send, id => {
        if (resumeId && id !== resumeId) throw new Error("Codex 续接返回了不同的原生会话，请重新打开对话");
        if (threadId !== id) history.appendCustomEntry("toonflowEngine", { engine: "codex", codexThreadId: id, codexInstructionsSent: instructionsSent });
        threadId = id;
      });
      const content = resumeId && instructionsSent ? prompt.trim() || "请查看附带的图片。" : buildCodexFirstPrompt(cwd, names, prompt.trim());
      const args = ["exec", ...(resumeId ? ["resume"] : []), ...environment.args, ...images.flatMap(path => ["--image", path]), ...(resumeId ? [resumeId] : []), "-"];
      return new Promise<{ state: typeof parser.state; code: number | null; stderr: string; spawnError: string }>(resolve => {
        const child = spawn(environment.executable, args, { cwd, env: environment.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
        let stderr = "";
        let spawnError = "";
        const abort = () => killProcessTree(child);
        const timer = setTimeout(() => { timedOut = true; abort(); }, Math.max(1, deadline - Date.now()));
        signal?.addEventListener("abort", abort, { once: true });
        child.stdout.on("data", (chunk: Buffer) => { parser.feed(chunk); if (parser.state.protocolError) abort(); });
        child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192); });
        for (const stream of [child.stdout, child.stderr]) stream.on("error", error => { spawnError = error.message; abort(); });
        child.stdin.on("error", error => { if (!signal?.aborted && !timedOut) spawnError = error.message; abort(); });
        child.on("error", (error: NodeJS.ErrnoException) => { spawnError = error.code === "ENOENT" ? "未找到 codex CLI，请安装或在设置中配置路径" : `Codex 启动失败：${error.message}`; });
        child.on("close", code => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          parser.end();
          resolve({ state: parser.state, code, stderr: environment.redact(stderr), spawnError: environment.redact(spawnError) });
        });
        if (signal?.aborted) abort();
        else child.stdin.end(content, "utf8");
      });
    }
    let outcome = await execute(threadId);
    if (threadId && !outcome.state.turnStarted && !outcome.state.threadId && !outcome.state.protocolError && outcome.code !== 0 && !signal?.aborted && !timedOut
      && outcome.stderr.includes(`no rollout found for thread id ${threadId}`)) {
      threadId = undefined;
      instructionsSent = false;
      history.appendCustomEntry("toonflowEngine", { engine: "codex", codexInstructionsSent: false });
      send({ type: "text", blockId: "sessionRestart", content: "原生 Codex 会话已不存在，已重新建立会话；此前的原生上下文无法续接。", done: true });
      outcome = await execute();
    }
    await unregisterQuestions?.();
    unregisterQuestions = undefined;
    if (threadId && !instructionsSent) {
      try {
        instructionsSent = outcome.state.completed || await codexBootstrapWasSubmitted(environment.env, threadId);
      } catch (error) {
        outcome.state.protocolError = `无法确认 Codex 首轮说明是否已提交：${error instanceof Error ? error.message : String(error)}`;
      }
      history.appendCustomEntry("toonflowEngine", { engine: "codex", codexThreadId: threadId, codexInstructionsSent: instructionsSent });
    }
    const failure = environment.redact(signal?.aborted ? "已停止生成" : timedOut ? "Codex 单轮运行超时" : outcome.spawnError || outcome.state.protocolError
      || (outcome.state.failed || !outcome.state.completed || outcome.code !== 0 ? outcome.state.error || `Codex 未正常完成本轮${outcome.stderr.trim() ? `：${outcome.stderr.trim().slice(-2000)}` : `（退出码 ${outcome.code}）`}` : ""));
    for (const tool of tools.values()) if (tool.status === "running") send({ type: "tool", blockId: tool.id, tool: { ...tool, status: "interrupted", result: failure || "工具未返回结果" } });
    const usage = outcome.state.usage;
    const total = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    history.appendMessage({
      role: "assistant", content: [...parts.values()], api: "openai-responses", provider: providerId,
      model: modelId || "default", usage: { ...usage, totalTokens: total, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: signal?.aborted || timedOut ? "aborted" : failure ? "error" : "stop", ...(failure ? { errorMessage: failure } : {}), timestamp: Date.now(),
    });
    for (const [id, result] of results) history.appendMessage({ role: "toolResult", toolCallId: id, toolName: result.name, content: [{ type: "text", text: result.result }], isError: result.isError, timestamp: Date.now() });
    send({ type: "stats", stats: { tokens: { ...usage, total } } });
    if (failure) throw new Error(failure);
  } finally {
    await unregisterQuestions?.();
    unregister?.();
    releaseSession?.();
    releaseWorkspace();
  }
}
