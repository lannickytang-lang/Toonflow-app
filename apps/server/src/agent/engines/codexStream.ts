import { StringDecoder } from "node:string_decoder";
import type { AgentEvent } from "@/agent/runtime/types";
import { isEngineQuestionTool } from "@/agent/engines/engineRuntime";

export type CodexUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };
type RawRecord = Record<string, unknown>;

function record(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
}

function display(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value ?? "");
}

function usageNumber(value: unknown) {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Codex 返回了无效的用量数据");
  return value;
}

export function createCodexStreamParser(onEvent: (event: AgentEvent) => void, onThread: (id: string) => void) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const state = {
    threadId: "", turnStarted: false, completed: false, failed: false, protocolError: "", error: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as CodexUsage,
  };

  function itemEvent(type: string, item: RawRecord) {
    if (typeof item.id !== "string" || !item.id) throw new Error("Codex item 缺少标识");
    const id = item.id;
    const done = type === "item.completed";
    if (item.type === "agent_message" || item.type === "reasoning") {
      if (typeof item.text === "string") onEvent({ type: item.type === "reasoning" ? "thinking" : "text", blockId: id, content: item.text, done });
      return;
    }
    let name: string;
    let args: Record<string, unknown>;
    let result: string;
    let failed = item.status === "failed" || Boolean(item.error);
    switch (item.type) {
      case "command_execution":
        name = "commandExecution";
        args = { command: item.command };
        result = display(item.aggregated_output);
        failed ||= typeof item.exit_code === "number" && item.exit_code !== 0;
        break;
      case "mcp_tool_call":
        name = `mcp__${String(item.server ?? "unknown")}__${String(item.tool ?? "unknown")}`;
        if (isEngineQuestionTool(name)) return;
        args = record(item.arguments);
        result = display(item.error ?? item.result);
        failed ||= record(item.result).isError === true;
        break;
      case "file_change":
        name = "fileChange";
        args = { changes: item.changes };
        result = display(item.changes);
        break;
      case "web_search":
        name = "webSearch";
        args = { query: item.query };
        result = display(item.action ?? item.query);
        break;
      case "todo_list":
        name = "plan";
        args = { items: item.items };
        result = display(item.items);
        break;
      case "error":
        state.error = typeof item.message === "string" ? item.message : "Codex 工具执行失败";
        return;
      default:
        return;
    }
    onEvent({ type: "tool", blockId: id, tool: { id, name, args, result, status: done ? failed ? "error" : "success" : "running" } });
  }

  function handle(line: string) {
    try {
      const event = record(JSON.parse(line));
      if (event.type === "thread.started") {
        if (typeof event.thread_id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(event.thread_id)) throw new Error("Codex 返回了无效的 thread ID");
        state.threadId = event.thread_id;
        onThread(event.thread_id);
      } else if (event.type === "turn.started") state.turnStarted = true;
      else if (event.type === "turn.completed") {
        const raw = record(event.usage);
        if (!state.turnStarted || !state.threadId || typeof raw.input_tokens !== "number" || typeof raw.output_tokens !== "number") throw new Error("Codex 完成事件缺少有效回合或用量信息");
        const input = usageNumber(raw.input_tokens);
        const cacheRead = usageNumber(raw.cached_input_tokens);
        if (cacheRead > input) throw new Error("Codex 缓存用量超过输入用量");
        state.usage = { input: input - cacheRead, cacheRead, output: usageNumber(raw.output_tokens), cacheWrite: 0 };
        state.completed = true;
      } else if (event.type === "turn.failed") {
        state.failed = true;
        state.error = typeof record(event.error).message === "string" ? String(record(event.error).message) : "Codex 本轮执行失败";
      } else if (event.type === "error") state.error = typeof event.message === "string" ? event.message : "Codex 执行错误";
      else if (["item.started", "item.updated", "item.completed"].includes(String(event.type))) itemEvent(String(event.type), record(event.item));
    } catch (error) {
      state.protocolError = error instanceof Error ? error.message : "Codex 事件解析失败";
    }
  }

  function drain() {
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) handle(line);
    }
  }

  return {
    state,
    feed(chunk: Buffer) { buffer += decoder.write(chunk); drain(); },
    end() { buffer += decoder.end(); drain(); if (buffer.trim()) handle(buffer.trim()); buffer = ""; },
  };
}
