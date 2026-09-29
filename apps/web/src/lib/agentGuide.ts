import { ElMessage } from "element-plus";
import { writeClipboardText } from "@/lib/clipboard";

// 本地兜底文案；实际优先取 /api/agent-guide（server 按 CLI 可用性动态生成 CLI 优先版）。
export const agentGuidePrompt = `请通过 MCP 操作我本机的 Toonflow，完成我交给你的任务：
1. 把 http://127.0.0.1:10588/mcp（免鉴权，Streamable HTTP；连不上则按 10589、10590…顺延探测）注册为你宿主的原生 MCP server（ZCode：项目 .mcp.json；Claude Code：claude mcp add；Codex：config.toml 的 [mcp_servers]）；
2. 读 https://gitee.com/comtudodo/tudodo-center/raw/master/AGENTS.md 学习用法，并按 manifest 安装画布操作技能；
3. 调用 getAppState 确认连接；无页面连接时优先用你宿主的内嵌浏览器打开返回的 suggestedPageUrl（地址一律用 127.0.0.1，勿用 localhost），无内嵌浏览器再调 openApp 用系统默认浏览器打开；用 openProject 打开或创建工作区，画布就绪后按教程执行；
4. 高风险操作（删除节点、覆盖文件、批量消耗生成额度）先给我选项确认。

我的任务：`;

async function resolveGuidePrompt() {
  try {
    const response = await fetch("/api/agentGuide/get", { headers: { "x-toonflow-workspace": "1" }, cache: "no-store" });
    if (!response.ok) return agentGuidePrompt;
    const body = await response.json() as { code?: number; data?: { prompt?: string } };
    return body.data?.prompt?.trim() ? body.data.prompt : agentGuidePrompt;
  } catch {
    return agentGuidePrompt;
  }
}

export async function copyAgentGuide() {
  try {
    await writeClipboardText(await resolveGuidePrompt());
    ElMessage.success("引导语已复制，粘贴给外部 Agent 即可");
  } catch {
    // ACT: 本机与桌面页面均在安全上下文，剪贴板失败属于极端环境，引导手输。
    ElMessage.error("复制失败，请检查浏览器剪贴板权限");
  }
}
