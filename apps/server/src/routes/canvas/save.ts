import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { saveCanvasDocument } from "@/utils/canvas/repository";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

const bodySchema = z.object({
  directory: z.string().min(1).max(4096),
  canvasId: z.string().min(1).max(256),
  revision: z.number().int().nonnegative(),
  document: z.object({
    toonflowCanvas: z.literal(true),
    nodes: z.array(z.record(z.string(), z.json())),
    edges: z.array(z.record(z.string(), z.json())),
    viewport: z.record(z.string(), z.json()).optional(),
  }),
});

// 页面画布保存统一入口：revision 乐观锁防止页面旧内存覆盖 AI 的后端写入；冲突返回 409。
export default router.post("/", validateFields(bodySchema.shape), async (req, res) => {
  const { directory, canvasId, revision, document } = bodySchema.parse(req.body);
  await u.workspace.resolveWorkspace(req, directory);
  const { revision: nextRevision } = await saveCanvasDocument(directory, canvasId, document, revision);
  res.json(success({ revision: nextRevision }));
});
