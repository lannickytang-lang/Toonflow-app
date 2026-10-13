const version = "0.2.0";

// 即梦（浏览器自动化供应商）：通过本机 Chrome/Edge 的 CDP 接口在即梦页面内发请求，
// 由页面自带风控 SDK 自动完成签名；无 API Key，登录态持久在独立用户数据目录。
// 三种提交模式：normal=mweb 直调；canvasNode=画布 DOM 自动化建节点生成（页面自签 a_bogus）；
// agent=画布右侧 AI 对话导入（canvas_agent/messages/send 由页面签名）。
// 端点与字段全部来自实机抓包（见 providerWork/jimengProbeOut/jimengApiReference.md）。

const jimengOrigin = "https://jimeng.jianying.com";
const commonQuery = "aid=513695&device_platform=web&region=cn&web_version=7.5.0";
const imagexHost = "https://imagex.bytedanceapi.com";
const serviceId = "tb4s082cfz";
const defaultPort = 9333;

// octo 短名(画布/节点) → mweb reqKey(普通模式)；generation_specs 实测对照
const reqKeyMap: Record<string, string> = {
  "seedream_5.0_pro": "high_aes_general_v50p_large",
  "high_aes_general_v50_flash": "high_aes_general_v50_flash",
  "jm_image_model_yc_mj82": "jm_image_model_yc_mj82",
  "seedream_5.0_lite": "high_aes_general_v50",
  "seedream_4.7": "high_aes_general_v43",
  "seedream_4.6": "high_aes_general_v42",
  "seedream_4.5": "high_aes_general_v40l",
  "seedream_4.1": "high_aes_general_v41",
  "seedream_4.0": "high_aes_general_v40",
  "seedance_2.5_draft": "dreamina_seedance_45_pro_draft",
  "seedance_2.5": "dreamina_seedance_45_pro",
  "seedance_2.0_mini": "dreamina_seedance_40_mini",
  "seedance_2.0_fast_vip": "dreamina_seedance_40_vision",
  "seedance_2.0_vip": "dreamina_seedance_40_pro_vision",
  "seedance_pro_fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  "happyhorse_1.1": "dreamina_happyhorse_v1_1",
  "wan_3.0": "dreamina_wan_30",
};

// mweb 普通模式的比例数字枚举（image_resolution_display_map 实测：ratio_type → 比例）
const ratioTypeMap: Record<string, number> = {
  "1:1": 1, "3:4": 2, "16:9": 3, "4:3": 4, "9:16": 5, "2:3": 6, "3:2": 7, "21:9": 8, "7:3": 8,
};

const rules = [
  { type: "select", field: "submitMode" as const, title: "提交模式", value: "normal",
    options: [
      { label: "普通模式", value: "normal" },
      { label: "画布·节点自动化", value: "canvasNode" },
      { label: "画布·AI 对话", value: "agent" },
    ],
    props: { placeholder: "普通=直调生成接口；画布节点=DOM 自动化新建节点生成；AI 对话=右侧 agent 对话导入画布" } },
  { type: "input", field: "browserPath" as const, title: "浏览器路径", value: "",
    props: { placeholder: "留空自动查找 Chrome/Edge（仅支持 Chromium 内核）" } },
  { type: "input", field: "userDataDir" as const, title: "用户数据目录", value: "",
    props: { placeholder: "留空使用数据目录下 browsers/jimengProfile；首次需在拉起的浏览器中登录即梦" } },
  { type: "input", field: "debugPort" as const, title: "调试端口", value: "9333",
    props: { placeholder: "CDP 端口，默认 9333" } },
  { type: "inputNumber", field: "intervalMin" as const, title: "提交间隔下限(秒)", value: 5 },
  { type: "inputNumber", field: "intervalMax" as const, title: "提交间隔上限(秒)", value: 10 },
] as const;

// ---------------- 迷你 WebSocket 客户端（node:http + 手写 RFC6455 文本帧） ----------------
// vm 沙箱未注入全局 WebSocket 且无 ws 依赖；CDP 只用文本帧，自行实现最稳。

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

function wsEncodeFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const mask = randomBytes(4);
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.alloc(2); header[1] = 0x80 | payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  header[0] = 0x81;
  const masked = Buffer.allocUnsafe(payload.length);
  for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

/** 从累积缓冲解析完整文本消息；返回消息列表与剩余字节（处理粘包/拆包）。 */
function wsDecodeFrames(buffer: Buffer): { messages: string[]; rest: Buffer } {
  const messages: string[] = [];
  let rest = buffer;
  while (rest.length >= 2) {
    const opcode = rest[0] & 0x0f;
    const masked = !!(rest[1] & 0x80);
    let length = rest[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (rest.length < 4) break;
      length = rest.readUInt16BE(2); offset = 4;
    } else if (length === 127) {
      if (rest.length < 10) break;
      length = Number(rest.readBigUInt64BE(2)); offset = 10;
    }
    const maskKey = masked ? rest.subarray(offset, offset + 4) : null;
    if (maskKey) offset += 4;
    if (rest.length < offset + length) break;
    let payload = rest.subarray(offset, offset + length);
    if (maskKey) {
      const unmasked = Buffer.allocUnsafe(length);
      for (let i = 0; i < length; i += 1) unmasked[i] = payload[i] ^ maskKey[i & 3];
      payload = unmasked;
    }
    rest = rest.subarray(offset + length);
    if (opcode === 0x1 || opcode === 0x2) messages.push(payload.toString("utf8"));
    if (opcode === 0x8) throw new Error("CDP 连接被服务端关闭");
  }
  return { messages, rest };
}

class CdpConnection {
  private socket: any = null;
  private buffer = Buffer.alloc(0);
  private handshaken = false;
  private handshakeDone: (() => void) | null = null;
  private handshakeFail: ((error: Error) => void) | null = null;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private nextId = 1;
  dead = false;

