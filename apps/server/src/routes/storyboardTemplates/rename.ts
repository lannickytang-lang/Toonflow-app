import { Router } from "express";
import { z } from "zod";
import u from "@/utils/storyboardTemplates";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({ name: u.templateNameSchema, target: u.templateNameSchema }), async (req, res) => {
  res.json(success(await u.renameTemplate(req.body.name, req.body.target)));
});
