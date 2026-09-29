import { Router } from "express";
import { readdir, stat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { success } from "@/lib/responseFormat";
import conf from "@/utils/conf";

const router = Router();

export default router.get("/", async (_req, res) => {
  const workspaceRoot = resolve(dirname(conf.path), "workspaces");
  const entries = await readdir(workspaceRoot, { withFileTypes: true }).catch(() => []);
  const projects: { name: string; directory: string; modifiedAt: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(workspaceRoot, entry.name);
    const info = await stat(directory).catch(() => null);
    projects.push({ name: entry.name, directory, modifiedAt: info?.mtimeMs ?? 0 });
  }
  projects.sort((left, right) => right.modifiedAt - left.modifiedAt);
  res.json(success(projects));
});
