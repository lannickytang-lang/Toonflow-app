import { Router } from "express";
import { z } from "zod";
import u from "@/utils/storyboardTemplates";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({ name: u.templateNameSchema }), async (req, res) => {
  await u.deleteTemplate(req.body.name);
  res.json(success());
});
