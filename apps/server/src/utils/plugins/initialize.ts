import { copyFile, cp, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ACT: 无 revision 的初始化（供应商/技能/团队）逐条目补装：已存在跳过（保留用户编辑），缺失补齐——新收录内容对存量用户自动到达。
export default async function initializePlugins(targetDirectory: string, sourceDirectory: string, fileFilter?: RegExp | readonly string[], revision?: string) {
  const entries = await readdir(sourceDirectory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  // 种子目录缺失时跳过安装并上报，由调用方提示（源码方式常见于未构建插件产物）。
  if (!entries) return { installed: 0, sourceMissing: true };

  const files = entries.filter(file => fileFilter
    ? file.isFile() && (fileFilter instanceof RegExp ? fileFilter.test(file.name) : fileFilter.includes(file.name))
    : file.isDirectory());
  await mkdir(targetDirectory, { recursive: true });

  if (revision === undefined) {
    let installed = 0;
    for (const file of files) {
      const target = resolve(targetDirectory, file.name);
      if (existsSync(target)) continue;
      await cp(resolve(sourceDirectory, file.name), target, { recursive: true });
      installed++;
    }
    return { installed, sourceMissing: false };
  }

  // 有 revision（节点/工具）：同一构建只同步一次；安装器移除标记以支持同版本重装，构建变化支持升级和降级。
  const marker = resolve(targetDirectory, "initialized");
  const initialized = await readFile(marker, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (initialized !== null && initialized === revision) return { installed: 0, sourceMissing: false };

  for (const file of files) {
    const source = resolve(sourceDirectory, file.name);
    const target = resolve(targetDirectory, file.name);
    // ACT: 版本同步仅覆盖节点和工具单文件；同目录 rename 保留失败时的旧文件。
    const temporary = resolve(targetDirectory, `.pluginSync${crypto.randomUUID()}`);
    try {
      await copyFile(source, temporary);
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    }
  }
  await writeFile(marker, revision, { flag: "w" });
  return { installed: files.length, sourceMissing: false };
}
