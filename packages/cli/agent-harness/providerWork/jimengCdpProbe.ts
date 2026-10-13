// jimengCdpProbe.ts — 即梦 CDP 抓包原型（Phase A 调研工具，零依赖：Bun 全局 API）
// 用法（bun 运行）：
//   bun jimengCdpProbe.ts --selftest           临时 profile 启动 + 机制自检（不碰日常 Chrome）
//   bun jimengCdpProbe.ts --launch-default     用默认 profile 带调试端口启动 Chrome（需先关闭现有 Chrome）
//   bun jimengCdpProbe.ts [--probe]            连接 127.0.0.1:9333 被动抓包，写 jimengProbeOut/samples.jsonl
//   bun jimengCdpProbe.ts --open "<url>"       在浏览器里开新页
//   bun jimengCdpProbe.ts --eval "<js>"        在即梦页 Runtime.evaluate（页内 fetch 通道验证）
// 抓包过滤：仅 XHR/Fetch 类请求；响应体 <=256KB 才落盘；静态资源跳过。

import { spawn } from "node:child_process";

const port = 9333;
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outDir = import.meta.dir + "/jimengProbeOut";
const samplesPath = outDir + "/samples.jsonl";

const args = process.argv.slice(2);
const mode = args[0] ?? "--probe";
const evalExpr = args.includes("--eval") ? args[args.indexOf("--eval") + 1] : null;
const openUrl = args.includes("--open") ? args[args.indexOf("--open") + 1] : null;

// ---------- 基础工具 ----------

async function fetchJson(path: string): Promise<any> {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!resp.ok) throw new Error(`http ${resp.status} on ${path}`);
  return resp.json();
}

async function waitBrowser(timeoutMs = 15000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return await fetchJson("/json/version"); } catch { await sleep(400); }
  }
  throw new Error("浏览器调试端口未就绪（检查 chrome 是否带 --remote-debugging-port 启动）");
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// 同步 append：Bun.write 是覆盖写不适合追加，用 node:fs
import { appendFileSync, mkdirSync, existsSync, statSync, renameSync } from "node:fs";
mkdirSync(outDir, { recursive: true });
function log(line: object) {
  appendFileSync(samplesPath, JSON.stringify(line) + "\n");
}

// ---------- CDP 页面会话 ----------

class PageSession {
  ws: WebSocket;
  targetInfo: any;
  nextId = 1;
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  requests = new Map<string, any>(); // requestId -> {meta}
  dead = false;

  constructor(targetInfo: any) {
    this.targetInfo = targetInfo;
    this.ws = new WebSocket(targetInfo.webSocketDebuggerUrl);
    this.ws.onmessage = (ev) => this.onMessage(String(ev.data));
    this.ws.onclose = () => { this.dead = true; console.log(`[session closed] ${targetInfo.url}`); };
  }

  ready(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e: any) => reject(new Error("ws error: " + (e?.message ?? e)));
      setTimeout(() => reject(new Error("ws open timeout")), 5000);
    });
  }

  send(method: string, params: object = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`cdp timeout: ${method}`)); }
      }, 20000);
    });
  }

  private onMessage(text: string) {
    const msg = JSON.parse(text);
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      return;
    }
    this.onEvent(msg).catch(e => console.log("[event err]", e.message));
  }

  private async onEvent(msg: any) {
    const m = msg.method as string | undefined;
    if (m === "Network.requestWillBeSent") {
      const { requestId, request, type } = msg.params;
      if (type !== "XHR" && type !== "Fetch") return;
      this.requests.set(requestId, { ts: Date.now(), page: this.targetInfo.url, url: request.url, method: request.method, postData: request.postData?.slice(0, 8192) ?? null, reqHeaders: pickHeaders(request.headers) });
    } else if (m === "Network.responseReceived") {
      const r = this.requests.get(msg.params.requestId);
      if (r) { r.status = msg.params.response.status; r.mimeType = msg.params.response.mimeType; }
    } else if (m === "Network.loadingFinished") {
      const requestId = msg.params.requestId;
      const r = this.requests.get(requestId);
      if (!r) return;
      this.requests.delete(requestId);
      let body: string | null = null;
      try {
        const resp = await this.send("Network.getResponseBody", { requestId });
        if (resp?.base64Encoded) body = `<base64 ${resp.body?.length ?? 0} chars>`;
        else if (resp?.body && resp.body.length <= 262144) body = resp.body.slice(0, 131072);
        else if (resp?.body) body = `<too large: ${resp.body.length}>`;
      } catch { /* 响应体不可得（流/跨域等），只记 meta */ }
      log({ ...r, body });
      console.log(`  [${r.status}] ${r.method} ${r.url.slice(0, 110)}${r.url.includes("jimeng") ? "  <== jimeng" : ""}`);
    }
  }
}

