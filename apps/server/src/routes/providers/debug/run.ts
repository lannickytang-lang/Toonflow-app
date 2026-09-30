import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";

export default Router().post("/", validateFields({
  ...u.providerDebug.providerDebugSchema,
  request: z.record(z.string(), z.json()),
  mock: u.providerDebug.providerDebugMockSchema.optional(),
}), async (req, res) => {
  res.set({ "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const controller = new AbortController();
  const close = () => controller.abort();
  res.once("close", close);
  const send = (event: Record<string, unknown>) => { if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
  try {
    // validateFields 只校验不写回；样例缺省字段（times/status 等）在此显式规范化。
    const mock = req.body.mock === undefined ? undefined : u.providerDebug.providerDebugMockSchema.parse(req.body.mock);
    await u.providerDebug.runProviderSource(req.body.source, req.body.config ?? {}, req.body.request, AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60_000)]), send, mock);
    send({ type: "done" });
  } finally {
    res.off("close", close);
    res.end();
  }
});
