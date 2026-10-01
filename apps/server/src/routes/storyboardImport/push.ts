import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { broadcastStoryboardImport } from "@/utils/storyboardImport/events";

const payloadSchema = z.strictObject({
  // 非标准字段不拦截：额外键随弹框透传，最终由导入实现归集进视频节点 data.tags。
  assets: z.array(z.object({
    name: z.string().min(1).max(256),
    imagePrompt: z.string().max(8000).default(""),
    filePath: z.string().max(1024).default(""),
    videoPath: z.string().max(1024).default(""),
  }).catchall(z.json())).max(500).default([]),
  scenes: z.array(z.object({
    sortNum: z.number().int().min(1).default(1),
    videoPrompt: z.string().min(1).max(16000),
    cast: z.array(z.string().min(1).max(256)).max(50).default([]),
  }).catchall(z.json())).max(500).default([]),
});

export default Router().post("/", validateFields(payloadSchema.shape), async (req, res) => {
  const delivered = broadcastStoryboardImport(req.body);
  res.json(success({ delivered }));
});
