import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { generateCanvasReport } from "@/utils/canvas/report";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();

// 画布体检报告：拓扑 + 节点现状 + 异常检测（产物落盘实测），供外部 Agent 判断画布现状。
export default router.get("/", validateFields({ directory: z.string().min(1).max(4096), canvasId: z.string().min(1).max(256).optional() }, "query"), async (req, res) => {
  const directory = req.query.directory as string;
  await u.workspace.ensureWorkspaceDirectory(req, directory);
  res.json(success(await generateCanvasReport(directory, req.query.canvasId as string | undefined)));
});
