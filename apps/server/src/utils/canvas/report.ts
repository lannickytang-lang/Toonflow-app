import { stat } from "node:fs/promises";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { readCanvasDocument, type CanvasDocument } from "@/utils/canvas/repository";
import { nodeRuntimeStatus } from "@/utils/canvas/queue";

// 画布体检报告：拓扑摘要 + 节点现状 + 异常检测（含产物落盘 stat 与队列实时态），
// 供外部 Agent 不开页面即可判断画布现状是否正确。

export type ReportIssue = {
  level: "error" | "warning";
  nodeId: string;
  label: string;
  kind: string;
  detail: string;
  suggestion: string;
};

type NodeRow = {
  nodeId: string;
  label: string;
  type: string;
  model: string;
  status: string;
  params: string;
  attempt?: number;
  promptSummary: string;
  outputs: string[];
  upstream: string[];
  error?: string;
};

function parseModel(data: Record<string, unknown>) {
  try {
    const parsed = JSON.parse(String(data.model ?? "null")) as unknown;
    return Array.isArray(parsed) && parsed.length === 2 ? `${parsed[0]}/${parsed[1]}` : "";
  } catch {
    return "";
  }
}

async function fileExists(directory: string, path: string) {
  try {
    const { path: absolute } = await resolveWorkspacePath(directory, path);
    await stat(absolute);
    return true;
  } catch {
    return false;
  }
}

function shortType(type: string) {
  return type.replace(/^remote-/, "");
}

