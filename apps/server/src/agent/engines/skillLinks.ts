import { lstat, mkdir, readFile, readlink, realpath, symlink, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { loadAgentSkills } from "@/agent/skills";
import { isWithin, lockWorkspaceFiles, writeWorkspaceFile } from "@/utils/workspace/files";

const manifestSchema = z.union([z.array(z.string()), z.record(z.string(), z.string())]);
const normalizePath = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);

async function inspect(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return undefined; throw error; });
}

export async function syncEngineSkills(cwd: string, engine: "claude-code" | "codex") {
  const root = await realpath(cwd);
  const engineRoot = join(root, engine === "codex" ? ".codex" : ".claude");
  const targetRoot = join(engineRoot, "skills");
  for (const path of [engineRoot, targetRoot]) {
    const info = await inspect(path);
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error("引擎技能目录必须是工作区内的普通目录");
    if (!info) await mkdir(path);
    if (!isWithin(root, await realpath(path))) throw new Error("引擎技能目录超出工作区");
  }
  const release = lockWorkspaceFiles([targetRoot]);
  try {
    const manifestPath = join(targetRoot, ".toonflowInjected");
    const manifestInfo = await inspect(manifestPath);
    if (manifestInfo && (!manifestInfo.isFile() || manifestInfo.isSymbolicLink())) throw new Error("技能注入清单必须是普通文件");
    const raw = manifestInfo ? manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8"))) : {};
    const previous: Record<string, string> = Array.isArray(raw) ? Object.fromEntries(raw.map(name => [name, ""])) : raw;
    const current: Record<string, string> = {};
    const names: string[] = [];
    const conflicts: string[] = [];
    const selected = new Set<string>();
    const safeFolder = (name: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name);
    async function ownedLink(name: string) {
      if (!safeFolder(name) || !Object.hasOwn(previous, name) || !previous[name]) return false;
      const target = join(targetRoot, name);
      const info = await inspect(target);
      return Boolean(info?.isSymbolicLink() && normalizePath(await readlink(target)) === normalizePath(previous[name]));
    }
    for (const skill of loadAgentSkills(root).skills) {
      if (skill.disableModelInvocation) continue;
      // 外部技能名称保留；新链接目录统一小驼峰，既有清单目录保持兼容。
      const folder = Object.hasOwn(previous, skill.name) && safeFolder(skill.name) ? skill.name : skill.name.replace(/[-_ ]+([a-zA-Z0-9])/g, (_, letter: string) => letter.toUpperCase());
      if (!/^[a-z][a-zA-Z0-9]*$/.test(folder) && !Object.hasOwn(previous, folder)) throw new Error(`技能名称无法安全注入：${skill.name}`);
      if (selected.has(folder)) throw new Error(`技能链接目录名称冲突：${folder}`);
      selected.add(folder);
      const source = await realpath(dirname(skill.filePath));
      const target = join(targetRoot, folder);
      const info = await inspect(target);
      if (info) {
        if (!await ownedLink(folder)) { conflicts.push(skill.name); continue; }
        if (normalizePath(await readlink(target)) === normalizePath(source)) {
          current[folder] = source;
          names.push(skill.name);
          continue;
        }
        await unlink(target);
      }
      await symlink(source, target, process.platform === "win32" ? "junction" : "dir");
      current[folder] = source;
      names.push(skill.name);
    }
    for (const name of Object.keys(previous)) {
      if (selected.has(name)) continue;
      if (!safeFolder(name)) throw new Error("技能注入清单包含无效目录名");
      if (await ownedLink(name)) await unlink(join(targetRoot, name));
      else if (await inspect(join(targetRoot, name))) conflicts.push(name);
    }
    await writeWorkspaceFile(manifestPath, JSON.stringify(current));
    return { names, conflicts };
  } finally { release(); }
}
