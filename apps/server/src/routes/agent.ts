import { Router } from "express";
import { z } from "zod";
import type { CanvasInfo } from "@toonflow/tools-scaffold/runtime";
import type { AgentEvent } from "@/agent/runtime/types";
import { validateFields } from "@/lib/middleware";
import u from "@/utils";

const inputSchema = z.object({
  prompt: z.string().trim(), directory: z.string().min(1),
  attachments: u.agent.agentAttachmentsSchema.optional(),
  // 引擎型供应商（providerId 命中内置引擎清单）走本地 CLI 分支；其余走内置 Agent，模型必填。
  providerId: z.string().min(1).optional(), modelId: z.string().min(1).optional(),
  thinkingLevel: z.enum(["off", "low", "medium", "high"]).optional(),
  sessionFile: z.string().regex(/^[\w-]+\.jsonl$/).optional(),
  resendFrom: z.string().min(1).max(128).optional(),
  canvas: z.strictObject({
    id: z.string().min(1).max(256),
    tools: z.array(z.strictObject({
      nodeId: z.string().min(1).max(256),
      name: z.string().max(101).regex(/^node:[a-z][a-zA-Z0-9]*$/),
      nodeLabel: z.string().max(200).optional(),
      description: z.string().max(4000),
      parameters: z.record(z.string(), z.json()).refine(value => value.type === "object", "函数参数必须是 object JSON Schema"),
    })).max(1000),
  }).optional(),
});

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  const { directory, canvas, providerId: providerIdRaw, ...options } = req.body as z.infer<typeof inputSchema>;
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  res.set({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = (event: AgentEvent) => {
    u.agent.trackAgentEvent(cwd, options.sessionFile, event);
    if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`);
  };
  if (providerIdRaw && u.ai.isEngineProvider(providerIdRaw)) {
    const engineKind = u.ai.getEngineKind(providerIdRaw);
    if (engineKind !== "claude-code") {
      send({ type: "error", message: "该引擎尚未接入，将在后续版本支持" });
      return void res.end();
    }
    // 官方引擎经 MCP 工具操作画布，不走前端画布桥；会话线性不支持重发历史。
    if (options.resendFrom) {
      send({ type: "error", message: "官方引擎会话不支持重发历史消息，请新建对话" });
      return void res.end();
    }
    const controller = new AbortController();
    const questions = u.question.createQuestionContext(cwd, send, () => controller.abort());
    const close = () => { questions.dispose(); controller.abort(); };
    res.once("close", close);
    try {
      await u.agent.runClaudeCode({ ...options, providerId: providerIdRaw, cwd, question: questions.context, signal: controller.signal }, send);
      send({ type: "done" });
    } catch (error) {
      send({ type: "error", message: error instanceof Error ? error.message : "Agent 运行失败" });
    } finally {
      res.off("close", close);
      questions.dispose();
      res.end();
    }
    return;
  }
  const providerId = providerIdRaw;
  const modelId = options.modelId;
  if (!providerId || !modelId) {
    send({ type: "error", message: "请先选择模型" });
    return void res.end();
  }
  const bridge = canvas ? u.canvas.createCanvasContext(cwd, canvas as CanvasInfo, send) : undefined;
  const controller = new AbortController();
  const questions = u.question.createQuestionContext(cwd, send, () => controller.abort());
  const close = () => { bridge?.dispose(); questions.dispose(); controller.abort(); };
  res.once("close", close);
  try {
    await u.agent.run({ ...options, providerId, modelId, cwd, canvas: bridge?.context, question: questions.context, signal: controller.signal }, send);
    send({ type: "done" });
  } catch (error) {
    send({ type: "error", message: error instanceof Error ? error.message : "Agent 运行失败" });
  } finally {
    res.off("close", close);
    bridge?.dispose();
    questions.dispose();
    res.end();
  }
});
