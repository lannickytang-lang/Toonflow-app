import { Router } from "express";
import { z } from "zod";
import { readCanvasDocument } from "@/utils/canvas/repository";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

// 页面外部变更检测：轮询画布 revision，发现 AI 后端写入后提示用户重载。
export default router.get("/", validateFields({ directory: z.string().min(1).max(4096), canvasId: z.string().min(1).max(256) }, "query"), async (req, res) => {
  const { revision } = await readCanvasDocument(req.query.directory as string, req.query.canvasId as string);
  res.json(success({ revision }));
});