function pickHeaders(h: any) {
  const keep = ["content-type", "cookie", "referer", "origin", "user-agent", "x-csrf-token", "authorization"];
  const out: any = {};
  for (const k of Object.keys(h ?? {})) if (keep.includes(k.toLowerCase())) out[k] = h[k];
  return out;
}

// ---------- 目标发现与连接管理 ----------

const sessions = new Map<string, PageSession>();

async function pollTargets() {
  let list: any[];
  try { list = await fetchJson("/json"); } catch { return; }
  for (const t of list) {
    if (t?.type !== "page" || !t.webSocketDebuggerUrl) continue;
    if (/^(devtools:|about:blank$)/.test(t.url) && !t.url.includes("jimeng")) {
      // about:blank 不连（无网络可抓）；devtools 页不连
      continue;
    }
    if (sessions.has(t.id)) continue;
    try {
      const s = new PageSession(t);
      await s.ready();
      await s.send("Network.enable");
      await s.send("Runtime.enable");
      sessions.set(t.id, s);
      console.log(`[attached] ${t.url.slice(0, 100)}`);
    } catch (e: any) {
      console.log(`[attach fail] ${t.url.slice(0, 80)}: ${e.message}`);
    }
  }
  for (const [id, s] of sessions) if (s.dead) sessions.delete(id);
}

function jimengSession(): PageSession | null {
  for (const s of sessions.values()) if (s.targetInfo.url.includes("jimeng.jianying.com")) return s;
  return null;
}

// ---------- 模式实现 ----------

function launchChrome(userDataDir?: string) {
  const cmd = [chromePath, `--remote-debugging-port=${port}`, "--no-first-run", "--no-default-browser-check"];
  if (userDataDir) cmd.push(`--user-data-dir=${userDataDir}`);
  const child = spawn(chromePath, cmd, { detached: true, stdio: "ignore", shell: false });
  child.unref();
  return child;
}

async function selftest() {
  console.log("== selftest：临时独立 profile，不影响日常 Chrome ==");
  const tmpProfile = outDir + "/selftestProfile";
  launchChrome(tmpProfile);
  const version = await waitBrowser();
  console.log("[ok] 浏览器已启动:", version.Browser);
  // 开个页测抓包与 evaluate
  await fetch(`http://127.0.0.1:${port}/json/new?https://example.com`, { method: "PUT" }).catch(() => {});
  await sleep(3000);
  await pollTargets();
  const any = [...sessions.values()][0];
  if (!any) throw new Error("selftest: 无 page target");
  const evalRes = await any.send("Runtime.evaluate", { expression: "1+1", returnByValue: true });
  console.log("[ok] evaluate 1+1 =", evalRes.result.value, "（CDP Runtime 通路正常）");
  await sleep(2500); // 等被动抓包记到 example.com 的 XHR（如有）
  // 关闭临时实例
  const version2 = await fetchJson("/json/version");
  const bws = new WebSocket(version2.webSocketDebuggerUrl);
  await new Promise((r, j) => { bws.onopen = r; bws.onerror = j; setTimeout(j, 5000); });
  bws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
  console.log("[ok] selftest 通过，临时实例已关闭。正式流程：完全退出 Chrome → --launch-default → 无参数抓包");
}

