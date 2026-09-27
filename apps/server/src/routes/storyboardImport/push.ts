import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { broadcastStoryboardImport } from "@/utils/storyboardImport/events";

const payloadSchema = z.strictObject({
  assets: z.array(z.strictObject({
    name: z.string().min(1).max(256),
    imagePrompt: z.string().max(8000).default(""),
    filePath: z.string().max(1024).default(""),
    videoPath: z.string().max(1024).default(""),
  })).max(500).default([]),
  scenes: z.array(z.strictObject({
    sortNum: z.number().int().min(1).default(1),
    videoPrompt: z.string().min(1).max(16000),
    cast: z.array(z.string().min(1).max(256)).max(50).default([]),
  })).max(500).default([]),
});

export default Router().post("/", validateFields(payloadSchema.shape), async (req, res) => {
  const delivered = broadcastStoryboardImport(req.body);
  res.json(success({ delivered }));
});
