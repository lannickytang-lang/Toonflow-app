import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { cancelQueueTask, queueStatus } from "@/utils/canvas/queue";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

const bodySchema = z.object({
  directory: z.string().min(1).max(4096).optional(),
  taskId: z.string().min(1).max(256).optional(),
  nodeId: z.string().min(1).max(256).optional(),
  all: z.boolean().optional(),
});

export default router.post("/", validateFields(bodySchema.shape), async (req, res) => {
  const { directory, taskId, nodeId, all } = bodySchema.parse(req.body);
  if (directory) await u.workspace.resolveWorkspace(req, directory);
  if (all) {
    const status = queueStatus({ workspace: directory });
    let cancelled = 0;
    for (const task of status.tasks.filter(task => ["pending", "backoff", "running"].includes(task.status))) {
      cancelled += cancelQueueTask({ taskId: task.id }).cancelled;
    }
    return res.json(success({ cancelled }));
  }
  if (!taskId && !nodeId) throw Object.assign(new Error("请提供 taskId 或 nodeId，或使用 all=true"), { status: 400 });
  res.json(success(cancelQueueTask({ taskId, nodeId, workspace: directory })));
});
