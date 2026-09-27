import { createToolConfig } from "@toonflow/tools-scaffold";

await createToolConfig({
  name: "storyboardTemplate",
  displayName: "分镜导入模板",
  description: "管理分镜脚本解析模板：列出、读取、保存、改名和删除。模板在导入组件中执行，把任意格式的分镜脚本原文转换成资产/分镜 JSON。",
  prompt: `模板由解析脚本 script（定义 parse(raw) 函数，输入分镜原文文本，返回 { assets, scenes } JSON）和 description（规律说明）组成。
保存模板前先确认规律已与用户核对；修改模板脚本时直接调用 save 覆盖同名模板，并向用户说明改动点。
不要在脚本里访问网络或文件系统，脚本只在用户浏览器的导入组件中执行。`,
  author: "Toonflow",
  github: "https://github.com/HBAI-Ltd/Toonflow-app",
  configRules: [],
}, import.meta.url);
