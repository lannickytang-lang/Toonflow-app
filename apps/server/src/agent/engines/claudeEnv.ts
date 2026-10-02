import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { languageProviders } from "@toonflow/providers";
import { z } from "zod";
import { loadAgentSkills } from "@/agent/skills";
import conf from "@/utils/conf";
import { providerSchema } from "@/utils/ai";
import { getMcpSettings } from "@/utils/mcp/control";
import { getMcpRuntime } from "@/utils/mcp/runtime";

const injectedManifest = ".toonflowInjected";

export type EngineProviderConfig = { apiKey: string; apiUrl: string; modelIds: string[] };

// 解析引擎型供应商配置：用户已添加的条目优先，未添加回退内置定义（key/地址为空 = CLI 自身认证）。
export function resolveEngineProvider(providerId: string): EngineProviderConfig {
  const definition = languageProviders.find(provider => provider.kind === "engine" && provider.id === providerId);
  if (!definition) throw Object.assign(new Error(`未知的引擎供应商：${providerId}`), { status: 400 });
  const providers = conf.get("settings", {}).customProviders;
  const parsed = providerSchema.safeParse(Array.isArray(providers) ? providers.find(item => item?.id === providerId) : undefined);
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

// 平台技能注入：工作区 + 全局技能同步复制到 <cwd>/.claude/skills/<name>/（引擎原生发现位置）。
// 只管理带 .toonflowInjected 清单的目录，用户自建技能不碰；每次对话轮前调用，保持增量同步。
export async function syncClaudeSkills(cwd: string): Promise<void> {
  const { skills } = loadAgentSkills(cwd);
  const targetRoot = join(cwd, ".claude", "skills");
  const manifestPath = join(targetRoot, injectedManifest);
  const previous: string[] = await readFile(manifestPath, "utf8").then(text => JSON.parse(text)).catch(() => []);
  await mkdir(targetRoot, { recursive: true });
  const current: string[] = [];
  for (const skill of skills) {
    if (skill.disableModelInvocation) continue;
    const source = dirname(skill.filePath);
    const target = join(targetRoot, skill.name);
    await rm(target, { recursive: true, force: true });
    await cp(source, target, { recursive: true });
    current.push(skill.name);
  }
  for (const name of previous) {
    if (current.includes(name)) continue;
    await rm(join(targetRoot, name), { recursive: true, force: true });
  }
  await writeFile(manifestPath, JSON.stringify(current));
}

export function buildClaudeSystemPrompt(cwd: string): string {
  const skillRoot = join(cwd, ".claude", "skills");
  const skillNames = existsSync(skillRoot)
    ? readdirSync(skillRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
    : [];
  const skillLine = skillNames.length ? `工作区已注入平台技能（${skillNames.slice(0, 12).join("、")}${skillNames.length > 12 ? " 等" : ""}），可用 Skill 工具或 /技能名 调用。` : "";
  return [
    "你运行在 Toonflow 平台内，当前目录是用户的 Toonflow 工作区（一个 AI 视频制作平台的项目目录）。",
    "通过 toonflow MCP 工具集操作平台能力：画布节点操作、媒体生成、工作区文件，以及 askUser——需要用户确认、在多个方案间选择或补充信息时调用 askUser，它会弹出界面并等待用户回答，不要在缺乏关键信息时自行假设。",
    skillLine,
    "资源或数据可能不存在：先快速探测（1-2 条命令），缺失时如实说明并停止，不要编造。",
  ].filter(Boolean).join("\n");
}
