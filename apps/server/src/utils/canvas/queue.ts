import { stat } from "node:fs/promises";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { readCanvasDocument, type CanvasDocument } from "@/utils/canvas/repository";
import { runGeneration } from "@/utils/canvas/nodeTools";

// 画布生成队列：内存态（重启即清，靠 submitCanvasQueue --scope missing 从画布文档幂等重建）。
// 依赖编排：上游生成节点全部 succeeded 才调度下游；限流退避不计失败次数；单任务失败 3 次跳过不拖垮队列。

export type QueueTaskStatus = "pending" | "backoff" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";

export type QueueTask = {
  id: string;
  workspace: string;
  canvasId: string;
  nodeId: string;
  label: string;
  mediaType: "image" | "video";
  status: QueueTaskStatus;
  attempt: number;
  error?: string;
  logs: { at: number; level: "info" | "error"; message: string }[];
  deps: string[];
  backoffUntil?: number;
  submittedAt: number;
  startedAt?: number;
  finishedAt?: number;
};

export const maxAttempts = 3;
const rateLimitBackoffMs = 30_000;
const failedRetryDelayMs = 2_000;

// ACT: 单进程内存队列；server 重启即清空（设计决策），重建由 scope=missing 的重新提交完成。
const tasks = new Map<string, QueueTask>();
const nodeTaskIndex = new Map<string, string>();
let maxConcurrent = 3;
let runningCount = 0;
const controllers = new Map<string, AbortController>();

function log(task: QueueTask, level: "info" | "error", message: string) {
  task.logs.push({ at: Date.now(), level, message });
  task.logs = task.logs.slice(-50);
}

function isRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate.?limit|限流|too many|请求过于频繁|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(message);
}

function generationNodes(document: CanvasDocument) {
  return document.nodes.filter(node => {
    const type = String(node.type ?? "");
    return type.endsWith("GenerationNode") && (type.includes("image") || type.includes("video"));
  });
}

function nodeMediaType(type: string) {
  return type.includes("video") ? "video" : "image";
}

/** 产物在盘校验：outputs 引用的文件全部存在才算已完成（AC-2 重建幂等口径）。 */
async function outputsOnDisk(workspace: string, document: CanvasDocument, nodeId: string) {
  const node = document.nodes.find(item => item.id === nodeId);
  const data = (node?.data ?? {}) as Record<string, unknown>;
  const history = (data.generationHistory as Record<string, unknown>[] | undefined) ?? [];
  const last = history.at(-1);
  if (last?.status !== "succeeded") return false;
  const outputs = (data.outputs ?? {}) as Record<string, { value?: { url?: string } } | undefined>;
  for (const output of Object.values(outputs)) {
    if (!output?.value?.url) continue;
    try {
      const { path } = await resolveWorkspacePath(workspace, output.value.url);
      await stat(path);
    } catch {
      return false;
    }
  }
  return true;
}

export type SubmitScope = { type: "missing" | "all" | "nodes"; nodeIds?: string[] };

export async function submitCanvasQueue(
  workspace: string,
  canvasId: string | undefined,
  scope: SubmitScope = { type: "missing" },
  options: { concurrency?: number } = {},
): Promise<{ submitted: QueueTask[]; skipped: { nodeId: string; label: string; reason: string }[] }> {
  if (options.concurrency !== undefined) maxConcurrent = Math.min(20, Math.max(1, options.concurrency));
  const activeId = canvasId ?? await activeCanvasId(workspace);
  const { document } = await readCanvasDocument(workspace, activeId);
  const candidates = generationNodes(document);
  const submitted: QueueTask[] = [];
  const skipped: { nodeId: string; label: string; reason: string }[] = [];
  for (const node of candidates) {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const label = String(data.label ?? node.id);
    if (scope.type === "nodes" && scope.nodeIds && !scope.nodeIds.includes(node.id)) continue;
    if (nodeTaskIndex.has(`${workspace}::${node.id}`)) {
      const existing = tasks.get(nodeTaskIndex.get(`${workspace}::${node.id}`)!)!;
      if (["pending", "backoff", "running"].includes(existing.status)) {
        skipped.push({ nodeId: node.id, label, reason: "已在队列中" });
        continue;
      }
    }
    if (scope.type === "missing" && await outputsOnDisk(workspace, document, node.id)) {
      skipped.push({ nodeId: node.id, label, reason: "已完成且产物在盘" });
      continue;
    }
    if (scope.type === "missing" && !String(data.prompt ?? "").trim()) {
      skipped.push({ nodeId: node.id, label, reason: "无提示词" });
      continue;
    }
    const task: QueueTask = {
      id: crypto.randomUUID(), workspace, canvasId: activeId, nodeId: node.id, label,
      mediaType: nodeMediaType(String(node.type)), status: "pending", attempt: 0, logs: [], deps: [],
      submittedAt: Date.now(),
    };
    tasks.set(task.id, task);
    nodeTaskIndex.set(`${workspace}::${node.id}`, task.id);
    log(task, "info", "已提交");
    submitted.push(task);
  }
  // 依赖快照：上游生成节点（连入本节点的生成类输出）。
  for (const task of submitted) {
    task.deps = (document.edges as { source: string; target: string }[])
      .filter(edge => edge.target === task.nodeId)
      .map(edge => edge.source)
      .filter(source => candidates.some(node => node.id === source) && submitted.some(item => item.nodeId === source));
  }
  if (submitted.length) pump();
  return { submitted, skipped };
}

