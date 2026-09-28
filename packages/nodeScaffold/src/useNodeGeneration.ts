import { computed, ref, type Ref } from "vue";
import { useNodeId } from "@vue-flow/core";
import { nodeTools, z } from "./nodeTools";
import type { NodeOutputs } from "./values";

export type GenerationFile = { url: string; mimeType: string };

export type GenerationRecord = {
  id: string;
  startedAt: string;
  finishedAt: string;
  status: "running" | "succeeded" | "failed";
  prompt?: string;
  model?: string;
  inputs?: GenerationFile[];
  files?: GenerationFile[];
  error?: string;
};

const maxRecords = 50;

const mimeTypes: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".flac": "audio/flac",
};

function guessMimeType(url: string) {
  const extension = url.slice(url.lastIndexOf(".")).toLowerCase();
  return extension in mimeTypes ? mimeTypes[extension] : undefined;
}

function mediaDataType(mimeType: string) {
  if (mimeType.startsWith("image/")) return "IMAGE" as const;
  if (mimeType.startsWith("video/")) return "VIDEO" as const;
  if (mimeType.startsWith("audio/")) return "AUDIO" as const;
  return undefined;
}

export function useNodeGeneration(outputs: Readonly<Ref<NodeOutputs>>, cancel: () => void, options: { history?: Ref<GenerationRecord[]> } = {}) {
  const localHistory = ref<GenerationRecord[]>([]);
  const history = options.history ?? localHistory;
  // 刷新或重开画布会残留 running 条目，该轮没有产出，直接移除。
  if (history.value.some(record => record.status === "running")) {
    history.value = history.value.filter(record => record.status !== "running");
  }
  const status = ref<"idle" | "running" | "succeeded" | "failed">("idle");
  const error = ref("");
  const generating = computed(() => status.value === "running");
  const getStatus = () => ({
    status: status.value,
    outputs: outputs.value,
    ...(error.value ? { error: error.value } : {}),
    history: history.value,
  });

  nodeTools.register({
    name: "getGenerationStatus",
    description: "查询本次打开节点后的生成状态（idle/running/succeeded/failed）、当前输出、最近一次生成错误和生成历史（最多 50 条，含每次的提示词、模型、参考与产出文件、错误信息，可据此排查失败或挑选历史结果）。当前输出可能来自之前的生成；idle 不表示没有历史输出，只有 succeeded 表示本次生成成功",
    parameters: z.strictObject({}),
    execute: getStatus,
  });
  nodeTools.register({
    name: "cancelGeneration",
    description: "请求停止当前后台生成；cancellationRequested 表示已发出停止请求，随后用 getGenerationStatus 查询终止状态。不会删除已有输出，不能保证供应商撤销任务或费用",
    parameters: z.strictObject({}),
    execute() {
      const cancellationRequested = generating.value;
      if (cancellationRequested) cancel();
      return { ...getStatus(), cancellationRequested };
    },
  });
  const nodeId = useNodeId();
  nodeTools.register({
    name: "selectOutput",
    description: "把本节点历史生成结果中的某个文件设为当前输出，下游连线立即引用该文件。url 取自 getGenerationStatus 返回的 history[].files[].url，或该节点 assets/<nodeId>/ 目录内的文件（超出历史保留条数的结果仍可通过 workspaceFiles 枚举目录后选择）",
    parameters: z.strictObject({ url: z.string().min(1).max(1024) }),
    execute({ url: requested }) {
      const normalized = requested.replace(/\\/g, "/").replace(/^\.\//, "");
      const known = history.value.flatMap(record => record.files ?? []).find(file => file.url === normalized);
      let file = known;
      if (!file) {
        if (!nodeId || !normalized.startsWith(`assets/${nodeId}/`)) {
          throw new Error("只能选择本节点历史结果或 assets/<nodeId>/ 目录内的文件");
        }
        const mimeType = guessMimeType(normalized);
        if (!mimeType) throw new Error("无法识别文件类型，请选择 png/jpg/webp/gif/mp4/webm/mov/mp3/wav 等常见媒体文件");
        file = { url: normalized, mimeType };
      }
      const dataType = mediaDataType(file.mimeType);
      if (!dataType) throw new Error(`不支持的文件类型：${file.mimeType}`);
      const key = Object.keys(outputs.value).find(item => outputs.value[item]?.dataType === dataType) ?? dataType.toLowerCase();
      (outputs.value as Record<string, { dataType: typeof dataType; value: { url: string; mimeType: string } }>)[key] =
        { dataType, value: { url: file.url, mimeType: file.mimeType } };
      return outputs.value[key];
    },
  });

  function pushRecord(record: GenerationRecord) {
    history.value = [...history.value.slice(-(maxRecords - 1)), record];
  }

  function finishRecord(id: string, patch: Partial<GenerationRecord>) {
    // data 是 reactive 代理，数组元素取出后不是原引用，按 id 匹配。
    history.value = history.value.map(item => item.id === id ? { ...item, ...patch } : item);
  }

  async function run<T>(task: () => Promise<T>, metadata?: { prompt?: string; model?: string; inputs?: GenerationFile[] }): Promise<T> {
    if (generating.value) throw new Error("节点正在生成，请等待完成");
    status.value = "running";
    error.value = "";
    const record: GenerationRecord = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      finishedAt: "",
      status: "running",
      ...(metadata?.prompt ? { prompt: metadata.prompt } : {}),
      ...(metadata?.model ? { model: metadata.model } : {}),
      ...(metadata?.inputs?.length ? { inputs: metadata.inputs } : {}),
    };
    pushRecord(record);
    try {
      const result = await task();
      status.value = "succeeded";
      const files = (result as { files?: GenerationFile[] } | undefined | void)?.files;
      finishRecord(record.id, {
        finishedAt: new Date().toISOString(),
        status: "succeeded",
        ...(Array.isArray(files) && files.length ? { files } : {}),
      });
      return result;
    } catch (failure) {
      status.value = "failed";
      const message = (failure as { response?: { data?: { message?: string } } })?.response?.data?.message;
      error.value = failure instanceof Error && failure.name === "AbortError" ? "生成已取消"
        : message || (failure instanceof Error ? failure.message : "生成失败");
      finishRecord(record.id, { finishedAt: new Date().toISOString(), status: "failed", error: error.value });
      throw failure;
    }
  }

  return { generating, run, history };
}
