import { Router } from "express";
import { z } from "zod";
import u from "@/utils/storyboardTemplates";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

export default Router().get("/", validateFields({ name: u.templateNameSchema }, "query"), async (req, res) => {
  res.json(success(await u.getTemplate(req.query.name as string)));
});