async function activeCanvasId(workspace: string) {
  const { listCanvasFiles } = await import("@/utils/canvas/repository");
  const canvases = await listCanvasFiles(workspace);
  if (!canvases.length) throw Object.assign(new Error("工作区还没有画布，可先 addCanvas 创建"), { status: 404 });
  return canvases[0]!.id;
}

function depState(task: QueueTask): "ready" | "waiting" | "blocked" {
  for (const dep of task.deps) {
    const upstreamId = nodeTaskIndex.get(`${task.workspace}::${dep}`);
    const upstream = upstreamId ? tasks.get(upstreamId) : undefined;
    if (!upstream) continue; // 上游不在本轮队列（已有产物或未提交）：不阻塞
    if (upstream.status === "succeeded") continue;
    if (["skipped", "failed", "cancelled"].includes(upstream.status)) return "blocked";
    return "waiting";
  }
  return "ready";
}

function pump() {
  for (const task of tasks.values()) {
    if (runningCount >= maxConcurrent) return;
    if (task.status !== "pending") continue;
    if (task.backoffUntil !== undefined && Date.now() < task.backoffUntil) continue;
    const state = depState(task);
    if (state === "waiting") continue;
    if (state === "blocked") {
      task.status = "skipped";
      task.finishedAt = Date.now();
      task.error = "上游任务失败，已跳过";
      log(task, "error", task.error);
      continue;
    }
    void runTask(task);
  }
}

async function runTask(task: QueueTask) {
  task.status = "running";
  task.startedAt = Date.now();
  runningCount++;
  const controller = new AbortController();
  controllers.set(task.id, controller);
  log(task, "info", `开始生成（第 ${task.attempt + 1} 次尝试）`);
  try {
    await runGeneration(task.workspace, task.canvasId, task.nodeId, task.mediaType, controller.signal);
    task.status = "succeeded";
    task.finishedAt = Date.now();
    delete task.error;
    log(task, "info", "生成成功");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    task.error = message;
    if (controller.signal.aborted) {
      task.status = "cancelled";
      task.finishedAt = Date.now();
      log(task, "info", "已取消");
    } else if (isRateLimitError(error)) {
      // 限流/网络抖动退避重试，不计入失败次数（AC-8）。
      task.status = "backoff";
      task.backoffUntil = Date.now() + rateLimitBackoffMs;
      log(task, "error", `限流或网络错误，${rateLimitBackoffMs / 1000} 秒后重试：${message.slice(0, 200)}`);
      setTimeout(() => {
        if (task.status === "backoff") {
          task.status = "pending";
          delete task.backoffUntil;
          pump();
        }
      }, rateLimitBackoffMs + 100);
    } else {
      task.attempt++;
      if (task.attempt >= maxAttempts) {
        task.status = "skipped";
        task.finishedAt = Date.now();
        log(task, "error", `失败 ${task.attempt} 次，已跳过：${message.slice(0, 300)}`);
      } else {
        task.status = "pending";
        task.backoffUntil = Date.now() + failedRetryDelayMs;
        log(task, "error", `失败（${task.attempt}/${maxAttempts}），将重试：${message.slice(0, 200)}`);
        setTimeout(() => {
          if (task.status === "pending" && task.backoffUntil !== undefined) {
            delete task.backoffUntil;
            pump();
          }
        }, failedRetryDelayMs + 100);
      }
    }
  } finally {
    runningCount--;
    controllers.delete(task.id);
    pump();
  }
}