async function launchDefault() {
  console.log("== 用默认 profile 带调试端口启动 Chrome（若已运行会打开新窗口而不开端口！）==");
  launchChrome(undefined);
  const v = await waitBrowser(8000).catch(() => null);
  if (!v) {
    console.log("[fail] 端口未起来——大概率是已有 Chrome 实例在运行（单实例限制）。请先完全退出 Chrome（托盘也退）再跑 --launch-default");
    process.exit(1);
  }
  console.log("[ok] 默认 profile 调试实例已启动:", v.Browser);
  console.log("接下来：bun jimengCdpProbe.ts  开始被动抓包，然后在浏览器里操作即梦生图");
}

async function probe() {
  await waitBrowser();
  console.log(`== 被动抓包中（Ctrl+C 结束）→ ${samplesPath} ==`);
  if (existsSync(samplesPath)) {
    const stat = statSync(samplesPath);
    // 每次运行滚动归档，避免混样
    renameSync(samplesPath, samplesPath + "." + new Date(stat.mtimeMs).toISOString().replace(/[:.]/g, "-"));
    console.log("[archived] 旧样本已滚动归档");
  }
  while (true) {
    await pollTargets();
    await sleep(2000);
  }
}

async function shotMode() {
  await waitBrowser();
  await pollTargets();
  const s = jimengSession() ?? [...sessions.values()][0];
  if (!s) throw new Error("无可用页面");
  const shot = await s.send("Page.captureScreenshot", { format: "png" }, 20000);
  const target = args.includes("--shot") ? args[args.indexOf("--shot") + 1] : "shot.png";
  require("node:fs").writeFileSync(target, Buffer.from(shot.data, "base64"));
  console.log("[ok] screenshot ->", target, "| page:", s.targetInfo.url.slice(0, 80));
}

async function evalMode() {
  await waitBrowser();
  await pollTargets();
  const s = jimengSession();
  if (!s) throw new Error("未找到即梦页面（先在浏览器里打开 jimeng.jianying.com）");
  const res = await s.send("Runtime.evaluate", { expression: evalExpr!, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(res.result?.value ?? res, null, 2).slice(0, 4000));
}

/** 坐标级真实点击（isTrusted=true）：--click x,y[，dclick] */
async function clickMode() {
  await waitBrowser();
  await pollTargets();
  const s = jimengSession() ?? [...sessions.values()][0];
  if (!s) throw new Error("无可用页面");
  const spec = args[args.indexOf("--click") + 1] ?? "0,0";
  const [x, y] = spec.split(",").map(Number);
  const opts = { x, y, button: "left" as const };
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await sleep(120);
  await s.send("Input.dispatchMouseEvent", { ...opts, type: "mousePressed" });
  await sleep(60);
  await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  if (spec.includes("dclick")) {
    await sleep(80);
    await s.send("Input.dispatchMouseEvent", { ...opts, type: "mousePressed", clickCount: 2 });
    await sleep(60);
    await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 2 });
  }
  console.log(`[ok] clicked ${x},${y} | page:`, s.targetInfo.url.slice(0, 80));
}

/** 坐标级输入：--type "文字"（先点击定位焦点） */
async function typeMode() {
  await waitBrowser();
  await pollTargets();
  const s = jimengSession() ?? [...sessions.values()][0];
  if (!s) throw new Error("无可用页面");
  const text = args[args.indexOf("--type") + 1] ?? "";
  for (const ch of text) {
    await s.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch });
    await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    await sleep(20);
  }
  console.log(`[ok] typed ${text.length} chars`);
}

async function openMode() {
  await waitBrowser();
  await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(openUrl!)}`, { method: "PUT" });
  console.log("[ok] opened:", openUrl);
}

// ---------- 入口 ----------

process.on("SIGINT", () => {
  console.log(`\n[exit] 共 ${sessions.size} 个会话；样本在 ${samplesPath}`);
  process.exit(0);
});

try {
  if (mode === "--selftest") await selftest();
  else if (mode === "--launch-default") await launchDefault();
  else if (mode === "--shot") await shotMode();
  else if (mode === "--open") await openMode();
  else if (mode === "--eval") await evalMode();
  else if (mode === "--click") await clickMode();
  else if (mode === "--type") await typeMode();
  else await probe();
} catch (e: any) {
  console.error("[error]", e.message);
  process.exit(1);
}
