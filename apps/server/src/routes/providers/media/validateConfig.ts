import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  id: z.string().min(1).max(96),
  config: z.record(z.string(), z.json()),
}), async (req, res) => {
  const { id, config } = req.body as { id: string; config: Record<string, unknown> };
  res.json(success(await u.mediaProvider.validateMediaProviderConfig(id, config)));
});
