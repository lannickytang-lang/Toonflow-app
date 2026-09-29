import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { listCanvasFiles } from "@/utils/canvas/repository";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", validateFields({ directory: z.string().min(1).max(4096) }, "query"), async (req, res) => {
  const directory = req.query.directory as string;
  await u.workspace.ensureWorkspaceDirectory(req, directory);
  res.json(success(await listCanvasFiles(directory)));
});
