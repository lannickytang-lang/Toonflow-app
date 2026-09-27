import { Router } from "express";
import { z } from "zod";
import u from "@/utils/storyboardTemplates";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  name: u.templateNameSchema,
  description: z.string().max(4000).default(""),
  script: z.string().min(1).max(1024 * 1024),
}), async (req, res) => {
  res.json(success(await u.saveTemplate(req.body.name, req.body.description, req.body.script)));
});
