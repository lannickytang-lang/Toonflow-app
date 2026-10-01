import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolDefinition, ToolPlugin } from "@toonflow/tools-scaffold/runtime";

const nameSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/, "模板名称只能包含中文、字母、数字、下划线和短横线");

const scriptGuide = `脚本是纯前端执行的 JS 源码,必须定义名为 parse 的函数: function parse(raw) { ... return { assets: [{ name, imagePrompt, filePath?, videoPath? }], scenes: [{ sortNum, videoPrompt, cast: [资产名] }] } }。
raw 是分镜脚本的完整原文文本。sortNum 为数字,cast 为出境资产的 name 数组;filePath/videoPath 仅在原文明确给出参考图/参考音频路径时填写,否则省略。
不得使用 import/require、fetch 或 Node API;一次 return 全部结果,不要输出任务 ID。`;

function rootDirectory() {
  const dataDirectory = process.env.TOONFLOW_DATA_DIR;
  if (!dataDirectory) throw new Error("数据目录未初始化");
  return path.join(dataDirectory, "storyboardTemplates");
}

function checkName(name: unknown): string {
  return nameSchema.parse(name);
}

async function writeTemplate(name: string, description: string, script: string) {
  const directory = path.join(rootDirectory(), name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "script.js"), script, "utf8");
  const previous = await readFile(path.join(directory, "meta.json"), "utf8").catch(() => "{}");
  const meta = JSON.parse(previous) as { description?: string };
  await writeFile(path.join(directory, "meta.json"), JSON.stringify({ name, description: description || meta.description || "", updatedAt: new Date().toISOString() }, null, 2), "utf8");
  return { name, description: description || meta.description || "" };
}

