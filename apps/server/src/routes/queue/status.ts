import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { queueStatus } from "@/utils/canvas/queue";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", validateFields({ directory: z.string().min(1).max(4096).optional(), canvasId: z.string().min(1).max(256).optional() }, "query"), async (req, res) => {
  const directory = req.query.directory as string | undefined;
  if (directory) await u.workspace.resolveWorkspace(req, directory);
  res.json(success(queueStatus({ workspace: directory, canvasId: req.query.canvasId as string | undefined })));
});
