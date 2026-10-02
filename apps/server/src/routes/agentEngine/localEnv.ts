import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { readClaudeLocalEnv, writeClaudeLocalEnv } from "@/utils/agentEngine";

const inputSchema = z.object({
  // 空串 = 删除本机 ANTHROPIC_BASE_URL（回到官方默认）。
  apiUrl: z.string().max(2048),
  // 缺省 = 保留本机现有密钥；空串 = 删除；非空 = 覆盖。
  apiKey: z.string().max(2048).optional(),
});

// 配置中心模式：把平台引擎卡片保存的 key/地址写回本机 ~/.claude/settings.json（合并写，其余内容保留）。
export default Router().put("/", validateFields(inputSchema.shape), async (req, res) => {
  const { apiUrl, apiKey } = req.body as z.infer<typeof inputSchema>;
  if (apiUrl && !/^https?:\/\//.test(apiUrl)) {
    throw Object.assign(new Error("API 地址必须是 http(s) 链接"), { status: 400 });
  }
  await writeClaudeLocalEnv(apiUrl, apiKey);
  res.json(success(await readClaudeLocalEnv()));
});