function createTemplateTools(): ToolDefinition[] {
  return [
    {
      name: "listStoryboardTemplates",
      label: "列出导入模板",
      description: "列出全部已保存的分镜导入模板及其规律说明。",
      parameters: z.toJSONSchema(z.strictObject({}), { io: "input", target: "draft-07" }),
      async execute(_id, _params, signal) {
        signal?.throwIfAborted();
        const entries = await readdir(rootDirectory(), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
        return Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
          const meta = await readFile(path.join(rootDirectory(), entry.name, "meta.json"), "utf8").then(content => JSON.parse(content) as { description?: string; updatedAt?: string }).catch(() => ({}));
          return { name: entry.name, description: meta.description ?? "", updatedAt: meta.updatedAt ?? "" };
        }));
      },
    },
    {
      name: "getStoryboardTemplate",
      label: "读取导入模板",
      description: "读取指定模板的规律说明与完整解析脚本。",
      parameters: z.toJSONSchema(z.strictObject({ name: nameSchema }), { io: "input", target: "draft-07" }),
      async execute(_id, params, signal) {
        const { name } = z.strictObject({ name: nameSchema }).parse(params);
        signal?.throwIfAborted();
        const directory = path.join(rootDirectory(), name);
        const meta = await readFile(path.join(directory, "meta.json"), "utf8").then(content => JSON.parse(content) as { description?: string }).catch(() => ({}));
        const script = await readFile(path.join(directory, "script.js"), "utf8");
        return { name, description: meta.description ?? "", script };
      },
    },
    {
      name: "saveStoryboardTemplate",
      label: "保存导入模板",
      description: `保存分镜导入模板(同名覆盖)。${scriptGuide}`,
      parameters: z.toJSONSchema(z.strictObject({ name: nameSchema, description: z.string().max(4000), script: z.string().min(1).max(1024 * 1024) }), { io: "input", target: "draft-07" }),
      async execute(_id, params, signal) {
        const args = z.strictObject({ name: nameSchema, description: z.string().max(4000), script: z.string().min(1).max(1024 * 1024) }).parse(params);
        signal?.throwIfAborted();
        return writeTemplate(args.name, args.description, args.script);
      },
    },
    {
      name: "renameStoryboardTemplate",
      label: "重命名导入模板",
      description: "重命名分镜导入模板;目标名称已存在时报错。",
      parameters: z.toJSONSchema(z.strictObject({ name: nameSchema, target: nameSchema }), { io: "input", target: "draft-07" }),
      async execute(_id, params, signal) {
        const { name, target } = z.strictObject({ name: nameSchema, target: nameSchema }).parse(params);
        signal?.throwIfAborted();
        const source = path.join(rootDirectory(), name);
        const targetDirectory = path.join(rootDirectory(), target);
        await mkdir(rootDirectory(), { recursive: true });
        await rename(source, targetDirectory).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") throw new Error("模板不存在");
          if (error.code === "EEXIST" || error.code === "ENOTEMPTY") throw new Error("目标模板名称已存在");
          throw error;
        });
        return { name: target };
      },
    },
    {
      name: "pushStoryboardImport",
      label: "推送分镜导入数据",
      description: `把解析好的分镜数据推送到用户画布的「导入分镜脚本」组件(用户会看到弹框自动打开并填入表格,仍需手动检查并确认导入)。仅在规律经用户确认后调用;调用前应先保存或已存在对应模板。assets 每项含 name(必填)、imagePrompt、filePath(已有参考图时填工作区相对路径)、videoPath;scenes 每项含 sortNum(数字)、videoPrompt(必填)、cast(出境资产 name 数组)；其余非标准字段(如 videoPromptZh)随项透传,导入后归集进视频节点 tags。`,
      parameters: z.toJSONSchema(z.strictObject({
        assets: z.array(z.object({
          name: z.string().min(1),
          imagePrompt: z.string().default(""),
          filePath: z.string().default(""),
          videoPath: z.string().default(""),
        }).catchall(z.json())).max(500).default([]),
        scenes: z.array(z.object({
          sortNum: z.number().int().min(1).default(1),
          videoPrompt: z.string().min(1),
          cast: z.array(z.string()).max(50).default([]),
        }).catchall(z.json())).max(500).default([]),
      }), { io: "input", target: "draft-07" }),
      async execute(_id, params, signal) {
        const args = z.strictObject({
          assets: z.array(z.object({
            name: z.string().min(1),
            imagePrompt: z.string().default(""),
            filePath: z.string().default(""),
            videoPath: z.string().default(""),
          }).catchall(z.json())).max(500).default([]),
          scenes: z.array(z.object({
            sortNum: z.number().int().min(1).default(1),
            videoPrompt: z.string().min(1),
            cast: z.array(z.string()).max(50).default([]),
          }).catchall(z.json())).max(500).default([]),
        }).parse(params);
        signal?.throwIfAborted();
        // ACT: server 独立进程端口固定 47392(apps/server/src/index.ts);推送事件到已连接的导入组件。
        const response = await fetch("http://127.0.0.1:47392/api/storyboardImport/push", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1", Origin: "http://localhost:47392" },
          body: JSON.stringify(args),
          signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.code !== 200) throw new Error(`推送失败：${data.message || `HTTP ${response.status}`}`);
        if (!data.data?.delivered) throw new Error("画布的导入组件尚未打开（未连接），请让用户打开画布左下角的「导入分镜脚本」后再试");
        return { pushed: true, delivered: data.data.delivered, assets: args.assets.length, scenes: args.scenes.length };
      },
    },
    {
      name: "deleteStoryboardTemplate",
      label: "删除导入模板",
      description: "删除指定分镜导入模板。",
      parameters: z.toJSONSchema(z.strictObject({ name: nameSchema }), { io: "input", target: "draft-07" }),
      async execute(_id, params, signal) {
        const { name } = z.strictObject({ name: nameSchema }).parse(params);
        signal?.throwIfAborted();
        await rm(path.join(rootDirectory(), name), { recursive: true }).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") throw new Error("模板不存在");
          throw error;
        });
        return { deleted: name };
      },
    },
  ];
}

const plugin: ToolPlugin = {
  validateConfig: config => config,
  createTools() {
    return createTemplateTools();
  },
};

export default plugin;
