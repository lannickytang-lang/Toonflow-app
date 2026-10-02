import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentEngineSettings, getEngineEnvironment, getEngineTimeout } from "@/agent/engines/engineRuntime";
import { resolveEngineProvider } from "@/agent/engines/claudeEnv";
import { getMcpSettings } from "@/utils/mcp/control";
import { getMcpRuntime } from "@/utils/mcp/runtime";
import { getCodexModels } from "@/agent/engines/models";

export async function prepareCodexEnvironment(providerId: string, modelId?: string, codexReasoningEffort?: string) {
  const settings = getAgentEngineSettings();
  const provider = resolveEngineProvider(providerId);
  if (modelId && !provider.modelIds.includes(modelId) && (provider.apiUrl || provider.apiKey || !(await getCodexModels()).models.some(model => model.id === modelId))) throw Object.assign(new Error("所选模型不在 Codex 供应商或本机模型列表中，请重新选择"), { status: 400 });
  const mcp = getMcpSettings();
  const endpoint = getMcpRuntime().endpoint;
  if (!mcp.enabled || !endpoint) throw Object.assign(new Error("请先在设置中启用 MCP，官方引擎依赖它调用平台工具"), { status: 400 });
  if (mcp.auth && mcp.token.length < 32) throw Object.assign(new Error("MCP 访问凭证无效，请重新配置"), { status: 400 });
  const env = getEngineEnvironment(settings);
  const args = ["--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"];
  const config = (name: string, value: string | number | boolean | string[]) => args.push("-c", `${name}=${JSON.stringify(value)}`);
  args.push("-c", `mcp_servers.toonflow={url=${JSON.stringify(endpoint)},required=true,tool_timeout_sec=1800${mcp.auth ? ',bearer_token_env_var="TOONFLOW_MCP_TOKEN"' : ""}}`);
  // 通知回调属于桌面宿主；桥接回合由 Toonflow 展示，不额外调用本机通知程序。
  config("notify", []);
  if (mcp.auth) {
    env.TOONFLOW_MCP_TOKEN = mcp.token;
  }
  if (provider.apiUrl || provider.apiKey) {
    const url = new URL(provider.apiUrl || "https://api.openai.com/v1");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Codex API 地址必须是有效的 HTTP 基础地址");
    config("model_provider", "toonflow");
    // 整个条目覆盖，避免同名本机 provider 留下旧 env_key/header。
    const values = [
      'name="Toonflow"', `base_url=${JSON.stringify(url.href.replace(/\/$/, ""))}`,
      'wire_api="responses"', "requires_openai_auth=false", "supports_websockets=false",
      ...(provider.apiKey ? ['env_key="TOONFLOW_PROVIDER_KEY"'] : []),
    ];
    args.push("-c", `model_providers.toonflow={${values.join(",")}}`);
    if (provider.apiKey) env.TOONFLOW_PROVIDER_KEY = provider.apiKey;
    else delete env.TOONFLOW_PROVIDER_KEY;
  }
  if (modelId) args.push("-m", modelId);
  if (codexReasoningEffort) {
    const catalog = await getCodexModels();
    const model = catalog.models.find(item => item.id === (modelId || catalog.defaultModel));
    if (!model?.reasoningEfforts?.includes(codexReasoningEffort)) throw Object.assign(new Error("该模型未声明支持所选思考强度，请选择默认或支持的档位"), { status: 400 });
    config("model_reasoning_effort", codexReasoningEffort);
  }
  const secrets = [provider.apiKey, mcp.token].filter(Boolean);
  const redact = (text: string) => secrets.reduce((value, secret) => value.replaceAll(secret, "[已隐藏]"), text);
  return { executable: settings.codexPath?.trim() || "codex", args, env, timeoutMs: getEngineTimeout(settings), redact };
}

export function buildCodexFirstPrompt(cwd: string, names: string[], prompt: string) {
  return [
    "[Toonflow 工作区说明，仅在新原生会话首轮提供]",
    "你在 Toonflow AI 视频制作平台内运行。当前工作区：" + JSON.stringify(cwd) + "。",
    "调用 toonflow MCP 业务工具时必须显式传 target.directory 为此工作区，不随页面切换更改目标。画布修改与媒体生成使用平台工具，禁止直接修改画布 JSON。",
    "需要确认或补充信息时调用 toonflow 的 askUser，由平台界面等待用户回答。不要等待原生终端输入。",
    names.length ? `项目已注入技能：${names.join("、")}；按 Codex 自身技能机制读取并使用。` : "",
    "先快速探测资源；缺失时如实说明，不要编造。",
    "[用户本轮消息]",
    prompt || "请查看附带的图片。",
  ].filter(Boolean).join("\n");
}

// thread.started 早于输入提交；首轮被停止时只读原生记录确认，避免漏注入或重放已取消任务。
export async function codexBootstrapWasSubmitted(env: NodeJS.ProcessEnv, threadId: string) {
  const home = env.CODEX_HOME || join(env.USERPROFILE || env.HOME || homedir(), ".codex");
  async function find(directory: string, depth: number): Promise<string | undefined> {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    const file = entries.find(entry => entry.isFile() && entry.name.endsWith(`-${threadId}.jsonl`));
    if (file) return join(directory, file.name);
    if (!depth) return;
    for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name))) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const result = await find(join(directory, entry.name), depth - 1);
      if (result) return result;
    }
  }
  const path = await find(join(home, "sessions"), 3);
  if (!path) return false;
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    if (!line.includes("[Toonflow 工作区说明")) continue;
    const row = JSON.parse(line);
    if (row.type === "response_item" && row.payload?.type === "message" && row.payload.role === "user") return true;
  }
  return false;
}
