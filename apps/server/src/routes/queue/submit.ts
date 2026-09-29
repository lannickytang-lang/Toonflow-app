import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { submitCanvasQueue } from "@/utils/canvas/queue";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

const bodySchema = z.object({
  directory: z.string().min(1).max(4096),
  canvasId: z.string().min(1).max(256).optional(),
  scope: z.enum(["missing", "all", "nodes"]).default("missing"),
  nodeIds: z.array(z.string().min(1).max(256)).max(500).optional(),
  concurrency: z.number().int().min(1).max(20).optional(),
});

export default router.post("/", validateFields(bodySchema.shape), async (req, res) => {
  const { directory, canvasId, scope, nodeIds, concurrency } = bodySchema.parse(req.body);
  await u.workspace.ensureWorkspaceDirectory(req, directory);
  const result = await submitCanvasQueue(directory, canvasId, { type: scope, nodeIds }, { concurrency });
  res.json(success(result));
});
