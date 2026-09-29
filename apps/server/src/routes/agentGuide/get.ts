import { Router } from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { success } from "@/lib/responseFormat";
import conf from "@/utils/conf";

const router = Router();

// 外部 Agent 冷启动引导语（首页"复制引导语"取此处文案）：单一源头在 server，
// 按 CLI 可用性动态生成——源码模式给 bun scripts 路径，桌面给安装目录 exe，都没有退回 MCP 版。
export default router.get("/", async (_req, res) => {
  const dataDirectory = dirname(conf.path);
  const sourceCli = join(dataDirectory, "..", "scripts", "toonflow.ts");
  const desktopCli = join(dataDirectory, "..", "toonflow.exe");
  // 统一输出正斜杠路径：Git Bash 会把反斜杠当转义符吞掉。
  let cliCommand: string | undefined;
  if (existsSync(sourceCli)) cliCommand = `bun ${sourceCli.split("\\").join("/")}`;
  else if (existsSync(desktopCli)) cliCommand = desktopCli.split("\\").join("/");

  const prompt = cliCommand
    ? `请通过 Toonflow CLI 操作我本机的 Toonflow，完成我交给你的任务：
1. 首次先执行一次安装（秒级，会把画布操作技能装进你的技能目录）：
   ${cliCommand} install
2. 用 ${cliCommand} --help 自学全部命令；工作区用 -w <绝对目录> 指定（project open 后可记住）；地址一律 127.0.0.1，勿用 localhost；批量生成挂机用 queue status --watch，产物交付用 queue export --verify；
3. 排查画布现状用 canvas report（--explain 看画布 JSON 字段说明）；需要截图时用 canvas fit [--nodes ...] 调整视口后用你的浏览器截图；
4. 高风险操作（删除节点、覆盖文件、批量消耗生成额度）先给我选项确认；真实供应商凭证用 config set 配置。

我的任务：`
    : `请通过 MCP 操作我本机的 Toonflow，完成我交给你的任务：
1. 把 http://127.0.0.1:10588/mcp（免鉴权，Streamable HTTP；连不上则按 10589、10590…顺延探测）注册为你宿主的原生 MCP server（ZCode：项目 .mcp.json；Claude Code：claude mcp add；Codex：config.toml 的 [mcp_servers]）；
2. 读 https://gitee.com/comtudodo/tudodo-center/raw/master/AGENTS.md 学习用法，并按 manifest 安装画布操作技能；
3. 调用 getAppState 确认连接；无页面连接时优先用你宿主的内嵌浏览器打开返回的 suggestedPageUrl，无内嵌浏览器再调 openApp；用 openProject 打开或创建工作区后按教程执行；
4. 高风险操作（删除节点、覆盖文件、批量消耗生成额度）先给我选项确认。

我的任务：`;

  res.json(success({ prompt, cliCommand: cliCommand ?? null }));
});
