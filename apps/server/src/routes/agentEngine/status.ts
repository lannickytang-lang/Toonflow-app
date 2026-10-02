import { Router } from "express";
import { spawn } from "node:child_process";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { readClaudeLocalEnv } from "@/utils/agentEngine";

// 官方引擎（claude code）CLI 探测：供设置面板"测试"使用，只跑 --version，不做对话。
export default Router().get("/", async (req, res) => {
  const settings = u.agent.getAgentEngineSettings();
  const executable = settings.claudePath?.trim() || "claude";
  const [cli, localEnv] = await Promise.all([
    new Promise<{ found: boolean; version?: string; error?: string }>(resolve => {
      const child = spawn(executable, ["--version"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      const timer = setTimeout(() => {
        child.kill();
        resolve({ found: false, error: "探测超时，请确认 CLI 可执行" });
      }, 10_000);
      child.stdout?.on("data", (chunk: Buffer) => { out += chunk.toString(); });
      child.stderr?.on("data", (chunk: Buffer) => { out += chunk.toString(); });
      child.on("error", (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        resolve({ found: false, error: error.code === "ENOENT" ? "未找到 claude CLI，请先安装，或在下方填写完整路径" : error.message });
      });
      child.on("close", code => {
        clearTimeout(timer);
        const version = out.trim().split("\n")[0];
        if (code === 0 && version) resolve({ found: true, version });
        else resolve({ found: false, error: out.trim() || `退出码 ${code}` });
      });
    }),
    readClaudeLocalEnv(),
  ]);
  res.json(success({ executable, ...cli, localEnv }));
});
