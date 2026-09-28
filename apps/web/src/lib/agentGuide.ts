import { ElMessage } from "element-plus";
import { writeClipboardText } from "@/lib/clipboard";

// 外部 Agent 冷启动引导语:首页与对话面板欢迎区共用同一份。
export const agentGuidePrompt = `请通过 MCP 操作我本机的 Toonflow，完成我交给你的任务：
1. 连接 http://127.0.0.1:10588/mcp（免鉴权；连不上则按 10589、10590…顺延逐个探测）；
2. 读 https://gitee.com/comtudodo/tudodo-center/raw/master/AGENTS.md 学习用法，并按 manifest 安装画布操作技能；
3. 调用 getAppState 确认连接（无页面连接时先调 openApp 打开 Toonflow），用 openProject 打开或创建工作区，画布就绪后按教程执行；
4. 高风险操作（删除节点、覆盖文件、批量消耗生成额度）先给我选项确认。

我的任务：`;

export async function copyAgentGuide() {
  try {
    await writeClipboardText(agentGuidePrompt);
    ElMessage.success("引导语已复制，粘贴给外部 Agent 即可");
  } catch {
    // ACT: 本机与桌面页面均在安全上下文，剪贴板失败属于极端环境，引导手输。
    ElMessage.error("复制失败，请检查浏览器剪贴板权限");
  }
}
