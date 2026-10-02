import type { AgentEvent } from "@/agent/runtime/types";

export type ClaudeUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type ClaudeStreamHandlers = {
  onSession(sessionId: string): void;
  onBlock(kind: "text" | "thinking", blockId: string, update: { content?: string; delta?: string; done?: boolean }): void;
  onTool(blockId: string, tool: { id: string; name: string; args: Record<string, unknown> }): void;
  onToolResult(toolCallId: string, update: { isError: boolean; result: string }): void;
  onAssistant(usage: ClaudeUsage | undefined, model: string): void;
  onResult(result: { isError: boolean; text: string; usage: ClaudeUsage | undefined; sessionId: string; durationMs: number }): void;
};

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {};
}

function toUsage(value: unknown): ClaudeUsage | undefined {
  const raw = asRecord(value);
  if (!raw.input_tokens && !raw.output_tokens) return undefined;
  return {
    input: Number(raw.input_tokens ?? 0),
    output: Number(raw.output_tokens ?? 0),
    cacheRead: Number(raw.cache_read_input_tokens ?? 0),
    cacheWrite: Number(raw.cache_creation_input_tokens ?? 0),
  };
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      const record = asRecord(part);
      return typeof record.text === "string" ? record.text : `[${String(record.type ?? "unknown")}]`;
    }).join("\n");
  }
  return "";
}

type StreamBlock = { kind: "text" | "thinking" | "tool"; blockId: string; text: string; args?: Record<string, unknown> };

// claude CLI stream-json 逐行解析（2.1.286 实测协议，见 .omc/plans/agentBridgeDecisions.md）：
// - stream_event 的 content_block 索引与 assistant 消息 content 数组不一致（thinking 不进数组，索引前移），
//   故 blockId 统一由 content_block_start 的原始索引分配；text/thinking 的权威内容用增量累积、
//   content_block_stop 时带全量收口；assistant 事件只负责 tool_use 的完整入参（按序匹配）。
// - 无 --include-partial-messages 的退化模式（blocks 为空）由 assistant 事件按数组索引整块补发。
// - system:init 捕获 session_id；hook_started 等噪音按 subtype 过滤。
export function createClaudeStreamParser(handlers: ClaudeStreamHandlers) {
  let buffer = "";
  let messageIndex = 0;
  let blocks = new Map<number, StreamBlock>();
  let toolBlocks: StreamBlock[] = [];

  function resetMessage() {
    blocks = new Map();
    toolBlocks = [];
  }

  function handleEvent(line: string) {
    let event: RawRecord;
    try { event = JSON.parse(line) as RawRecord; } catch { return; }
    const type = event.type;
    if (type === "system") {
      if (event.subtype === "init" && typeof event.session_id === "string") handlers.onSession(event.session_id);
      return;
    }
    if (type === "stream_event") {
      const inner = asRecord(event.event);
      if (inner.type === "message_start") { messageIndex++; resetMessage(); return; }
      if (inner.type === "content_block_start") {
        const block = asRecord(inner.content_block);
        const index = Number(inner.index ?? 0);
        const blockId = `${messageIndex}:${index}`;
        if (block.type === "text" || block.type === "thinking") {
          blocks.set(index, { kind: block.type, blockId, text: "" });
          handlers.onBlock(block.type, blockId, { content: "" });
        } else if (block.type === "tool_use" && typeof block.id === "string") {
          const streamBlock: StreamBlock = { kind: "tool", blockId, text: "", args: asRecord(block.input) };
          blocks.set(index, streamBlock);
          toolBlocks.push(streamBlock);
        }
        return;
      }
      if (inner.type === "content_block_delta") {
        const streamBlock = blocks.get(Number(inner.index ?? 0));
        if (!streamBlock) return;
        const delta = asRecord(inner.delta);
        if (delta.type === "text_delta" && typeof delta.text === "string" && streamBlock.kind === "text") {
          streamBlock.text += delta.text;
          handlers.onBlock("text", streamBlock.blockId, { delta: delta.text });
        } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && streamBlock.kind === "thinking") {
          streamBlock.text += delta.thinking;
          handlers.onBlock("thinking", streamBlock.blockId, { delta: delta.thinking });
        }
        return;
      }
      if (inner.type === "content_block_stop") {
        const streamBlock = blocks.get(Number(inner.index ?? 0));
        if (streamBlock && (streamBlock.kind === "text" || streamBlock.kind === "thinking")) {
          handlers.onBlock(streamBlock.kind, streamBlock.blockId, { content: streamBlock.text, done: true });
        }
        return;
      }
      return;
    }
    if (type === "assistant") {
      const message = asRecord(event.message);
      const content = Array.isArray(message.content) ? message.content : [];
      if (blocks.size) {
        // 流式模式：text/thinking 已由 content_block_stop 收口，这里只补 tool_use 完整入参。
        content.forEach(raw => {
          const part = asRecord(raw);
          if (part.type !== "tool_use" || typeof part.id !== "string") return;
          const streamBlock = toolBlocks.shift();
          if (streamBlock) handlers.onTool(streamBlock.blockId, { id: part.id, name: String(part.name ?? ""), args: asRecord(part.input) });
        });
      } else {
        // 退化模式（无增量事件）：按数组索引整块补发。
        content.forEach((raw, index) => {
          const part = asRecord(raw);
          const blockId = `${messageIndex}:${index}`;
          if (part.type === "text" && typeof part.text === "string") handlers.onBlock("text", blockId, { content: part.text, done: true });
          else if (part.type === "thinking" && typeof part.thinking === "string") handlers.onBlock("thinking", blockId, { content: part.thinking, done: true });
          else if (part.type === "tool_use" && typeof part.id === "string") handlers.onTool(blockId, { id: part.id, name: String(part.name ?? ""), args: asRecord(part.input) });
        });
      }
      handlers.onAssistant(toUsage(message.usage), String(message.model ?? ""));
      return;
    }
    if (type === "user") {
      const content = asRecord(event.message).content;
      if (!Array.isArray(content)) return;
      for (const raw of content) {
        const part = asRecord(raw);
        if (part.type !== "tool_result" || typeof part.tool_use_id !== "string") continue;
        handlers.onToolResult(part.tool_use_id, { isError: Boolean(part.is_error), result: toolResultText(part.content) });
      }
      return;
    }
    if (type === "result") {
      handlers.onResult({
        isError: Boolean(event.is_error),
        text: typeof event.result === "string" ? event.result : "",
        usage: toUsage(event.usage),
        sessionId: typeof event.session_id === "string" ? event.session_id : "",
        durationMs: Number(event.duration_ms ?? 0),
      });
    }
  }

  return {
    feed(chunk: string) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) handleEvent(line);
    },
    end() {
      if (buffer.trim()) handleEvent(buffer);
      buffer = "";
    },
  };
}

export type ClaudeEngineEvent = Extract<AgentEvent, { type: "text" | "thinking" | "tool" }>;
