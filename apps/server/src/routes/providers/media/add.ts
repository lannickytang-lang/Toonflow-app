import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success, error } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  source: z.string().min(1).max(2 * 1024 * 1024).optional(),
  url: z.string().url().max(4096).optional(),
}), async (req, res) => {
  const { source, url } = req.body as { source?: string; url?: string };
  if (url ? source !== undefined : source === undefined) {
    return res.status(400).json(error("提供 url 或 source，不能同时提供"));
  }
  res.json(success(url
    ? await u.pluginInstall.installRemotePlugin("provider", url)
    : await u.mediaProvider.addMediaProvider(source!)));
});
