import { Router } from "express";
import { success } from "@/lib/responseFormat";

const router = Router();

// 外部 Agent 冷启动引导语（首页"复制引导语"取此处文案）：单一源头在 server。
// 极简指路：tdd install 装技能后按技能（tdd/SKILL.md）干活；安装链仅作 tdd 不存在时的兜底。
const centerCliZip = "https://gitee.com/comtudodo/tudodo-center/raw/master/dist/cli/cli-tdd-toonflow.zip";

export default router.get("/", async (_req, res) => {
  const prompt = `请通过 Toonflow CLI（命令 tdd）操作我本机的 Toonflow，完成我交给你的任务：
1. 执行 tdd install 安装/更新 tdd 技能（环境就绪流程、命令用法与常见场景都在技能内，秒级幂等），然后按技能指引开始任务；首次安装后若技能未被自动加载，直接读技能目录（tdd install 输出的宿主路径）下的 tdd/SKILL.md；
2. 若 tdd 命令不存在：python --version 自检（不可用先装：Windows 用 winget install Python.Python.3.12，macOS 用 brew install python3）→ curl -L -o cli-tdd-toonflow.zip ${centerCliZip} && python -m pip install cli-tdd-toonflow.zip → tdd install；
3. 地址一律 127.0.0.1，勿用 localhost；命令报"无法连接 server"时提醒我先启动 Toonflow；高风险操作（删除节点、覆盖文件、批量消耗生成额度）先给我选项确认。

我的任务：`;

  res.json(success({ prompt }));
});
