import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// 密钥返回明文：配置中心模式下编辑对话框直接回显本机真实值供修改（本机单用户场景）。
export type ClaudeLocalEnv = { apiUrl: string; auth: string; model: string };

function claudeSettingsPath() {
  return join(homedir(), ".claude", "settings.json");
}

async function readClaudeConfig(): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(claudeSettingsPath(), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

// 读取本机 claude CLI 的全局配置（~/.claude/settings.json env 块）。
export async function readClaudeLocalEnv(): Promise<ClaudeLocalEnv> {
  const config = await readClaudeConfig();
  const env = config.env && typeof config.env === "object" && !Array.isArray(config.env) ? config.env as Record<string, unknown> : {};
  return {
    apiUrl: typeof env.ANTHROPIC_BASE_URL === "string" ? env.ANTHROPIC_BASE_URL : "",
    auth: typeof env.ANTHROPIC_AUTH_TOKEN === "string" ? env.ANTHROPIC_AUTH_TOKEN : "",
    model: typeof env.ANTHROPIC_MODEL === "string" ? env.ANTHROPIC_MODEL : "",
  };
}

// 配置中心模式：把平台引擎卡片保存的 key/地址合并写回本机 ~/.claude/settings.json。
// 只增删 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN 两个键，hooks、permissions 等其余内容原样保留；
// 写前滚动备份一份 .bak 防格式意外。apiUrl 空串 = 删除该键（回到官方默认）；apiKey 缺省 = 保留现值。
export async function writeClaudeLocalEnv(apiUrl: string, apiKey?: string): Promise<void> {
  const config = await readClaudeConfig();
  const env = config.env && typeof config.env === "object" && !Array.isArray(config.env) ? { ...(config.env as Record<string, unknown>) } : {};
  if (apiUrl) env.ANTHROPIC_BASE_URL = apiUrl;
  else delete env.ANTHROPIC_BASE_URL;
  if (apiKey !== undefined) {
    if (apiKey) env.ANTHROPIC_AUTH_TOKEN = apiKey;
    else delete env.ANTHROPIC_AUTH_TOKEN;
  }
  config.env = env;
  await copyFile(claudeSettingsPath(), `${claudeSettingsPath()}.bak`).catch(() => {});
  await writeFile(claudeSettingsPath(), JSON.stringify(config, null, 2) + "\n");
}
