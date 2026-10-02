import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import type { QuestionContext, QuestionRequest } from "@toonflow/tools-scaffold/runtime";
import type { AgentEvent } from "@/agent/runtime/types";
import conf from "@/utils/conf";

export type AgentEngineSettings = {
  claudePath?: string;
  codexPath?: string;
  timeoutMinutes?: number;
  extraEnv?: string[];
};

export function getAgentEngineSettings(): AgentEngineSettings {
  const value = conf.get("settings", {}).agentEngine;
  return z.object({ claudePath: z.string().optional(), codexPath: z.string().optional(), timeoutMinutes: z.number().optional(), extraEnv: z.array(z.string()).optional() }).parse(value ?? {});
}

export function getEngineEnvironment(settings: AgentEngineSettings, defaults: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env, ...defaults };
  for (const line of settings.extraEnv ?? []) {
    if (typeof line !== "string") continue;
    const index = line.indexOf("=");
    if (index > 0) env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return env;
}

export function getEngineTimeout(settings: AgentEngineSettings) {
  const minutes = typeof settings.timeoutMinutes === "number" && Number.isFinite(settings.timeoutMinutes) ? settings.timeoutMinutes : 10;
  return Math.max(1, Math.min(60, minutes)) * 60_000;
}

const runningWorkspaces = new Set<string>();
const questionContexts = new Map<string, { context: QuestionContext; send: (event: AgentEvent) => void; controller: AbortController; pending: Set<Promise<void>> }>();
const workspaceKey = (cwd: string) => process.platform === "win32" ? resolve(cwd).toLowerCase() : resolve(cwd);

// ACT: HTTP MCP 没有回合身份；同工作区只允许一个官方引擎回合，后续并行需增加调用身份绑定。
export function claimEngineWorkspace(cwd: string) {
  const key = workspaceKey(cwd);
  if (runningWorkspaces.has(key)) throw Object.assign(new Error("当前工作区已有官方引擎正在运行，请等待完成或停止后重试"), { status: 409 });
  runningWorkspaces.add(key);
  return () => runningWorkspaces.delete(key);
}

export function registerEngineQuestions(cwd: string, context: QuestionContext, send: (event: AgentEvent) => void) {
  const key = workspaceKey(cwd);
  const value = { context, send, controller: new AbortController(), pending: new Set<Promise<void>>() };
  questionContexts.set(key, value);
  return async () => {
    if (questionContexts.get(key) === value) questionContexts.delete(key);
    value.controller.abort();
    await Promise.allSettled([...value.pending]);
  };
}

export function isEngineQuestionTool(name: string) {
  return name === "mcp__toonflow__askUser";
}

export async function askEngineQuestion(cwd: string | undefined, request: QuestionRequest, signal: AbortSignal) {
  const value = cwd ? questionContexts.get(workspaceKey(cwd)) : questionContexts.size === 1 ? [...questionContexts.values()][0] : undefined;
  if (!value) throw new Error(cwd ? "当前工作区没有运行中的官方引擎对话，无法提问" : "请指定 target.directory，当前不存在唯一的官方引擎对话");
  const questionSignal = AbortSignal.any([signal, value.controller.signal]);
  questionSignal.throwIfAborted();
  const id = `question:${crypto.randomUUID()}`;
  const tool = { id, name: "askUser", args: { ...request } };
  value.send({ type: "tool", blockId: id, tool: { ...tool, status: "running" } });
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  value.pending.add(pending);
  try {
    const answer = await value.context.ask(id, request, questionSignal);
    value.send({ type: "tool", blockId: id, tool: { ...tool, status: "success", result: JSON.stringify(answer) } });
    return answer;
  } catch (error) {
    value.send({ type: "tool", blockId: id, tool: { ...tool, status: questionSignal.aborted ? "interrupted" : "error", result: error instanceof Error ? error.message : String(error) } });
    throw error;
  } finally { value.pending.delete(pending); finish(); }
}

export function killProcessTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
  } else child.kill("SIGTERM");
}