  /** 裸 TCP 上的 WebSocket 客户端：Bun 的 node:http 不触发 upgrade 事件且 101 socket 不吐数据，故手写 Upgrade 握手。 */
  static connect(port: number, path: string, timeoutMs = 8000): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const conn = new CdpConnection();
      const key = randomBytes(16).toString("base64");
      const timer = setTimeout(() => {
        if (!conn.handshaken) { conn.destroy(); reject(new Error("CDP WebSocket 握手超时")); }
      }, timeoutMs);
      conn.handshakeDone = () => { clearTimeout(timer); resolve(conn); };
      conn.handshakeFail = (error) => { clearTimeout(timer); conn.destroy(); reject(error); };
      Bun.connect({
        hostname: "127.0.0.1", port,
        socket: {
          open(socket: unknown) {
            conn.socket = socket;
            (socket as { write: (data: string) => unknown }).write(
              `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
            );
          },
          data(_socket: unknown, chunk: Buffer) { conn.handleData(chunk); },
          close() { conn.failAll(new Error("CDP 连接断开")); },
          error(_socket: unknown, error: unknown) { conn.failAll(error instanceof Error ? error : new Error(String(error))); },
        },
      }).catch((error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private handleData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.handshaken) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString("latin1");
      this.buffer = this.buffer.subarray(headerEnd + 4);
      if (!header.includes("101")) {
        this.handshakeFail?.(new Error(`CDP WebSocket 握手被拒: ${header.split("\r\n")[0]}`));
        return;
      }
      this.handshaken = true;
      this.handshakeDone?.();
    }
    try {
      const { messages, rest } = wsDecodeFrames(this.buffer);
      this.buffer = rest;
      for (const message of messages) this.handleMessage(JSON.parse(message));
    } catch (error) {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
    }
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    try { this.socket?.end(); } catch { /* 已关闭 */ }
  }

  private failAll(error: Error) {
    if (this.dead) return;
    this.destroy();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private handleMessage(message: any) {
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`CDP ${message.error.message ?? JSON.stringify(message.error)}`));
      else pending.resolve(message.result);
    }
  }

  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 90000): Promise<any> {
    if (this.dead) return Promise.reject(new Error("CDP 连接已断开"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 请求超时: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket.write(wsEncodeFrame(JSON.stringify({ id, method, params })));
    });
  }
}

// ---------------- CDP 会话：常驻浏览器 + 即梦页面 + 页内 fetch ----------------

let toolFetch: typeof globalThis.fetch | null = null;
let runConfig: Record<string, unknown> = {};
let cdpSession: { conn: CdpConnection; port: number; targetId?: string } | null = null;
let lastSubmitAt = 0;

function configText(field: string, fallback = ""): string {
  const value = runConfig[field];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return fallback;
}

function resolveUserDataDir(): string {
  const configured = configText("userDataDir");
  if (configured) return configured;
  const dataDir = process.env.TOONFLOW_DATA_DIR;
  if (dataDir) return `${dataDir}\\browsers\\jimengProfile`;
  return `${process.cwd()}\\browsers\\jimengProfile`;
}

function findBrowserPath(): string {
  const configured = configText("browserPath");
  if (configured) {
    if (!existsSync(configured)) throw new Error(`浏览器路径不存在: ${configured}`);
    return configured;
  }
  const candidates = [
    String(process.env.ProgramFiles) + "\\Google\\Chrome\\Application\\chrome.exe",
    String(process.env["ProgramFiles(x86)"]) + "\\Google\\Chrome\\Application\\chrome.exe",
    String(process.env.LOCALAPPDATA) + "\\Google\\Chrome\\Application\\chrome.exe",
    String(process.env.ProgramFiles) + "\\Microsoft\\Edge\\Application\\msedge.exe",
    String(process.env["ProgramFiles(x86)"]) + "\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  throw new Error("未找到 Chrome/Edge，请在供应商配置里填写浏览器完整路径");
}

async function localFetchJson(path: string, init?: Record<string, unknown>): Promise<any> {
  if (!toolFetch) throw new Error("宿主 fetch 不可用");
  const response = await toolFetch(`http://127.0.0.1:${configText("debugPort", String(defaultPort))}${path}`, init as never);
  return response.json();
}

async function waitBrowserReady(port: number, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await localFetchJson("/json/version"); return; } catch { await sleep(400); }
  }
  throw new Error(`浏览器调试端口 ${port} 未就绪`);
}

async function ensureCdpSession(): Promise<CdpConnection> {
  const port = Number(configText("debugPort", String(defaultPort)));
  if (cdpSession && !cdpSession.conn.dead && cdpSession.port === port) return cdpSession.conn;
  try {
    await localFetchJson("/json/version");
  } catch {
    // 浏览器未运行则拉起（独立用户数据目录，登录态持久；Chrome 136+ 禁止默认 profile 开调试端口）
    Bun.spawn([
      findBrowserPath(),
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${resolveUserDataDir()}`,
      "--no-first-run", "--no-default-browser-check",
      `${jimengOrigin}/ai-tool/home`,
    ], { detached: true, stdout: "ignore", stderr: "ignore" });
    await waitBrowserReady(port);
  }
  // 找即梦页面 target；没有则开一个。后台 tab 会被 Chrome 冻结（CDP 挂死），逐个尝试直到有响应
  let targets: any[] = await localFetchJson("/json");
  let pages = targets.filter((item) => item?.type === "page" && String(item.url).includes("jimeng.jianying.com") && item.webSocketDebuggerUrl);
  if (!pages.length) {
    await localFetchJson(`/json/new?${encodeURIComponent(`${jimengOrigin}/ai-tool/home`)}`, { method: "PUT" });
    await sleep(2000);
    targets = await localFetchJson("/json");
    pages = targets.filter((item) => item?.type === "page" && String(item.url).includes("jimeng.jianying.com") && item.webSocketDebuggerUrl);
  }
  for (const page of pages) {
    const conn = await CdpConnection.connect(port, new URL(page.webSocketDebuggerUrl).pathname).catch(() => null);
    if (!conn) continue;
    const state = await conn.request("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }, 5000)
      .then((r: any) => r?.result?.value).catch(() => null);
    if (state === "complete") {
      cdpSession = { conn, port, targetId: page.id };
      return conn;
    }
    conn.destroy(); // 冻结/无响应的 tab，跳过
  }
  throw new Error("未找到可用的即梦页面（请确认浏览器已打开 jimeng.jianying.com 且未被系统冻结）");
}

/** 页内 fetch：在即梦页面上下文发请求，风控 SDK 自动注入签名；credentials 默认带 cookie。 */
async function pageFetch(url: string, init: { method?: string; body?: string } = {}, timeoutMs = 60000): Promise<{ status: number; data: any; text: string }> {
  const expression = `(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ${timeoutMs});
    try {
      const response = await fetch(${JSON.stringify(url)}, {
        method: ${JSON.stringify(init.method ?? "GET")},
        headers: { "content-type": "application/json" },
        body: ${JSON.stringify(init.body ?? null)},
        signal: ctrl.signal,
        credentials: "include",
      });
      const text = await response.text();
      return { status: response.status, text };
    } catch (error) {
      return { status: 0, text: String(error && error.message || error) };
    } finally { clearTimeout(timer); }
  })()`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let conn: CdpConnection;
    try {
      conn = await ensureCdpSession();
    } catch (error) {
      if (attempt === 2) throw error;
      cdpSession = null;
      continue;
    }
    const result = await conn.request("Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs }, timeoutMs + 5000).catch((error: Error) => {
        cdpSession = null;
        if (attempt === 2) throw new Error(`页内请求失败: ${error.message}`);
        return null;
      });
    if (!result) continue;
    if (result.exceptionDetails) throw new Error(`页内请求异常: ${JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails).slice(0, 300)}`);
    const value = result.result?.value ?? { status: 0, text: "空响应" };
    if (value.status === 0 && attempt < 2) { cdpSession = null; continue; }
    let data: any = null;
    try { data = JSON.parse(value.text); } catch { /* 非 JSON */ }
    return { status: value.status, data, text: String(value.text ?? "") };
  }
  throw new Error("页内请求重试耗尽");
}

/** 统一请求出口：dryrun（config.dryrun=true）走 this.tool.fetch 以复用宿主 mock；生产走页内 fetch。 */
async function apiFetch(url: string, init: { method?: string; body?: string } = {}, timeoutMs = 60000): Promise<{ status: number; data: any; text: string }> {
  if (runConfig.dryrun === true || runConfig.dryrun === "true") {
    if (!toolFetch) throw new Error("宿主 fetch 不可用");
    const response = await toolFetch(url, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json" },
      body: init.body ?? undefined,
      signal: AbortSignal.timeout(timeoutMs),
    } as never);
    const text = await response.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: response.status, data, text };
  }
  return pageFetch(url, init, timeoutMs);
}

function assertBizOk(result: { status: number; data: any; text: string }, context: string) {
  if (result.status === 401 || result.status === 403) {
    throw new Error(`即梦登录态失效（HTTP ${result.status}）：请在供应商配置的浏览器里重新登录即梦后重试`);
  }
  if (result.status !== 200 || !result.data || (result.data.ret !== undefined && String(result.data.ret) !== "0")) {
    throw new Error(`${context}失败: HTTP ${result.status} ${result.text.slice(0, 300)}`);
  }
}

// ---------------- ImageX 上传（AWS4 签名，provider 侧直发） ----------------

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** 火山 ImageX 的 AWS SigV4 签名（STS 临时凭证；SignedHeaders 集合与实机抓包一致）。 */
function aws4Authorization(params: {
  method: string; path: string; query: URLSearchParams; sts: { ak: string; sk: string; token: string };
  payloadHash: string; extraHeaders?: Record<string, string>;
}): string {
  const { method, path, query, sts, payloadHash, extraHeaders = {} } = params;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    "x-amz-date": amzDate,
    "x-amz-security-token": sts.token,
    ...extraHeaders,
  };
  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = sortedNames.join(";");
  const canonicalQuery = [...query.entries()].map(([k, v]) => [k, v])
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/cn-north-1/imagex/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256", amzDate, scope,
    createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${sts.sk}`, date), "cn-north-1"), "imagex"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${sts.ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function mediaInputBytes(input: MediaInput, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (input.type === "binary") return { bytes: input.data, mimeType: input.mimeType };
  if (input.type === "base64") {
    return { bytes: new Uint8Array(Buffer.from(input.data, "base64")), mimeType: input.mimeType || "image/png" };
  }
  if (!toolFetch) throw new Error("宿主 fetch 不可用");
  const response = await toolFetch(input.url, { signal } as never);
  if (!response.ok) throw new Error(`参考图下载失败: HTTP ${response.status}`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: (response.headers.get("content-type") || input.mimeType || "image/png").split(";")[0],
  };
}

/** 上传单张参考图到即梦素材库，返回 tos uri。 */
async function uploadReference(input: MediaInput, signal?: AbortSignal): Promise<string> {
  const { bytes } = await mediaInputBytes(input, signal);
  // 1) STS 凭证（页内发，自动签名）
  const tokenResult = await apiFetch(`${jimengOrigin}/mweb/v1/get_upload_token?${commonQuery}`, { method: "POST", body: "{}" });
  assertBizOk(tokenResult, "获取上传凭证");
  const tokenData = tokenResult.data?.data ?? {};
  const sts = { ak: String(tokenData.access_key_id), sk: String(tokenData.secret_access_key), token: String(tokenData.session_token) };
  // 2) ApplyImageUpload（provider 侧直发 + AWS4 签名）
  const applyQuery = new URLSearchParams({ Action: "ApplyImageUpload", Version: "2018-08-01", ServiceId: serviceId, FileSize: String(bytes.length) });
  if (!toolFetch) throw new Error("宿主 fetch 不可用");
  const emptyHash = createHash("sha256").update("", "utf8").digest("hex");
  const applyAuth = aws4Authorization({ method: "GET", path: "/", query: applyQuery, sts, payloadHash: emptyHash });
  const applyResponse = await toolFetch(`${imagexHost}/?${applyQuery.toString()}`, {
    headers: { Authorization: applyAuth, Referer: `${jimengOrigin}/` },
    signal: AbortSignal.timeout(30_000),
  } as never);
  const applyData: any = await applyResponse.json();
  const address = applyData?.Result?.UploadAddress;
  const storeInfo = address?.StoreInfos?.[0];
  const uploadHost = (address?.UploadHosts ?? [])[0];
  if (!applyResponse.ok || !storeInfo?.StoreUri || !uploadHost) {
    throw new Error(`申请上传位失败: HTTP ${applyResponse.status} ${JSON.stringify(applyData).slice(0, 300)}`);
  }
  // 3) 二进制直传（上传 host + StoreUri，Authorization 用返回的 Auth）
  const uploadResponse = await toolFetch(`https://${uploadHost}/${storeInfo.StoreUri}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream", Authorization: `uploader ${storeInfo.Auth}` },
    body: bytes,
    signal: AbortSignal.timeout(120_000),
  } as never);
  if (!uploadResponse.ok) throw new Error(`上传图片失败: HTTP ${uploadResponse.status}`);
  // 4) CommitImageUpload（AWS4 签名，body 为 SessionKey）
  const commitBody = JSON.stringify({ SessionKey: address.SessionKey });
  const commitHash = createHash("sha256").update(commitBody, "utf8").digest("hex");
  const commitQuery = new URLSearchParams({ Action: "CommitImageUpload", Version: "2018-08-01", ServiceId: serviceId });
  const commitAuth = aws4Authorization({
    method: "POST", path: "/", query: commitQuery, sts, payloadHash: commitHash,
    extraHeaders: { "x-amz-content-sha256": commitHash },
  });
  const commitResponse = await toolFetch(`${imagexHost}/?${commitQuery.toString()}`, {
    method: "POST",
    headers: { Authorization: commitAuth, "Content-Type": "application/json", Referer: `${jimengOrigin}/` },
    body: commitBody,
    signal: AbortSignal.timeout(30_000),
  } as never);
  const commitData: any = await commitResponse.json();
  const committed = commitData?.Result?.Results?.[0];
  if (!commitResponse.ok || committed?.UriStatus !== 2000) {
    throw new Error(`提交上传确认失败: HTTP ${commitResponse.status} ${JSON.stringify(commitData).slice(0, 300)}`);
  }
  // 5) 上传图审核（页内发）
  const auditResult = await apiFetch(`${jimengOrigin}/mweb/v1/imagex/submit_audit_job?${commonQuery}`,
    { method: "POST", body: JSON.stringify({ uri_list: [storeInfo.StoreUri] }) });
  if (auditResult.status !== 200) throw new Error(`上传审核提交失败: ${auditResult.text.slice(0, 200)}`);
  return storeInfo.StoreUri;
}

// ---------------- 通用小工具 ----------------

function uuid(): string { return randomUUID(); }

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

function wait(signal: AbortSignal | undefined, ms: number): Promise<void> {
  if (signal) signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal!.reason); };
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal) signal.addEventListener("abort", abort, { once: true });
  });
}

/** 提交节流：两次提交之间保持随机间隔（防风控），返回实际等待毫秒。 */
async function throttle(signal: AbortSignal | undefined): Promise<void> {
  const min = Math.max(0, Number(runConfig.intervalMin ?? 5));
  const max = Math.max(min, Number(runConfig.intervalMax ?? 10));
  const elapsed = Date.now() - lastSubmitAt;
  const target = (min + Math.random() * (max - min)) * 1000;
  if (elapsed < target && lastSubmitAt > 0) await wait(signal, target - elapsed);
  lastSubmitAt = Date.now();
}

function setupContext(tool: ProviderTools, config: Record<string, unknown>) {
  toolFetch = tool.fetch;
  runConfig = config;
}

// ---------------- 生成链路 ----------------

/** normal：mweb aigc_draft/generate（图片）。draft_content 组件树按实机抓包结构模板化。 */
async function generateImageNormal(request: ImageRequest, signal: AbortSignal | undefined): Promise<MediaAsset[]> {
  const reqKey = reqKeyMap[request.model];
  if (!reqKey) throw new Error(`模型 ${request.model} 不支持普通模式`);
  await throttle(signal);
  // workspace：复用第一个，无则创建
  const listResult = await apiFetch(`${jimengOrigin}/mweb/v1/workspace/list?os=windows&${commonQuery}`,
    { method: "POST", body: JSON.stringify({ offset: 0, limit: 5 }) });
  assertBizOk(listResult, "查询工作区");
  let workspaceId = listResult.data?.data?.workspace_list?.[0]?.workspace_id;
  if (!workspaceId) {
    const created = await apiFetch(`${jimengOrigin}/mweb/v1/workspace/create?os=windows&${commonQuery}`,
      { method: "POST", body: JSON.stringify({ name: "Toonflow" }) });
    assertBizOk(created, "创建工作区");
    workspaceId = created.data?.data?.workspace_id ?? created.data?.data?.workspace?.workspace_id;
  }
  if (!workspaceId) throw new Error("未取得 workspace_id");

  const refUris = signal
    ? await Promise.all((request.images ?? []).slice(0, 10).map((image) => uploadReference(image, signal)))
    : [];
  const ratio = request.ratio && ratioTypeMap[request.ratio] ? request.ratio : "1:1";
  const sizeTier = (request.size ?? "2K").toUpperCase().includes("4") ? "4k"
    : (request.size ?? "2K").toUpperCase().includes("1.5") ? "1.5k" : "2k";
  const sizeMap: Record<string, Record<number, [number, number]>> = {
    "2k": { 1: [2048, 2048], 2: [1728, 2304], 3: [2560, 1440], 4: [2304, 1728], 5: [1440, 2560], 6: [1664, 2496], 7: [2496, 1664], 8: [2560, 1080] },
    "4k": { 1: [4096, 4096], 2: [3520, 4693], 3: [4693, 2640], 4: [4693, 3520], 5: [2640, 4693], 6: [3072, 4608], 7: [4608, 3072], 8: [6197, 2656] },
  };
  const dimensions = (sizeMap[sizeTier] ?? sizeMap["2k"])[ratioTypeMap[ratio]] ?? [2048, 2048];
  const submitId = uuid();
  const componentId = uuid();
  const coreParam = {
    type: "", id: uuid(), model: reqKey, prompt: request.prompt,
    ...(refUris.length ? {} : { negative_prompt: "", seed: Math.floor(Math.random() * 2147483647) }),
    sample_strength: 0.5,
    image_ratio: ratioTypeMap[ratio],
    large_image_info: { type: "", id: uuid(), height: dimensions[1], width: dimensions[0], resolution_type: sizeTier },
    intelligent_ratio: !!refUris.length,
    generate_type: 0,
  };
  const draft = {
    type: "draft", id: uuid(), min_version: "3.0.2", min_features: [], is_from_tsn: true, version: "3.3.28",
    main_component_id: componentId,
    component_list: [{
      type: "image_base_component", id: componentId, min_version: "3.0.2", aigc_mode: "workbench",
      generate_type: refUris.length ? "blend" : "generate",
      metadata: { type: "", id: uuid(), created_platform: 3, created_platform_version: "", created_time_in_ms: String(Date.now()), created_did: "" },
      abilities: {
        type: "", id: uuid(),
        // 文生图走 generate 能力（仅 core_param）；带参考图走 blend（core_param + byte_edit 参考图能力）
        ...(refUris.length ? {
          blend: {
            type: "", id: uuid(), min_features: [],
            core_param: coreParam,
            ability_list: [{
              type: "", id: uuid(), name: "byte_edit",
              image_uri_list: refUris,
              image_list: refUris.map((uri) => ({ type: "image", id: uuid(), source_from: "upload", platform_type: 1, name: "", image_uri: uri, width: 0, height: 0, format: "", title: "", uri })),
              strength: 0.5,
            }],
            prompt_placeholder_info_list: [{ type: "", id: uuid(), ability_index: 0 }],
            postedit_param: { type: "", id: uuid(), generate_type: 0 },
          },
        } : {
          generate: { type: "", id: uuid(), core_param: coreParam },
        }),
        gen_option: { type: "", id: uuid(), gen_count: Math.min(Math.max(request.n ?? 1, 1), 8), generate_all: false },
      },
    }],
  };
  const submitResult = await apiFetch(`${jimengOrigin}/mweb/v1/aigc_draft/generate?${commonQuery}`, {
    method: "POST",
    body: JSON.stringify({
      extend: { root_model: reqKey, workspace_id: workspaceId },
      submit_id: submitId,
      metrics_extra: JSON.stringify({ promptSource: "custom", generateCount: Math.min(Math.max(request.n ?? 1, 1), 8), enterFrom: "click", position: "page_bottom_box", isBoxSelect: false, isCutout: false, hasRejectedAudit: 0, generateId: submitId, isRegenerate: false }),
      draft_content: JSON.stringify(draft),
      http_common_info: { aid: 513695 },
    }),
  });
  assertBizOk(submitResult, "提交生成任务");
  const historyId = submitResult.data?.data?.aigc_data?.history_record_id;
  if (!historyId) throw new Error(`提交响应缺少 history_record_id: ${submitResult.text.slice(0, 200)}`);

  // 轮询产物（get_history_by_ids）
  for (let polls = 1; polls <= 100; polls += 1) {
    await wait(signal, 4000);
    const pollResult = await apiFetch(`${jimengOrigin}/mweb/v1/get_history_by_ids?${commonQuery}`,
      { method: "POST", body: JSON.stringify({ submit_ids: [submitId] }) });
    if (pollResult.status !== 200) continue;
    // ACT: 兜底取 data 首个记录仅为 dryrun 静态样例兼容（mock 响应无法参数化 submit_id 键）；生产响应键恒匹配
    const payload = pollResult.data?.data ?? {};
    const record = payload[submitId] ?? (Object.keys(payload).length ? Object.values(payload)[0] : null);
    const items = record?.item_list ?? [];
    const assets: MediaAsset[] = [];
    let failed = false;
    for (const item of items) {
      const url = item?.image?.large_images?.[0]?.image_url;
      if (url) assets.push({ mediaType: "image", type: "url", url });
      else if ([50, 52].includes(Number(item?.status))) failed = true;
    }
    if (assets.length) return assets;
    if (failed) throw new Error(`生成失败: ${JSON.stringify(record?.item_list?.[0]?.common_attr ?? {}).slice(0, 200)}`);
  }
  throw new Error("轮询超时，图片任务未完成");
}

/** 把会话页面导航到指定 URL 并等待新文档就绪（画布编辑器需由页面自身建立协作 WS 会话）。 */
async function navigateAndReady(url: string): Promise<void> {
  if (runConfig.dryrun === true || runConfig.dryrun === "true") return; // 干跑无浏览器，请求全部由 mock 应答
  const conn = await ensureCdpSession();
  await conn.request("Runtime.evaluate", { expression: `location.assign(${JSON.stringify(url)})`, returnByValue: true }, 5000).catch(() => { /* 导航本身会中断 evaluate */ });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500);
    try {
      const state = await conn.request("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }, 5000);
      if (state?.result?.value === "complete") {
        await sleep(3000); // 文档就绪后留时间给画布协作 WS 与 SDK 注入（就绪不足时 node_generate 报 20014）
        return;
      }
    } catch { /* 导航中 evaluate 偶发失败，继续等 */ }
  }
  throw new Error(`页面导航超时: ${url}`);
}

/** canvas：octo 画布节点 API（结构化，不经 AI 对话）。 */
async function generateOnCanvas(params: {
  signal: AbortSignal | undefined;
  nodeType: number; // 1=生图（实测）；2=生视频（按 octo resource_type 推断，未实机验证）
  imageParams?: Record<string, unknown>;
  videoParams?: Record<string, unknown>;
  materialUris: string[];
}): Promise<{ resourceIds: string[]; projectId: string }> {
  await throttle(params.signal);
  const projectId = uuid();
  const created = await apiFetch(`${jimengOrigin}/octo_api/v1/project/create`,
    { method: "POST", body: JSON.stringify({ project_id: projectId, writer_data_version: "2.29.0" }) });
  assertBizOk(created, "创建画布项目");
  // node_generate 依赖画布编辑器的活跃协作会话：把页面导航到该项目，由页面建立 WS 后再提交
  await navigateAndReady(`${jimengOrigin}/ai-tool/ai-canvas/${projectId}`);

  const materials = params.materialUris.map((uri) => ({ type: 2, role: 3, image_uri: uri }));
  const paramBody = params.imageParams
    ? { image_params: { mode: params.materialUris.length ? 2 : 1, ...(materials.length ? { materials } : {}), ...params.imageParams } }
    : { video_params: { ...(materials.length ? { materials } : {}), ...params.videoParams } };
  // node_generate 的 query 实测必须带 generate_id 与埋点参数（缺 generate_id 报 20014 服务端繁忙）
  const babiParam = encodeURIComponent(JSON.stringify({ edit_type: "octo", tool_id: "octo", sub_tool_id: "octo", tab_name: "octo", enter_from: "octo", template_id: "", scene_lv1: "octo", scene_lv2: "octo" }));
  // 画布编辑器协作会话就绪存在时序：20014（服务端繁忙）时退避重试，每轮全新 submit/resource/node id 避免被判重复提交
  let entry: any = null;
  let nodeResult: { status: number; data: any; text: string } | null = null;
  let resourceId = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    resourceId = uuid();
    const nodeBody = JSON.stringify({
      project_id: projectId, op: 1,
      initial: {
        submit_id: uuid(), node_id: `node_${randomBytes(6).toString("hex")}`,
        items: [{ resource_id: resourceId, type: params.nodeType, params: paramBody,
          ...(params.materialUris.length ? { metric: JSON.stringify({ sources: { upload_material_array: params.materialUris.map((uri) => ({ uri, material_type: "image" })) } }) } : {}) }],
      },
    });
    nodeResult = await apiFetch(`${jimengOrigin}/octo_api/v1/node_generate?generate_id=gen-${uuid()}&babi_param=${babiParam}&os=windows`,
      { method: "POST", body: nodeBody });
    if (nodeResult.status === 200 && nodeResult.data?.data?.results?.[0]) {
      entry = nodeResult.data.data.results[0];
      if (entry.error_code === 0) break;
      if (![5, 20014].includes(Number(entry.error_code))) break;
    }
    if (params.signal?.aborted) throw params.signal.reason as Error;
    await sleep(2500);
  }
  if (!entry || entry.error_code !== 0) {
    throw new Error(`画布节点提交失败: ${JSON.stringify(entry ?? nodeResult?.text?.slice(0, 200)).slice(0, 200)}`);
  }
  return { resourceIds: [resourceId], projectId };
}

/** 轮询画布资源直到产物出现：image_urls 里排除已知素材 uri 的新 key 即产物。 */
async function pollCanvasResources(params: {
  signal: AbortSignal | undefined; projectId: string; resourceIds: string[]; knownUris: string[];
  mediaType: "image" | "video"; pollMs?: number; maxPolls?: number;
}): Promise<MediaAsset[]> {
  const { signal, projectId, resourceIds, knownUris, mediaType } = params;
  const known = new Set(knownUris);
  for (let polls = 1; polls <= (params.maxPolls ?? 150); polls += 1) {
    await wait(signal, params.pollMs ?? 4000);
    const result = await apiFetch(`${jimengOrigin}/octo_api/v1/resource/batch_get`,
      { method: "POST", body: JSON.stringify({ project_id: projectId, resource_ids: resourceIds, uris: [], vids: [], audio_vids: [] }) });
    if (result.status !== 200) continue;
    const resources = result.data?.data?.resources ?? [];
    for (const resource of resources) {
      // 状态码双体系：batch_get 用 200=完成；resource/list 语义 1000=完成 / 1001=失败；4xx/5xx 为失败
      const status = Number(resource?.status);
      if (status === 1001 || status === 1002 || (status >= 400 && status < 1000) || resource?.error_code) {
        throw new Error(`画布生成失败: ${JSON.stringify(resource).slice(0, 200)}`);
      }
    }
    const assets: MediaAsset[] = [];
    const imageUrls: Record<string, { url: string }> = result.data?.data?.image_urls ?? {};
    for (const [uri, info] of Object.entries(imageUrls)) {
      if (!known.has(uri) && info?.url) {
        // ACT: 按 uri 后缀粗过滤，避免批量取图响应里混入的音视频条目被当图片（image_urls 是通用签名 URL 换取通道）
        if (mediaType === "image" && /\.(mp4|mp3|wav|m4a)([?#]|$)/i.test(info.url)) continue;
        assets.push({ mediaType: "image", type: "url", url: info.url });
      }
    }
    // 视频产物字段未实机确认：兜底扫描响应中的 .mp4 直链
    if (mediaType === "video") {
      const text = result.text;
      const matches = text.match(/https:[^"]+\.mp4[^"]*/g) ?? [];
      for (const url of matches) assets.push({ mediaType: "video", type: "url", url: url.replaceAll("\\u0026", "&") });
    }
    const allDone = resources.length > 0 && resources.every((resource: any) => [200, 1000].includes(Number(resource?.status)));
    if (assets.length && allDone) return dedupeAssets(assets, mediaType);
  }
  throw new Error("轮询超时，画布任务未完成");
}

function dedupeAssets(assets: MediaAsset[], mediaType: "image" | "video"): MediaAsset[] {
  const seen = new Set<string>();
  const unique: MediaAsset[] = [];
  for (const asset of assets) {
    const key = asset.type === "url" ? asset.url : JSON.stringify(asset);
    if (asset.mediaType === mediaType && !seen.has(key)) { seen.add(key); unique.push(asset); }
  }
  return unique;
}

// ---------------- 画布 DOM 自动化（canvasNode / agent 两模式共用） ----------------
// 实证要点（jimengProbeOut 调研 2026-10-12）：
// - 左栏工具布满 pointer-events-none，合成事件无效；必须 CDP Input.dispatchMouseEvent 真实点击（isTrusted）
// - 单击工具栏 button[aria-label="图片"/"视频"] 直接建空节点；双击节点内容区打开配置面板 .generation-input-panel
// - 模型/尺寸下拉为 role=listbox，选项可能超出可视区（超高被裁剪），必须先 scrollIntoView 再点击
// - Escape 与点击空白都会收起配置面板（配置保留，双击节点重开）
// - 点"生成"后由页面自身发带 a_bogus 签名的 node_generate（provider 无需也无法自行签名）
// - agent 对话：点"与 AI 对话"→ contenteditable 输入 → 点"发送消息"（messages/send 同样由页面签名）

async function domEval(conn: CdpConnection, expression: string, timeoutMs = 15000): Promise<any> {
  const result = await conn.request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (result?.exceptionDetails) {
    throw new Error(`DOM 求值异常: ${String(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails)).slice(0, 200)}`);
  }
  return result?.result?.value;
}

async function cdpClick(conn: CdpConnection, x: number, y: number, opts: { dbl?: boolean } = {}): Promise<void> {
  await conn.request("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" }, 10000);
  await sleep(120);
  for (const clickCount of opts.dbl ? [1, 2] : [1]) {
    await conn.request("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount }, 10000);
    await sleep(50);
    await conn.request("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount }, 10000);
    await sleep(60);
  }
}

/** 轮询等待页内表达式返回真值；返回该值。 */
async function waitForDom(conn: CdpConnection, expression: string, timeoutMs: number, desc: string): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await domEval(conn, `(() => { try { return (${expression}); } catch { return null; } })()`, 10000).catch(() => null);
    if (value) return value;
    await sleep(400);
  }
  throw new Error(`等待画布 UI 超时: ${desc}`);
}

/** 页内按条件找元素中心坐标（rect 可见时返回 {x,y}）。 */
function centerOfJs(finderJs: string): string {
  return `(() => { const b = ${finderJs}; if (!b) return null; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`;
}

let cachedCookie: string | null = null;

/** 经浏览器级 CDP 端点取即梦登录 Cookie（create 等 octo 接口无需页面签名，带 cookie 直发即可）。 */
async function getJimengCookie(port: number): Promise<string> {
  if (cachedCookie) return cachedCookie;
  const version = await localFetchJson("/json/version");
  const conn = await CdpConnection.connect(port, new URL(version.webSocketDebuggerUrl).pathname);
  const result = await conn.request("Storage.getCookies", {}, 10000)
    .catch(() => conn.request("Network.getAllCookies", {}, 10000));
  conn.destroy();
  const cookie = (result?.cookies ?? [])
    .filter((c: any) => /(^|\.)(jimeng\.)?jianying\.com$/i.test(String(c.domain ?? "")))
    .map((c: any) => `${c.name}=${c.value}`).join("; ");
  if (!cookie) throw new Error("未取得即梦登录 Cookie：请在供应商配置的浏览器中登录即梦");
  cachedCookie = cookie;
  return cookie;
}

/** 新建画布并在独立新 tab 打开。旧 tab 会被 Chrome 冻结（CDP 挂死）且有 beforeunload 拦截，故全程不依赖。 */
async function createCanvasAndNavigate(signal: AbortSignal | undefined): Promise<{ conn: CdpConnection; projectId: string; startedAt: number; targetId: string }> {
  await throttle(signal);
  const port = Number(configText("debugPort", String(defaultPort)));
  // 1. create 走 provider 直发（cookie 经浏览器级 CDP 获取；octo create 实测无需页面签名）
  const projectId = uuid();
  const cookie = await getJimengCookie(port);
  if (!toolFetch) throw new Error("宿主 fetch 不可用");
  const createResponse = await toolFetch(`${jimengOrigin}/octo_api/v1/project/create`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, referer: `${jimengOrigin}/` },
    body: JSON.stringify({ project_id: projectId, writer_data_version: "2.29.0" }),
    signal: AbortSignal.timeout(30_000),
  } as never);
  const createText = await createResponse.text();
  if (createResponse.status === 401 || createResponse.status === 403) {
    throw new Error("即梦登录态失效：请在供应商配置的浏览器里重新登录即梦后重试");
  }
  let createData: any = null;
  try { createData = JSON.parse(createText); } catch { /* 非 JSON */ }
  if (createResponse.status !== 200 || !createData || String(createData.ret) !== "0") {
    throw new Error(`创建画布项目失败: HTTP ${createResponse.status} ${createText.slice(0, 200)}`);
  }
  // 2. 新 tab 直开画布（前台加载不冻结）
  await localFetchJson(`/json/new?${encodeURIComponent(`${jimengOrigin}/ai-tool/ai-canvas/${projectId}`)}`, { method: "PUT" });
  let conn: CdpConnection | null = null;
  let targetId = "";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const targets: any[] = await localFetchJson("/json");
    const page = targets.find((item) => item?.type === "page" && String(item.url).includes(projectId) && item.webSocketDebuggerUrl);
    if (page) {
      conn = await CdpConnection.connect(port, new URL(page.webSocketDebuggerUrl).pathname);
      targetId = page.id;
      cdpSession = { conn, port, targetId };
      break;
    }
    await sleep(500);
  }
  if (!conn) throw new Error("画布页面 CDP 连接失败");
  // 空画布是引导态（无左栏工具）；Loading canvas / Syncing room 期间交互层锁定，双击无效，须等 Room connected
  await waitForDom(conn, `!!document.querySelector('.react-flow')`, 30000, "画布编辑器加载");
  await waitForDom(conn, `(document.querySelector('.sr-only')?.textContent || '').includes('Room connected') || !(document.body.textContent || '').includes('Syncing room')`, 45000, "画布协作同步");
  return { conn, projectId, startedAt: Date.now(), targetId };
}

/** 关闭画布 tab 并清理 CDP 单例（失败不阻塞主流程）。 */
async function closeCanvasTab(targetId: string): Promise<void> {
  const cached = cdpSession;
  if (cached?.targetId === targetId) {
    cached.conn.destroy();
    cdpSession = null;
  }
  await localFetchJson(`/json/close/${targetId}`, { method: "PUT" }).catch(() => { /* 页面可能已关闭 */ });
}

/** 在 role=listbox 弹层中点击文本匹配的选项（scrollIntoView 保证可见后真实点击）。 */
async function clickListboxOption(conn: CdpConnection, matchJs: string, desc: string): Promise<void> {
  const scrolled = await waitForDom(conn, `(() => {
    const boxes = [...document.querySelectorAll('[role=listbox]')];
    for (const box of boxes) {
      const option = ${matchJs};
      if (option) { option.scrollIntoView({ block: 'center' }); return true; }
    }
    return null;
  })()`, 10000, desc);
  if (scrolled !== true) throw new Error(`未找到选项: ${desc}`);
  await sleep(300);
  const point = await waitForDom(conn, `(() => {
    const boxes = [...document.querySelectorAll('[role=listbox]')];
    for (const box of boxes) {
      const option = ${matchJs};
      if (option) {
        const host = option.closest('[role=option]') || option;
        const r = host.getBoundingClientRect();
        const boxRect = box.getBoundingClientRect();
        if (r.width > 0 && r.y >= boxRect.y && r.bottom <= boxRect.bottom) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  })()`, 5000, `${desc} 可见`);
  await cdpClick(conn, point.x, point.y);
  await sleep(500);
}

/** 画布·节点自动化：新建画布 → DOM 建节点 → 配置面板填参 → 点生成。 */
async function generateOnCanvasViaDom(params: {
  signal: AbortSignal | undefined;
  kind: "image" | "video";
  modelLabel: string;
  prompt: string;
  ratio: string;
  resolution: string;
  count?: number;
}): Promise<{ projectId: string; startedAt: number; targetId: string }> {
  const { conn, projectId, startedAt, targetId } = await createCanvasAndNavigate(params.signal);
  const toolAria = params.kind === "image" ? "图片" : "视频";
  const nodeCountBefore = await domEval(conn, `document.querySelectorAll('.react-flow__node').length`);

  // 1. 建空节点。空画布无左栏工具（引导态），走"双击画布空白 → 新建节点菜单"路径；
  //    空画布交互层初始化存在时序（协作 WS 就绪前双击无效），单击激活 + 双击为一轮，失败重试
  const viewport = await domEval(conn, `(() => { const c = document.querySelector('.react-flow'); const r = c.getBoundingClientRect(); return { x: r.x + r.width * 0.6, y: r.y + r.height * 0.5 }; })()`);
  const menuJs = `(() => { const m = [...document.querySelectorAll('[class*=octo-co]')].find(e => e.textContent.includes('新建节点') && e.getBoundingClientRect().width > 50); if (!m) return null; const leaf = [...m.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === ${JSON.stringify(toolAria)}); return leaf || null; })()`;
  let menuItem: any = null;
  for (let round = 0; round < 4 && !menuItem; round += 1) {
    await sleep(round === 0 ? 5000 : 5000);
    await cdpClick(conn, viewport.x, viewport.y);
    await sleep(600);
    await cdpClick(conn, viewport.x, viewport.y, { dbl: true });
    menuItem = await waitForDom(conn, centerOfJs(menuJs), 6000, `新建节点菜单 ${toolAria}`).catch(() => null);
  }
  if (!menuItem) throw new Error("画布双击未能打开新建节点菜单");
  await cdpClick(conn, menuItem.x, menuItem.y);
  await waitForDom(conn, `document.querySelectorAll('.react-flow__node').length > ${nodeCountBefore}`, 15000, "新节点出现");

  // 2. 双击最新节点内容区打开配置面板
  const nodePoint = await domEval(conn, `(() => { const nodes = document.querySelectorAll('.react-flow__node'); const node = nodes[nodes.length - 1]; const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.6 }; })()`);
  await cdpClick(conn, nodePoint.x, nodePoint.y, { dbl: true });
  await waitForDom(conn, `!!document.querySelector('.generation-input-panel')`, 15000, "节点配置面板");

  // 3. 提示词
  await domEval(conn, `(() => { const editor = document.querySelector('.generation-input-panel [contenteditable]'); editor.focus(); return document.activeElement === editor; })()`);
  await conn.request("Input.insertText", { text: params.prompt }, 15000);
  await sleep(300);

  // 4. 模型（aria-label 形如 "选择模型: Seedream 5.0 Lite"）
  const modelBtn = await waitForDom(conn, centerOfJs(`[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').startsWith('选择模型'))`), 10000, "模型按钮");
  await cdpClick(conn, modelBtn.x, modelBtn.y);
  await clickListboxOption(conn,
    `[...box.querySelectorAll('[role=option]')].find(o => o.textContent.trim().startsWith(${JSON.stringify(params.modelLabel)}))`,
    `模型 ${params.modelLabel}`);
  await waitForDom(conn, `[...document.querySelectorAll('button')].some(b => (b.getAttribute('aria-label') || '').includes(${JSON.stringify(params.modelLabel)}))`, 8000, "模型已切换");

  // 5. 比例与分辨率（尺寸按钮弹出三个 listbox：比例 / 分辨率 / 数量）
  const sizeBtn = await waitForDom(conn, centerOfJs(`[...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '').includes('尺寸选项'))`), 10000, "尺寸按钮");
  await cdpClick(conn, sizeBtn.x, sizeBtn.y);
  await waitForDom(conn, `document.querySelectorAll('[role=listbox]').length > 0`, 8000, "尺寸弹层");
  await clickListboxOption(conn,
    `[...box.querySelectorAll('[role=option]')].find(o => o.textContent.trim() === ${JSON.stringify(params.ratio)})`,
    `比例 ${params.ratio}`);
  await clickListboxOption(conn,
    `[...box.querySelectorAll('[role=option]')].find(o => o.textContent.trim() === ${JSON.stringify(params.resolution)})`,
    `分辨率 ${params.resolution}`);
  if (params.count && params.count > 1) {
    await clickListboxOption(conn,
      `[...box.querySelectorAll('[role=option]')].find(o => o.textContent.trim() === String(${params.count}))`,
      `数量 ${params.count}`);
  }

  // 6. 点生成（面板不因弹层收起而消失；生成按钮 aria-label="生成"）
  const genBtn = await waitForDom(conn, centerOfJs(`[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '生成')`), 10000, "生成按钮");
  await cdpClick(conn, genBtn.x, genBtn.y);
  return { projectId, startedAt, targetId };
}

/** 画布·AI 对话：打开右侧对话面板，用模板指令让 agent 建节点生成。 */
async function generateOnCanvasViaAgent(params: {
  signal: AbortSignal | undefined;
  kind: "image" | "video";
  modelLabel: string;
  prompt: string;
  ratio: string;
  resolution?: string;
  durationSeconds?: number;
}): Promise<{ projectId: string; startedAt: number; targetId: string }> {
  const { conn, projectId, startedAt, targetId } = await createCanvasAndNavigate(params.signal);

  // 1. 打开对话面板（空画布引导态下按钮无 aria-label，按文本兜底匹配）
  const chatBtn = await waitForDom(conn, centerOfJs(`(() => {
    const btns = [...document.querySelectorAll('button,[role=button]')];
    return btns.find(b => b.getAttribute('aria-label') === '与 AI 对话')
      || btns.find(b => (b.textContent || '').includes('与 AI 对话') && b.getBoundingClientRect().width > 30);
  })()`), 15000, "与 AI 对话按钮");
  await cdpClick(conn, chatBtn.x, chatBtn.y);
  // 输入框出现在画布右下区域
  await waitForDom(conn, `[...document.querySelectorAll('[contenteditable]')].some(e => { const r = e.getBoundingClientRect(); return r.x > 900 && r.y > 400 && r.width > 100; })`, 15000, "对话输入框");

  // 2. 输入模板指令（参考 jimeng2api 的画布对话模板，实测 agent 按指令建节点且 prompt 原样透传）
  const instruction = params.kind === "image"
    ? `使用${params.modelLabel}帮我生成一张图片，比例${params.ratio}${params.resolution ? `，分辨率${params.resolution}` : ""}，下面是我的提示词：${params.prompt}`
    : `使用${params.modelLabel}帮我生成一段视频，比例${params.ratio}${params.resolution ? `，分辨率${params.resolution}` : ""}${params.durationSeconds ? `，时长${params.durationSeconds}秒` : ""}，下面是我的提示词：${params.prompt}`;
  await domEval(conn, `(() => { const editor = [...document.querySelectorAll('[contenteditable]')].find(e => { const r = e.getBoundingClientRect(); return r.x > 900 && r.y > 400 && r.width > 100; }); editor.focus(); return document.activeElement === editor; })()`);
  await conn.request("Input.insertText", { text: instruction }, 15000);
  await sleep(500);

  // 3. 发送（messages/send 由页面带 a_bogus 发出）
  const sendBtn = await waitForDom(conn, centerOfJs(`[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '发送消息')`), 10000, "发送按钮");
  await cdpClick(conn, sendBtn.x, sendBtn.y);
  return { projectId, startedAt, targetId };
}

/** 轮询 resource/list 找本画布内 prompt 匹配的新资源；status 1000=完成 / 1001=失败。 */
async function waitForCanvasResource(params: {
  signal: AbortSignal | undefined; projectId: string; prompt: string; startedAt: number;
  mediaType: "image" | "video"; maxPolls?: number;
}): Promise<string> {
  const resourceType = params.mediaType === "image" ? 1 : 2;
  for (let polls = 1; polls <= (params.maxPolls ?? 150); polls += 1) {
    await wait(params.signal, polls === 1 ? 3000 : 4000);
    const result = await apiFetch(`${jimengOrigin}/octo_api/v1/resource/list`,
      { method: "POST", body: JSON.stringify({ project_id: params.projectId, source: 1, relation_source: 1 }) });
    if (result.status !== 200) continue;
    const resources: any[] = result.data?.data?.resources ?? [];
    for (const resource of resources) {
      const gen = resource?.image?.gen ?? resource?.video?.gen ?? {};
      if (Number(resource?.type) !== resourceType || gen.prompt !== params.prompt) continue;
      if (Number(resource?.created_at) < params.startedAt - 60_000) continue;
      // 完成态 resource 无 error_code 字段（Number(undefined)=NaN），须兜底为 0 再判
      if (Number(resource?.status) === 1001 || Number(resource?.error_code ?? 0) !== 0) {
        throw new Error(`画布生成失败: ${String(resource?.error_message ?? JSON.stringify(resource).slice(0, 200)).slice(0, 200)}`);
      }
      if (Number(resource?.status) === 1000) return String(resource.resource_id);
    }
  }
  throw new Error("轮询超时，画布任务未完成");
}

export default {
  id: "jimeng",
  label: "即梦（浏览器自动化）",
  version,
  readme: "通过本机 Chrome/Edge 操作即梦网页版生图/生视频，无需 API Key。首次使用：保存配置后发起一次生成，会自动弹出浏览器，请在其页面完成即梦登录（登录态长期保留在独立数据目录）。普通模式=直调生成接口（支持参考图）；画布·节点自动化=在新建画布里自动建生图/生视频节点并生成，产物落在画布上（暂不支持参考图）；画布·AI 对话=通过画布右侧 agent 对话导入生成（暂不支持参考图）。生成期间请不要操作该浏览器窗口。",
  rules,
  models: [
    { id: "seedream_5.0_pro", label: "Seedream 5.0 Pro", type: "image", mode: ["text", "multiReference"], imageRatios: ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"], imageSizes: ["1.5K", "2K", "4K"] },
    { id: "high_aes_general_v50_flash", label: "Seedream 5.0 Flash", type: "image", mode: ["text", "multiReference"], imageRatios: ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"], imageSizes: ["1.5K", "2K"] },
    { id: "jm_image_model_yc_mj82", label: "图片美学模型 V8.2", type: "image", mode: ["text", "multiReference"], imageRatios: ["1:1", "3:4", "16:9", "4:3", "9:16", "2:3", "3:2"], imageSizes: ["1K", "2K"] },
    { id: "seedream_5.0_lite", label: "Seedream 5.0 Lite", type: "image", mode: ["text", "multiReference"], imageRatios: ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"], imageSizes: ["2K", "4K"] },
    { id: "seedream_4.7", label: "Seedream 4.7", type: "image", mode: ["text", "multiReference"], imageRatios: ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"], imageSizes: ["2K", "4K"] },
    { id: "seedream_4.6", label: "Seedream 4.6", type: "image", mode: ["text", "multiReference"], imageRatios: ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"], imageSizes: ["2K", "4K"] },
    { id: "seedream_4.5", label: "Seedream 4.5", type: "image", mode: ["text", "multiReference"], imageRatios: ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"], imageSizes: ["2K", "4K"] },
    { id: "seedream_4.1", label: "Seedream 4.1", type: "image", mode: ["text", "multiReference"], imageRatios: ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"], imageSizes: ["2K", "4K"] },
    { id: "seedream_4.0", label: "Seedream 4.0", type: "image", mode: ["text", "multiReference"], imageRatios: ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"], imageSizes: ["2K", "4K"] },
    { id: "seedance_2.5_draft", label: "即梦 Seedance 2.5（样片）", type: "video", mode: ["text", "startEndRequired", "singleImage", "imageReference:2"], imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
    { id: "seedance_2.5", label: "即梦 Seedance 2.5", type: "video", mode: ["text", "startEndRequired", "singleImage", "imageReference:2"], imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
    { id: "seedance_2.0_mini", label: "即梦 Seedance 2.0 mini", type: "video", mode: ["text", "startEndRequired", "singleImage", "imageReference:2"], imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
    { id: "seedance_2.0_fast_vip", label: "即梦 Seedance 2.0 Fast VIP", type: "video", mode: ["text", "startEndRequired", "singleImage", "imageReference:2"], imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
    { id: "seedance_2.0_vip", label: "即梦 Seedance 2.0 VIP", type: "video", mode: ["text", "startEndRequired", "singleImage", "imageReference:2"], imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
    { id: "seedance_pro_fast", label: "即梦 Seedance 1.0 Fast", type: "video", mode: ["text", "singleImage", "imageReference:1"], imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
    { id: "happyhorse_1.1", label: "HappyHorse 1.1", type: "video", mode: ["text", "singleImage", "imageReference:1"], imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
    { id: "wan_3.0", label: "Wan 3.0", type: "video", mode: ["text", "startEndRequired", "singleImage", "imageReference:2"], imageRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
  ] satisfies ProviderModel[],

  validateConfig(config) {
    const browserPath = String(config.browserPath ?? "").trim();
    if (browserPath && !existsSync(browserPath)) {
      return { ok: false, errors: [`浏览器路径不存在: ${browserPath}`] };
    }
    const min = Number(config.intervalMin ?? 5);
    const max = Number(config.intervalMax ?? 10);
    if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
      return { ok: false, errors: ["提交间隔下限不能大于上限"] };
    }
    return { ok: true };
  },

  async generateImage(request: ImageRequest): Promise<MediaAsset[]> {
    setupContext(this.tool, this.config as Record<string, unknown>);
    const submitMode = configText("submitMode", "normal");
    const signal = this.signal;
    const refInputs = (request.images ?? []).slice(0, 10);
    const modelLabel = modelLabelOf(request.model);
    const ratio = request.ratio && ratioTypeMap[request.ratio] ? request.ratio : "1:1";
    const resolution = normalizeResolution(request.size ?? "2K");
    const count = Math.min(Math.max(request.n ?? 1, 1), 8);
    const dryrun = runConfig.dryrun === true || runConfig.dryrun === "true";

    if (submitMode === "canvasNode" && !dryrun) {
      if (refInputs.length) throw new Error("画布·节点自动化模式暂不支持参考图，请改用普通模式");
      const { projectId, startedAt, targetId } = await generateOnCanvasViaDom({
        signal, kind: "image", modelLabel, prompt: request.prompt, ratio, resolution, count: count > 1 ? count : undefined,
      });
      const resourceId = await waitForCanvasResource({ signal, projectId, prompt: request.prompt, startedAt, mediaType: "image" });
      const assets = await pollCanvasResources({ signal, projectId, resourceIds: [resourceId], knownUris: [], mediaType: "image", maxPolls: 40 });
      await closeCanvasTab(targetId);
      return assets;
    }
    if (submitMode === "agent" && !dryrun) {
      if (refInputs.length) throw new Error("画布·AI 对话模式暂不支持参考图，请改用普通模式");
      const { projectId, startedAt, targetId } = await generateOnCanvasViaAgent({
        signal, kind: "image", modelLabel, prompt: request.prompt, ratio, resolution,
      });
      const resourceId = await waitForCanvasResource({ signal, projectId, prompt: request.prompt, startedAt, mediaType: "image", maxPolls: 120 });
      const assets = await pollCanvasResources({ signal, projectId, resourceIds: [resourceId], knownUris: [], mediaType: "image", maxPolls: 40 });
      await closeCanvasTab(targetId);
      return assets;
    }
    if (submitMode === "canvasNode" || submitMode === "agent" || submitMode === "canvas") {
      // dryrun 或旧配置 canvas：走 octo API 路径（dryrun 下请求由宿主 mock 应答）
      const refUris = signal
        ? await Promise.all(refInputs.map((image) => uploadReference(image, signal)))
        : [];
      const { resourceIds, projectId } = await generateOnCanvas({
        signal,
        nodeType: 1,
        imageParams: {
          aspect_ratio: ratio,
          model_name: request.model,
          resolution,
          prompt: request.prompt,
        },
        materialUris: refUris,
      });
      return pollCanvasResources({ signal, projectId, resourceIds, knownUris: refUris, mediaType: "image" });
    }
    return generateImageNormal(request, signal);
  },

  async generateVideo(request: VideoRequest): Promise<MediaAsset[]> {
    setupContext(this.tool, this.config as Record<string, unknown>);
    const submitMode = configText("submitMode", "normal");
    const signal = this.signal;
    const modelLabel = modelLabelOf(request.model);
    const ratio = request.ratio && ratioTypeMap[request.ratio] ? request.ratio : "16:9";
    const resolution = String(request.resolution ?? "720p").toLowerCase();
    const dryrun = runConfig.dryrun === true || runConfig.dryrun === "true";

    if ((submitMode === "canvasNode" || submitMode === "agent") && !dryrun) {
      const flow = submitMode === "canvasNode" ? generateOnCanvasViaDom : generateOnCanvasViaAgent;
      const { projectId, startedAt, targetId } = await flow({
        signal, kind: "video", modelLabel, prompt: request.prompt, ratio,
        resolution: /7|1080/.test(resolution) ? "1080p" : "720p",
        durationSeconds: request.duration,
      });
      const resourceId = await waitForCanvasResource({ signal, projectId, prompt: request.prompt, startedAt, mediaType: "video", maxPolls: 200 });
      const assets = await pollCanvasResources({ signal, projectId, resourceIds: [resourceId], knownUris: [], mediaType: "video", pollMs: 8000, maxPolls: 60 });
      await closeCanvasTab(targetId);
      return assets;
    }
    // 视频统一走画布节点（octo）；nodeType=2 按 resource_type 推断，未实机验证
    const refInputs = [
      ...(request.firstFrame ? [request.firstFrame] : []),
      ...(request.images ?? []),
      ...(request.lastFrame ? [request.lastFrame] : []),
    ].slice(0, 2);
    const refUris = signal ? await Promise.all(refInputs.map((image) => uploadReference(image, signal))) : [];
    const { resourceIds, projectId } = await generateOnCanvas({
      signal,
      nodeType: 2,
      videoParams: {
        model_name: request.model,
        prompt: request.prompt,
        aspect_ratio: ratio,
        resolution,
        ...(request.duration ? { duration_ms: Math.round(request.duration * 1000) } : {}),
      },
      materialUris: refUris,
    });
    return pollCanvasResources({ signal, projectId, resourceIds, knownUris: refUris, mediaType: "video", pollMs: 8000, maxPolls: 120 });
  },
} satisfies ProviderDefinition<typeof rules>;

/** octo 模型 id → 画布 UI 显示名（DOM/agent 模式按此文本选择）。 */
function modelLabelOf(modelId: string): string {
  const labels: Record<string, string> = {
    "seedream_5.0_pro": "Seedream 5.0 Pro",
    "high_aes_general_v50_flash": "Seedream 5.0 Flash",
    "jm_image_model_yc_mj82": "图片美学模型 V8.2",
    "seedream_5.0_lite": "Seedream 5.0 Lite",
    "seedream_4.7": "Seedream 4.7",
    "seedream_4.6": "Seedream 4.6",
    "seedream_4.5": "Seedream 4.5",
    "seedream_4.1": "Seedream 4.1",
    "seedream_4.0": "Seedream 4.0",
    "seedance_2.5_draft": "Seedance 2.5",
    "seedance_2.5": "Seedance 2.5",
    "seedance_2.0_mini": "Seedance 2.0 mini",
    "seedance_2.0_fast_vip": "Seedance 2.0 Fast VIP",
    "seedance_2.0_vip": "Seedance 2.0 VIP",
    "seedance_pro_fast": "Seedance 1.0 Fast",
    "happyhorse_1.1": "HappyHorse 1.1",
    "wan_3.0": "Wan 3.0",
  };
  return labels[modelId] ?? modelId;
}

function normalizeResolution(size: string): string {
  const normalized = size.toUpperCase().replace(/\s/g, "");
  if (normalized.includes("1K")) return "1K";
  if (normalized.includes("1.5K")) return "1.5K";
  if (normalized.includes("4K")) return "4K";
  return "2K";
}
