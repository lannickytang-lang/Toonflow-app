import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { getAgentEngineSettings, getEngineEnvironment, killProcessTree } from "@/agent/engines/engineRuntime";
import { readClaudeLocalEnv } from "@/utils/agentEngine";

type EngineModels = { models: { id: string; label: string; reasoningEfforts?: string[]; defaultReasoningEffort?: string }[]; defaultModel: string; error?: string };
const catalogSchema = z.object({ models: z.array(z.object({ slug: z.string().min(1).max(256), display_name: z.string().optional(), visibility: z.string().optional(), default_reasoning_level: z.string().optional(), supported_reasoning_levels: z.array(z.object({ effort: z.string() })).optional() })) });
let cached: { key: string; expires: number; pending: Promise<EngineModels> } | undefined;

export function getCodexModels(): Promise<EngineModels> {
  const settings = getAgentEngineSettings();
  const key = JSON.stringify(settings);
  if (cached?.key === key && cached.expires > Date.now()) return cached.pending;
  const env = getEngineEnvironment(settings);
  const pending = (async () => {
    let defaultModel = "";
    let configError = "";
    try {
      const path = join(env.CODEX_HOME || join(env.USERPROFILE || env.HOME || homedir(), ".codex"), "config.toml");
      const config = Bun.TOML.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      const profiles = config.profiles as Record<string, Record<string, unknown>> | undefined;
      const model = (typeof config.profile === "string" ? profiles?.[config.profile]?.model : undefined) ?? config.model;
      if (typeof model === "string") defaultModel = model;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") configError = "无法读取 Codex 本机默认模型配置";
    }
    const models: EngineModels["models"] = [];
    let error = configError;
    try {
      const executable = settings.codexPath?.trim() || "codex";
      if (/\.(?:cmd|bat|ps1)$/i.test(executable)) throw new Error("请配置 Codex 原生可执行文件路径");
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(executable, ["debug", "models"], { env, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
        const chunks: Buffer[] = [];
        let size = 0;
        const timer = setTimeout(() => { killProcessTree(child); reject(new Error("读取 Codex 模型目录超时")); }, 15_000);
        child.stdout.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) { killProcessTree(child); reject(new Error("Codex 模型目录超过大小限制")); }
          else chunks.push(chunk);
        });
        child.stdout.on("error", () => { killProcessTree(child); reject(new Error("读取 Codex 模型目录失败")); });
        child.on("error", () => { clearTimeout(timer); reject(new Error("无法启动 Codex，请检查 CLI 路径")); });
        child.on("close", code => {
          clearTimeout(timer);
          if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
          else reject(new Error("Codex 模型目录读取失败，请检查本机配置及 CLI 版本"));
        });
      });
      for (const model of catalogSchema.parse(JSON.parse(output)).models) {
        if (model.visibility && model.visibility !== "list") continue;
        if (!models.some(item => item.id === model.slug)) models.push({ id: model.slug, label: model.display_name || model.slug, reasoningEfforts: model.supported_reasoning_levels?.map(level => level.effort), defaultReasoningEffort: model.default_reasoning_level });
      }
    } catch (cause) { error = cause instanceof Error ? cause.message : "读取 Codex 模型目录失败"; }
    if (defaultModel && !models.some(model => model.id === defaultModel)) models.unshift({ id: defaultModel, label: defaultModel });
    return { models, defaultModel, ...(error ? { error } : {}) };
  })();
  // ACT: 只缓存一分钟的本机目录，避免每个下拉或发送重复启动 CLI；不把目录当作调用权限证明。
  cached = { key, expires: Date.now() + 60_000, pending };
  return pending;
}

export async function getEngineModels() {
  const [codex, claude] = await Promise.all([getCodexModels(), readClaudeLocalEnv()]);
  return { codex, "claude-code": { models: claude.model ? [{ id: claude.model, label: claude.model }] : [], defaultModel: claude.model } };
}
