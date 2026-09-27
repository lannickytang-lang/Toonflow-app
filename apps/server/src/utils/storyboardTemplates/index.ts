import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

function invalid(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

export const templateNameSchema = z.string().regex(/^[a-zA-Z0-9_\-\u4e00-\u9fa5]{1,64}$/, "模板名称只能包含中文、字母、数字、下划线和短横线,最长 64 字符");

type TemplateMeta = { name: string; description: string; updatedAt: string };

function rootDirectory() {
  const dataDirectory = process.env.TOONFLOW_DATA_DIR;
  if (!dataDirectory) throw new Error("数据目录未初始化");
  return path.join(dataDirectory, "storyboardTemplates");
}

function templateDirectory(name: string) {
  if (!templateNameSchema.safeParse(name).success) invalid("模板名称无效");
  return path.join(rootDirectory(), name);
}

async function readMeta(directory: string, name: string): Promise<TemplateMeta> {
  const raw = await readFile(path.join(directory, "meta.json"), "utf8").catch(() => "{}");
  const meta = JSON.parse(raw) as Partial<TemplateMeta>;
  return { name, description: typeof meta.description === "string" ? meta.description : "", updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : "" };
}

async function writeMeta(directory: string, meta: TemplateMeta) {
  await writeFile(path.join(directory, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
}

export async function listTemplates() {
  const entries = await readdir(rootDirectory(), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
    const directory = path.join(rootDirectory(), entry.name);
    const meta = await readMeta(directory, entry.name).catch(() => ({ name: entry.name, description: "模板元数据损坏", updatedAt: "" }));
    const hasScript = await readFile(path.join(directory, "script.js"), "utf8").then(() => true, () => false);
    return { ...meta, hasScript };
  }));
}

export async function getTemplate(name: string) {
  const directory = templateDirectory(name);
  const meta = await readMeta(directory, name);
  const script = await readFile(path.join(directory, "script.js"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") invalid("模板解析脚本不存在", 404);
    throw error;
  });
  return { ...meta, script };
}

export async function saveTemplate(name: string, description: string, script: string) {
  const directory = templateDirectory(name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "script.js"), script, "utf8");
  const meta = await readMeta(directory, name);
  await writeMeta(directory, { ...meta, description: description || meta.description, updatedAt: new Date().toISOString() });
  return { name, description: description || meta.description };
}

export async function renameTemplate(name: string, target: string) {
  const sourceDirectory = templateDirectory(name);
  const targetDirectory = templateDirectory(target);
  await mkdir(path.dirname(targetDirectory), { recursive: true });
  await rename(sourceDirectory, targetDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") invalid("模板不存在", 404);
    if (error.code === "EEXIST" || error.code === "ENOTEMPTY") invalid("目标模板名称已存在", 409);
    throw error;
  });
  const meta = await readMeta(targetDirectory, target);
  await writeMeta(targetDirectory, meta);
  return { name: target };
}

export async function deleteTemplate(name: string) {
  const directory = templateDirectory(name);
  await rm(directory, { recursive: true, force: false }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") invalid("模板不存在", 404);
    throw error;
  });
}

export default { templateNameSchema, listTemplates, getTemplate, saveTemplate, renameTemplate, deleteTemplate };
