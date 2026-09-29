import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspacePath, writeWorkspaceFile } from "@/utils/workspace/files";

// 画布文档的唯一读写入口：AI 后端操作与页面保存共用，revision 乐观锁 + 同文档写串行化，
// 保证「页面与 AI 互不覆盖」（AC-3）与多页面/多请求并发安全。

export type CanvasNode = Record<string, unknown> & { id: string; type?: string; position?: { x: number; y: number }; data?: Record<string, unknown> };
export type CanvasDocument = {
  toonflowCanvas: true;
  nodes: CanvasNode[];
  edges: Record<string, unknown>[];
  viewport?: Record<string, unknown>;
  revision?: number;
};

export class CanvasConflictError extends Error {
  status = 409;
  constructor(currentRevision: number) {
    super(`画布已被其他端修改（当前版本 ${currentRevision}），请重新读取画布后再保存`);
    this.name = "CanvasConflictError";
  }
}

// 同一画布的写入串行队列；读取不入队。
const writeQueues = new Map<string, Promise<unknown>>();

function queueKey(directory: string, canvasId: string) {
  return `${directory.toLowerCase()}::${canvasId.toLowerCase()}`;
}

function isCanvasDocument(value: unknown): value is CanvasDocument {
  const document = value as CanvasDocument;
  return !!document && document.toonflowCanvas === true && Array.isArray(document.nodes) && Array.isArray(document.edges);
}

export async function listCanvasFiles(directory: string) {
  const { path: root } = await resolveWorkspacePath(directory, "");
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const canvases: { id: string; revision: number; nodeCount: number; edgeCount: number }[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const raw = await readFile(join(root, entry.name), "utf8").catch(() => null);
    if (raw === null) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { continue; }
    if (!isCanvasDocument(parsed)) continue;
    canvases.push({ id: entry.name, revision: parsed.revision ?? 0, nodeCount: parsed.nodes.length, edgeCount: parsed.edges.length });
  }
  return canvases.sort((left, right) => left.id.localeCompare(right.id, "zh-Hans-CN", { numeric: true }));
}

async function parseCanvasFile(directory: string, canvasId: string) {
  const { path } = await resolveWorkspacePath(directory, canvasId);
  const raw = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (raw === null) return { path, document: null as CanvasDocument | null };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`画布文件不是有效 JSON：${canvasId}`); }
  if (!isCanvasDocument(parsed)) throw new Error(`文件不是有效画布：${canvasId}`);
  return { path, document: parsed };
}

export async function readCanvasDocument(directory: string, canvasId: string): Promise<{ document: CanvasDocument; revision: number }> {
  const { document } = await parseCanvasFile(directory, canvasId);
  if (!document) throw Object.assign(new Error(`画布不存在：${canvasId}，可先 listCanvasFiles 查询`), { status: 404 });
  return { document, revision: document.revision ?? 0 };
}

type MutateOptions = { expectedRevision?: number };

/**
 * 串行读改写：mutator 直接修改文档对象，成功后 revision +1 并原子写盘。
 * expectedRevision 提供时做乐观锁校验（页面保存用）；AI 内部操作连续 mutate 时不传，
 * 由串行队列保证读到最新，避免「读-改-写」窗口错配。
 */
export async function mutateCanvasDocument<T>(
  directory: string,
  canvasId: string,
  mutator: (document: CanvasDocument) => T | Promise<T>,
  options: MutateOptions = {},
): Promise<{ document: CanvasDocument; revision: number; result: T }> {
  const key = queueKey(directory, canvasId);
  const run = (writeQueues.get(key) ?? Promise.resolve()).then(async () => {
    const { path, document } = await parseCanvasFile(directory, canvasId);
    if (!document) throw Object.assign(new Error(`画布不存在：${canvasId}，可先 listCanvasFiles 查询`), { status: 404 });
    const currentRevision = document.revision ?? 0;
    if (options.expectedRevision !== undefined && options.expectedRevision !== currentRevision) throw new CanvasConflictError(currentRevision);
    const result = await mutator(document);
    const revision = currentRevision + 1;
    document.revision = revision;
    await writeWorkspaceFile(path, JSON.stringify(document));
    return { document, revision, result };
  });
  // 队列只吞链式错误，不吞调用方结果。
  writeQueues.set(key, run.then(() => undefined, () => undefined));
  return run;
}

/** 新建画布（exclusive 原子创建，已存在即失败）；自动编号画布N。 */
export async function createCanvasDocument(directory: string, name?: string): Promise<{ document: CanvasDocument; canvasId: string; created: true }> {
  const { path: root } = await resolveWorkspacePath(directory, "");
  const existing = new Set((await listCanvasFiles(directory)).map(canvas => canvas.id));
  let fileName = name ? (/\.json$/.test(name) ? name : `${name}.json`) : "";
  if (!fileName) {
    let index = 1;
    while (existing.has(`画布${index}.json`)) index++;
    fileName = `画布${index}.json`;
  }
  if (existing.has(fileName)) throw Object.assign(new Error(`画布已存在：${fileName}`), { status: 409 });
  const document: CanvasDocument = { toonflowCanvas: true, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, revision: 1 };
  await writeWorkspaceFile(join(root, fileName), JSON.stringify(document), true);
  return { document, canvasId: fileName, created: true };
}

/** 页面保存入口：整文档替换 + 乐观锁。冲突时抛 CanvasConflictError，由路由转 409。 */
export async function saveCanvasDocument(
  directory: string,
  canvasId: string,
  content: unknown,
  expectedRevision: number,
): Promise<{ revision: number }> {
  if (!isCanvasDocument(content)) throw Object.assign(new Error("保存内容不是有效画布文档"), { status: 400 });
  const { revision } = await mutateCanvasDocument(directory, canvasId, document => {
    document.nodes = content.nodes;
    document.edges = content.edges;
    document.viewport = content.viewport;
  }, { expectedRevision });
  return { revision };
}
