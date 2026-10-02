import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { languageProviders } from "@toonflow/providers";
import { z } from "zod";
import { syncEngineSkills } from "@/agent/engines/skillLinks";
import conf from "@/utils/conf";
import { providerSchema } from "@/utils/ai";
import { getMcpSettings } from "@/utils/mcp/control";
import { getMcpRuntime } from "@/utils/mcp/runtime";

export type EngineProviderConfig = { apiKey: string; apiUrl: string; modelIds: string[] };

// 解析引擎型供应商配置：用户已添加的条目优先，未添加回退内置定义（key/地址为空 = CLI 自身认证）。
export function resolveEngineProvider(providerId: string): EngineProviderConfig {
  const definition = languageProviders.find(provider => provider.kind === "engine" && provider.id === providerId);
  if (!definition) throw Object.assign(new Error(`未知的引擎供应商：${providerId}`), { status: 400 });
  const providers = conf.get("settings", {}).customProviders;
  const entry = Array.isArray(providers) ? providers.find(item => item?.id === providerId) : undefined;
  const parsed = providerSchema.extend({ apiUrl: providerSchema.shape.apiUrl.or(z.literal("")) }).safeParse(entry);
  if (entry !== undefined && !parsed.success) throw Object.assign(new Error("引擎供应商配置格式错误，请重新保存配置"), { status: 400 });
  const configured = parsed.success ? parsed.data : undefined;
  return {
    apiKey: configured?.apiKey ?? "",
    apiUrl: configured?.apiUrl ?? "",
    modelIds: (configured?.models.length ? configured.models : definition.models).map(model => model.id),
  };
}

// 生成 claude --mcp-config 文件：HTTP 直连本机 Toonflow /mcp 端点。
// 不用 stdio 桥（spawn bun 子进程在无 console 宿主下会弹 cmd 窗口），claude 原生支持 http transport。
export function prepareMcpConfig(): string {
  const settings = getMcpSettings();
  const endpoint = getMcpRuntime().endpoint;
  if (!settings.enabled || !endpoint) {
    throw Object.assign(new Error("请先在设置中启用 MCP，官方引擎依赖它调用平台工具"), { status: 400 });
  }
  const configPath = join(dirname(conf.path), "claudeMcp.json");
  const server: Record<string, unknown> = { type: "http", url: endpoint };
  if (settings.auth && settings.token) server.headers = { Authorization: `Bearer ${settings.token}` };
  writeFileSync(configPath, JSON.stringify({ mcpServers: { toonflow: server } }));
  return configPath;
}

export function syncClaudeSkills(cwd: string) {
  return syncEngineSkills(cwd, "claude-code");
}

export function buildClaudeSystemPrompt(cwd: string, skillNames: string[]): string {
  const skillLine = skillNames.length ? `工作区已注入平台技能（${skillNames.slice(0, 12).join("、")}${skillNames.length > 12 ? " 等" : ""}），可用 Skill 工具或 /技能名 调用。` : "";
  return [
    "你运行在 Toonflow 平台内，当前目录是用户的 Toonflow 工作区（一个 AI 视频制作平台的项目目录）。",
    `业务 MCP 工具必须显式传 target.directory=${JSON.stringify(cwd)}，不随页面切换更改目标。`,
    "通过 toonflow MCP 工具集操作平台能力：画布节点操作、媒体生成、工作区文件，以及 askUser——需要用户确认、在多个方案间选择或补充信息时调用 askUser，它会弹出界面并等待用户回答，不要在缺乏关键信息时自行假设。",
    skillLine,
    "资源或数据可能不存在：先快速探测（1-2 条命令），缺失时如实说明并停止，不要编造。",
  ].filter(Boolean).join("\n");
}
