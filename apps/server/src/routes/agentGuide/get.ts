import { Router } from "express";
import { success } from "@/lib/responseFormat";

const router = Router();

// 外部 Agent 冷启动引导语（首页"复制引导语"取此处文案）：单一源头在 server。
// CLI 为 Python 包（命令 tdd），统一走中心 zip 远程安装（Gitee 对 pip 直链 403，须先 curl 下载）；
// 本地 pip install -e 仅开发环境自用，不进引导语。
const installCommand = "curl -L -o cli-tdd-toonflow.zip https://gitee.com/comtudodo/tudodo-center/raw/master/dist/cli/cli-tdd-toonflow.zip && python -m pip install cli-tdd-toonflow.zip";

export default router.get("/", async (_req, res) => {
  const prompt = `请通过 Toonflow CLI（命令 tdd）操作我本机的 Toonflow，完成我交给你的任务：
1. 前置自检（仅首次）：执行 python --version（或 python3 --version / py -3 --version）；若 python 不可用先安装：Windows 用 winget install Python.Python.3.12，macOS 用 brew install python3，装好后重开终端再继续；
2. 安装 CLI（仅首次，秒级）：
   ${installCommand}
3. 首次使用先执行一次 tdd install（把画布操作技能装进你的技能目录，秒级幂等），再 tdd --help 自学全部命令；工作区用 project open <绝对目录> 打开并记住默认（或 -w 单次指定——-w 等全局选项必须写在子命令之前，如 tdd -w <目录> queue status）；地址一律 127.0.0.1，勿用 localhost；
4. 常用：批量生成挂机 queue status --watch ｜ 产物交付 queue export --verify ｜ 排查画布现状 canvas report（--explain 看画布 JSON 字段说明）｜ 需要截图时 canvas fit [--nodes ...] 调整视口后用你的浏览器截图；
5. 命令报"无法连接 server"时，提醒我先启动 Toonflow 再重试；高风险操作（删除节点、覆盖文件、批量消耗生成额度）先给我选项确认；真实供应商凭证用 config set 配置。

我的任务：`;

  res.json(success({ prompt, installCommand }));
});
