import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";

// server 固定监听 3000（apps/server/src/index.ts），web 为 vite 默认端口 5173。
const devPorts = [3000, 5173];

function pidsOnPort(port: number): string[] {
  if (process.platform === "win32") {
    const output = spawnSync("netstat", ["-ano"], { encoding: "utf8" }).stdout ?? "";
    const pids = new Set<string>();
    for (const match of output.matchAll(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/gim)) {
      if (match[1] === String(port) && match[2] !== "0") pids.add(match[2]);
    }
    return [...pids];
  }
  const output = spawnSync("lsof", ["-ti", `:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout ?? "";
  return output.split("\n").filter(Boolean);
}

for (const port of devPorts) {
  for (const pid of pidsOnPort(port)) {
    console.log(`端口 ${port} 被占用，结束进程 ${pid}`);
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", pid, "/T", "/F"]);
    else spawnSync("kill", ["-9", pid]);
  }
}

if (!existsSync("node_modules")) {
  console.log("依赖未安装，执行 bun install ...");
  const installed = spawnSync(process.execPath, ["install"], { stdio: "inherit" });
  if (installed.status !== 0) process.exit(installed.status ?? 1);
}

spawn(process.execPath, ["run", "dev"], { stdio: "inherit" });