export function queueStatus(filter: { workspace?: string; canvasId?: string } = {}) {
  // canvasId 支持逗号分隔多画布（用户按画布划分工作流，一次盯多块）。
  const canvasIds = filter.canvasId?.includes(",")
    ? filter.canvasId.split(",").map(id => id.trim()).filter(Boolean) : undefined;
  const list = [...tasks.values()]
    .filter(task => (!filter.workspace || task.workspace === filter.workspace)
      && (canvasIds ? canvasIds.includes(task.canvasId)
        : (!filter.canvasId || task.canvasId === filter.canvasId)))
    .sort((left, right) => left.submittedAt - right.submittedAt);
  const summary = list.reduce<Record<string, number>>((counts, task) => {
    counts[task.status] = (counts[task.status] ?? 0) + 1;
    return counts;
  }, { total: list.length, pending: 0, backoff: 0, running: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 });
  return { tasks: list, summary, concurrency: { current: runningCount, max: maxConcurrent } };
}

export function taskLogs(taskId: string) {
  const task = tasks.get(taskId);
  if (!task) throw Object.assign(new Error(`任务不存在：${taskId}，可先 queueStatus 查询`), { status: 404 });
  return { id: task.id, nodeId: task.nodeId, label: task.label, status: task.status, error: task.error, logs: task.logs };
}

export function cancelQueueTask(target: { taskId?: string; nodeId?: string; workspace?: string }) {
  const list = [...tasks.values()].filter(task => {
    if (target.taskId && task.id !== target.taskId) return false;
    if (target.nodeId && task.nodeId !== target.nodeId) return false;
    if (target.workspace && task.workspace !== target.workspace) return false;
    return true;
  });
  if (!list.length) throw Object.assign(new Error("没有匹配的队列任务"), { status: 404 });
  for (const task of list) {
    if (["pending", "backoff", "running"].includes(task.status)) {
      if (task.status === "running") controllers.get(task.id)?.abort(new Error("已取消"));
      else {
        task.status = "cancelled";
        task.finishedAt = Date.now();
      }
    }
  }
  return { cancelled: list.length };
}

/** 节点实时状态（getGenerationStatuses 合成用）：队列态优先，无记录返回 undefined。 */
export function nodeRuntimeStatus(workspace: string, nodeId: string): { status: QueueTaskStatus; error?: string; taskId?: string } | undefined {
  const taskId = nodeTaskIndex.get(`${workspace}::${nodeId}`);
  if (!taskId) return undefined;
  const task = tasks.get(taskId);
  if (!task || ["succeeded", "skipped", "cancelled"].includes(task.status)) return undefined;
  return { status: task.status, error: task.error, taskId: task.id };
}

/** 单节点入队（node:generate* 的语义即“入队”，AC 与页面手动生成体验解耦）。 */
export async function enqueueNode(workspace: string, canvasId: string, nodeId: string) {
  const { document } = await readCanvasDocument(workspace, canvasId);
  const node = document.nodes.find(item => item.id === nodeId);
  if (!node) throw Object.assign(new Error(`节点不存在：${nodeId}`), { status: 404 });
  if (!String(node.type ?? "").endsWith("GenerationNode")) throw new Error("该节点不是生成类节点");
  const existingId = nodeTaskIndex.get(`${workspace}::${nodeId}`);
  const existing = existingId ? tasks.get(existingId) : undefined;
  if (existing && ["pending", "backoff", "running"].includes(existing.status)) return { queued: true, taskId: existing.id, alreadyQueued: true };
  const task: QueueTask = {
    id: crypto.randomUUID(), workspace, canvasId, nodeId, label: String((node.data as Record<string, unknown> | undefined)?.label ?? nodeId),
    mediaType: nodeMediaType(String(node.type)), status: "pending", attempt: 0, logs: [], deps: [], submittedAt: Date.now(),
  };
  tasks.set(task.id, task);
  nodeTaskIndex.set(`${workspace}::${nodeId}`, task.id);
  log(task, "info", "已提交（单节点）");
  pump();
  return { queued: true, taskId: task.id };
}
