import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

// server 固定监听 47392（apps/server/src/index.ts），web 为 vite 默认端口 5173。
const devPorts = [47392, 5173, ...Array.from({ length: 12 }, (_, index) => 10588 + index)];

// 用法：bun scripts/restartDev.ts [desktop]；传入 desktop 时以桌面窗口调试模式启动。
const desktopMode = process.argv[2] === "desktop";
if (process.argv.length > 3 || (process.argv[2] && !desktopMode)) {
  throw new Error("用法：bun scripts/restartDev.ts [desktop]");
}

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

if (desktopMode) {
  // 桌面调试：主进程内嵌 server 并加载构建后的前端，插件、web、mcp 构建与 electrobun 启动统一走 desktop dev 流程。
  console.log("桌面调试模式：构建并启动桌面窗口（前端为构建产物，改动源码后需重新运行）...");
  const desktop = spawnSync(process.execPath, ["run", "--filter", "@toonflow/desktop", "dev"], { stdio: "inherit" });
  process.exit(desktop.status ?? 0);
}

// 每次全量构建并刷新插件：改完源码重启即生效，不依赖 data/ 旧状态。
console.log("全量构建插件（tools / nodes）...");
const built = spawnSync(process.execPath, ["run", "dev:plugins"], { stdio: "inherit" });
if (built.status !== 0) process.exit(built.status ?? 1);

// 技能与供应商无构建产物，直接以源码覆盖安装态；供应商白名单复用 app.ts 的单一事实源。
function refresh(source: string, target: string, filter: (name: string, isFile: boolean) => boolean, label: string) {
  if (!existsSync(source)) return;
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!filter(entry.name, entry.isFile())) continue;
    rmSync(resolve(target, entry.name), { recursive: true, force: true });
    cpSync(resolve(source, entry.name), resolve(target, entry.name), { recursive: true });
  }
  console.log(`${label}已刷新为源码最新`);
}
const providerWhitelist = [...(readFileSync("apps/server/src/app.ts", "utf8").match(/autoInstallProviders\s*=\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(match => match[1]);
refresh("packages/skills", "data/skills", (_name, isFile) => !isFile, "技能");
refresh("packages/providers/src/media", "data/providers", (name, isFile) => isFile && providerWhitelist.includes(name), `供应商（${providerWhitelist.join("、")}）`);

// ACT: Bun 1.4.2 的 `bun run --filter` 一次匹配多个包时只会调度其中一个（vite 被静默丢弃），
// 因此拆成两个单 filter 进程分别启动；升级 Bun 后可改回单条 `["run", "dev"]`。
spawn(process.execPath, ["run", "--filter", "@toonflow/web", "dev"], { stdio: "inherit" });
spawn(process.execPath, ["run", "--filter", "@toonflow/server", "dev"], { stdio: "inherit" });
