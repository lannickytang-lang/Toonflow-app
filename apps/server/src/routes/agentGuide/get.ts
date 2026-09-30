import { Router } from "express";
import { success } from "@/lib/responseFormat";

const router = Router();

// 外部 Agent 冷启动引导语（首页"复制引导语"取此处文案）：单一源头在 server。
// 极简指路：tdd install 装技能后按技能（tdd/SKILL.md）干活；安装链仅作 tdd 不存在时的兜底。
const centerCliZip = "https://gitee.com/comtudodo/tudodo-center/raw/master/dist/cli/cli-tdd-toonflow.zip";

export default router.get("/", async (_req, res) => {
  const prompt = `请通过 Toonflow CLI（命令 tdd）操作我本机的 Toonflow，完成我交给你的任务：
1. tdd 命令可用 → 执行 tdd install 安装/更新技能（幂等秒级；知道自己的技能目录时用 tdd install --hosts <目录> 直达），按 tdd-auto 技能指引完成任务；技能安装失败/出现 404 时多为 CLI 版本过旧，先 tdd update 再重试；
2. tdd 命令不可用 → python 不可用先装（Windows: winget install Python.Python.3.12；macOS: brew install python3），然后：
   curl -L -o cli-tdd-toonflow.zip ${centerCliZip} && python -m pip install cli-tdd-toonflow.zip
   装好后回到第 1 步；
3. 高风险操作（删除、覆盖、批量消耗生成额度）先给我选项确认。

我的任务：`;

  res.json(success({ prompt }));
});
