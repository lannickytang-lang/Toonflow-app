import { Router } from "express";
import { spawn } from "node:child_process";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { readClaudeLocalEnv } from "@/utils/agentEngine";

function probe(executable: string, name: string) {
  return new Promise<{ executable: string; found: boolean; version?: string; error?: string }>(resolve => {
    const child = spawn(executable, ["--version"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ executable, found: false, error: "探测超时，请确认 CLI 可执行" });
    }, 10_000);
    child.stdout?.on("data", (chunk: Buffer) => { out = (out + chunk.toString()).slice(-8192); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ executable, found: false, error: error.code === "ENOENT" ? `未找到 ${name} CLI，请先安装或配置完整路径` : error.message });
    });
    child.on("close", code => {
      clearTimeout(timer);
      const version = out.trim().split(/\r?\n/).find(line => /\d+\.\d+\.\d+/.test(line));
      if (code === 0 && version) resolve({ executable, found: true, version });
      else resolve({ executable, found: false, error: stderr.trim() || out.trim() || `退出码 ${code}` });
    });
  });
}

// 仅探测安装版本，不触发模型调用。Claude 顶层字段保留，Codex 为新增字段。
export default Router().get("/", async (req, res) => {
  const settings = u.agent.getAgentEngineSettings();
  const [cli, codex, localEnv] = await Promise.all([
    probe(settings.claudePath?.trim() || "claude", "claude"),
    probe(settings.codexPath?.trim() || "codex", "codex"),
    readClaudeLocalEnv(),
  ]);
  res.json(success({ ...cli, codex, localEnv }));
});
