<template>
  <div class="configHtmlHost" :style="{ height: frameHeight }">
    <div v-if="status === 'loading'" class="hostState">
      <el-skeleton :rows="3" animated />
    </div>
    <el-alert
      v-else-if="status === 'failed'"
      class="hostState"
      type="error"
      :title="`配置界面加载失败：${loadError}`"
      :closable="false"
      showIcon />
    <iframe
      v-show="status === 'ready'"
      ref="frame"
      class="configFrame"
      title="供应商配置界面"
      sandbox="allow-scripts"
      :srcdoc="frameDoc" />
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { buildConfigHtmlSdk } from "./configHtmlSdk";

const { providerId, config } = defineProps<{ providerId: string; config: Record<string, unknown> }>();
const emit = defineEmits<{ change: [config: Record<string, unknown>]; failed: [message: string] }>();

const status = ref<"loading" | "ready" | "failed">("loading");
const loadError = ref("");
const frameDoc = ref("");
const frame = ref<HTMLIFrameElement>();
const frameHeight = ref("168px");
let readyTimer = 0;

// 主题变量取自宿主 element-plus 计算值，插件界面零成本获得与应用一致的配色。
const themeStyle = computed(() => {
  const style = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return `:root{--tf-bg:${pick("--el-bg-color", "#141414")};--tf-bg-soft:${pick("--el-fill-color-light", "#1d1d1d")};--tf-fg:${pick("--el-text-color-primary", "#e5eaf3")};--tf-muted:${pick("--el-text-color-secondary", "#a3a6ad")};--tf-primary:${pick("--el-color-primary", "#409eff")};--tf-border:${pick("--el-border-color", "#414243")};--tf-danger:${pick("--el-color-danger", "#f56c6c")};--tf-radius:8px}
html,body{margin:0;padding:12px 16px;background:var(--tf-bg);color:var(--tf-fg);font:14px/1.6 ${pick("--el-font-family", '"Noto Sans SC",sans-serif')};box-sizing:border-box}`;
});
const colorScheme = computed(() => document.documentElement.classList.contains("dark") ? "dark" : "light");

function fail(message: string) {
  if (status.value === "failed") return;
  status.value = "failed";
  loadError.value = message;
  emit("failed", message);
}

async function load() {
  status.value = "loading";
  loadError.value = "";
  clearTimeout(readyTimer);
  try {
    const { data } = await axios.get<{ data: { html: string } }>("/api/providers/media/configHtml", {
      params: { id: providerId }, headers: { "Cache-Control": "no-cache" },
    });
    const html = data.data.html;
    // 完整文档取 body 内容，宿主统一包壳注入主题与 SDK（config 随 SDK 内联，无消息竞态）。
    const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
    const body = bodyMatch ? bodyMatch[1] : html;
    const sdk = buildConfigHtmlSdk(config, colorScheme.value);
    frameDoc.value = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="${colorScheme.value}"><style>${themeStyle.value}</style><script>${sdk}<\/script></head><body>${body}</body></html>`;
    // ACT: 10 秒未握手视为界面不可用，交给宿主降级为表单编辑。
    readyTimer = window.setTimeout(() => fail("界面初始化超时"), 10000);
  } catch (error) {
    fail(axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "请求失败");
  }
}

function onMessage(event: MessageEvent) {
  const data = event.data as { __toonflow?: boolean; type?: string; config?: Record<string, unknown>; id?: number; height?: number; result?: { ok: boolean; errors?: string[] } } | null;
  if (!data || data.__toonflow !== true || event.source !== frame.value?.contentWindow) return;
  if (data.type === "toonflow:ready") {
    clearTimeout(readyTimer);
    if (status.value === "loading") status.value = "ready";
    frame.value?.contentWindow?.postMessage({ __toonflow: true, type: "toonflow:init", config }, "*");
  } else if (data.type === "toonflow:change" && data.config && typeof data.config === "object") {
    emit("change", data.config);
  } else if (data.type === "toonflow:height" && typeof data.height === "number") {
    frameHeight.value = `${Math.min(Math.max(data.height + 4, 120), 420)}px`;
  } else if (data.type === "toonflow:validate" && typeof data.id === "number") {
    void (async () => {
      let result: { ok: boolean; errors?: string[] };
      try {
        const { data: payload } = await axios.post<{ data: { ok: boolean; errors?: string[] } }>("/api/providers/media/validateConfig", {
          id: providerId, config: data.config ?? config,
        });
        result = payload.data;
      } catch (error) {
        result = { ok: false, errors: [axios.isAxiosError(error) ? error.response?.data?.message || error.message : "校验请求失败"] };
      }
      frame.value?.contentWindow?.postMessage({ __toonflow: true, type: "toonflow:validateResult", id: data.id, result }, "*");
    })();
  }
}

watch(() => providerId, () => { if (providerId) void load(); }, { immediate: true });
addEventListener("message", onMessage);
onBeforeUnmount(() => {
  removeEventListener("message", onMessage);
  clearTimeout(readyTimer);
});
</script>

<style lang="scss" scoped>
.configHtmlHost {
  position: relative;
  min-height: 120px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
  overflow: hidden;
  transition: height 0.2s ease;

  .hostState {
    padding: 20px 16px;
  }

  .configFrame {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: var(--el-bg-color);
  }
}
</style>
