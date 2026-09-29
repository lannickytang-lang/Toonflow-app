import { Router } from "express";
import { z } from "zod";
import { taskLogs } from "@/utils/canvas/queue";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", validateFields({ taskId: z.string().min(1).max(256) }, "query"), async (_req, res) => {
  res.json(success(taskLogs(_req.query.taskId as string)));
});