export async function generateCanvasReport(directory: string, canvasId?: string) {
  const { listCanvasFiles } = await import("@/utils/canvas/repository");
  const canvases = await listCanvasFiles(directory);
  if (!canvases.length) throw Object.assign(new Error("工作区还没有画布"), { status: 404 });
  const activeId = canvasId && canvases.some(item => item.id === canvasId) ? canvasId : canvases[0]!.id;
  const { document, revision } = await readCanvasDocument(directory, activeId);

  const upstreamOf = (nodeId: string) => (document.edges as { source: string; target: string }[])
    .filter(edge => edge.target === nodeId)
    .map(edge => document.nodes.find(node => node.id === edge.source))
    .filter((node): node is NonNullable<typeof node> => !!node);

  const rows: NodeRow[] = [];
  const issues: ReportIssue[] = [];
  const nodeStatus = new Map<string, { status: string; ok: boolean }>();

  for (const node of document.nodes) {
    const type = shortType(String(node.type ?? ""));
    if (!type.includes("Generation")) continue;
    const data = (node.data ?? {}) as Record<string, unknown>;
    const label = String(data.label ?? node.id);
    const model = parseModel(data);
    const history = (data.generationHistory as Record<string, unknown>[] | undefined) ?? [];
    const last = history.at(-1);
    const runtime = nodeRuntimeStatus(directory, node.id);
    const outputs = Object.values((data.outputs ?? {}) as Record<string, { value?: { url?: string } } | undefined>)
      .flatMap(output => output?.value?.url ? [output.value.url] : []);
    const upstream = upstreamOf(node.id).map(source => String((source.data as Record<string, unknown> | undefined)?.label ?? source.id));
    const prompt = String(data.prompt ?? "");

    let status = "idle";
    if (runtime) status = runtime.status;
    else if (last?.status === "succeeded") status = "succeeded";
    else if (last?.status === "failed") status = "failed";
    else if (last) status = String(last.status);

    nodeStatus.set(node.id, { status, ok: status === "succeeded" });

    if (!model) issues.push({ level: "error", nodeId: node.id, label, kind: "未配置模型", detail: "生成节点没有模型，无法触发生成", suggestion: "node set <节点> --model provider/model（先用 models 命令查询）" });
    if (!prompt.trim()) issues.push({ level: "error", nodeId: node.id, label, kind: "无提示词", detail: "生成节点 prompt 为空", suggestion: "node set <节点> --prompt \"…\"" });
    if (status === "failed") issues.push({ level: "error", nodeId: node.id, label, kind: "历史失败", detail: String(last?.error ?? "最近一次生成失败"), suggestion: "queue logs <任务> 查看原因，修正后 queue retry" });
    if (status === "skipped") issues.push({ level: "error", nodeId: node.id, label, kind: "队列跳过", detail: runtime?.error ?? "重试 3 次后被队列跳过", suggestion: "queue logs <任务> 查看原因，修正后 queue retry" });
    if (status === "succeeded") {
      for (const output of outputs) {
        if (!(await fileExists(directory, output))) {
          issues.push({ level: "error", nodeId: node.id, label, kind: "产物缺失", detail: `标记成功但产物不在盘：${output}`, suggestion: "queue submit（missing 语义会把该节点视为未完成并重新生成）" });
          nodeStatus.set(node.id, { status: "succeeded-missing", ok: false });
        }
      }
    }
    if (type.includes("video") && status !== "succeeded") {
      const blocked = upstreamOf(node.id).filter(source => shortType(String(source.type ?? "")).includes("Generation"))
        .some(source => !nodeStatus.get(source.id)?.ok);
      if (blocked) issues.push({ level: "warning", nodeId: node.id, label, kind: "上游未成功", detail: "依赖的资产图未全部成功，队列不会调度本分镜", suggestion: "先处理上游资产的异常（见上方 error 项）" });
    }

    // 参数紧凑摘要（分镜规格核对高频字段）：视频 6s/9:16/480P，图片 9:16/2K。
    const params = [
      data.duration !== undefined ? `${data.duration}s` : "",
      typeof data.ratio === "string" ? data.ratio : "",
      typeof data.resolution === "string" ? data.resolution : "",
      typeof data.size === "string" ? data.size : "",
    ].filter(Boolean).join("/");
    rows.push({
      nodeId: node.id, label, type, model, status, params,
      promptSummary: prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt,
      outputs, upstream, error: (runtime?.error ?? last?.error) as string | undefined,
    });
  }

  // 非生成节点中引用了不存在文件的引用节点（imageNode/videoNode/audioNode）。
  for (const node of document.nodes) {
    const type = shortType(String(node.type ?? ""));
    if (type.includes("Generation") || !["imageNode", "videoNode", "audioNode"].includes(type)) continue;
    const data = (node.data ?? {}) as Record<string, unknown>;
    const outputs = Object.values((data.outputs ?? {}) as Record<string, { value?: { url?: string } } | undefined>)
      .flatMap(output => output?.value?.url ? [output.value.url] : []);
    for (const output of outputs) {
      if (!(await fileExists(directory, output))) {
        issues.push({ level: "error", nodeId: node.id, label: String(data.label ?? node.id), kind: "引用文件缺失", detail: output, suggestion: "重新放置文件或改用 imageGenerationNode 生成" });
      }
    }
  }

  const summary = {
    canvasId: activeId, revision,
    generationNodes: rows.length,
    succeeded: rows.filter(row => row.status === "succeeded").length,
    failed: rows.filter(row => ["failed", "skipped"].includes(row.status)).length,
    queued: rows.filter(row => ["pending", "backoff", "running"].includes(row.status)).length,
    idle: rows.filter(row => row.status === "idle").length,
    issues: issues.filter(issue => issue.level === "error").length,
    warnings: issues.filter(issue => issue.level === "warning").length,
  };
  return { summary, issues, nodes: rows, canvases };
}

export const canvasFieldGuide = `画布 JSON 字段说明（nodes[].data 内）：
- label: 节点显示名（资产名 / 分镜N）
- prompt: 生成提示词；promptModel: 按行拆分的提示词内部结构（与 prompt 同源，可忽略）
- model: 模型选择，JSON 字符串 "[providerId, modelId]"，空表示未配置
- size/ratio: 图片尺寸与比例；duration/resolution/mode/generateAudio: 视频时长/分辨率/参考模式/声音
- handles: 端口声明（in=输入，image/video/audio=输出），连线校验依据
- outputs: 当前产物引用，如 {image: {dataType: "IMAGE", value: {url: "assets/<nodeId>/xxx.png"}}}，url 为工作区相对路径
- generationHistory: 每次生成记录 [{id, startedAt, finishedAt, status(running/succeeded/failed), prompt, model, files, error?}]，最多保留 50 条
- referenceOrder: 上游参考的显示顺序
- cast: 分镜导入时的出镜资产名列表，顺序=参考图传递顺序（Ref2VA 的 Subject N 即第 N 张参考图）
- promptZh: 分镜的中文提示词（导入 videoPromptZh 字段落盘）
- tags: 分镜导入时非标准字段的归集对象，重写导入不覆盖
顶层：toonflowCanvas=true 标记、nodes/edges/viewport、revision=文档版本（AI 写入与页面保存的乐观锁序号）`;
