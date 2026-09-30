import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().get("/", validateFields({
  id: z.string().min(1).max(96),
}, "query"), async (req, res) => {
  res.json(success({ html: await u.mediaProvider.readMediaProviderConfigHtml(req.query.id as string) }));
});
