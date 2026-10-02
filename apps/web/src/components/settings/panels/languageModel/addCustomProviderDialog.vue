<template>
  <el-dialog
    v-model="visible"
    :title="provider ? '编辑供应商' : '添加自定义供应商'"
    width="min(760px, 94vw)"
    alignCenter
    appendToBody
    destroyOnClose
    :closeOnClickModal="false"
    :closeOnPressEscape="!saving"
    :showClose="!saving"
    @closed="resetForm">
    <el-scrollbar maxHeight="65vh">
      <el-form ref="providerForm" :model="form" :rules="rules" labelPosition="top" :disabled="saving" class="customProviderForm">
        <el-alert
          v-if="isEngineProvider && localEnv"
          :title="localEnvNotice"
          type="info" :closable="false" showIcon class="localEnvNotice" />
        <div class="formGrid">
          <el-form-item label="Provider ID" prop="id"><el-input v-model="form.id" :disabled="isEngineProvider" placeholder="例如 myProvider" /></el-form-item>
          <el-form-item label="显示名称" prop="label"><el-input v-model="form.label" :disabled="isEngineProvider" placeholder="供应商的显示名称" /></el-form-item>
          <el-form-item label="API 地址" prop="apiUrl">
            <el-input v-model="form.apiUrl" :placeholder="apiUrlPlaceholder" />
          </el-form-item>
        </div>
        <el-form-item v-if="!isEngineProvider" label="API 协议" prop="protocol">
          <el-select v-model="form.protocol" aria-label="API 协议">
            <el-option v-for="protocol in protocols" :key="protocol" :label="protocol" :value="protocol" />
          </el-select>
        </el-form-item>
        <el-form-item label="API 密钥" prop="apiKey">
          <el-input v-model="form.apiKey" type="password" showPassword autocomplete="off" :placeholder="apiKeyPlaceholder" />
        </el-form-item>
        <div class="modelHeader">
          <el-text tag="strong">模型列表</el-text>
          <el-button v-if="!isEngineProvider" :icon="IconDownload" :loading="fetching || modelRefreshPending" @click="fetchModels()">获取模型列表</el-button>
        </div>
        <div class="modelList">
          <div v-for="item in models" :key="item.key" class="modelItem">
            <div class="modelRow">
              <el-input v-model="item.id" placeholder="模型 ID" aria-label="模型 ID" />
              <el-input v-model="item.label" placeholder="显示名称" aria-label="模型显示名称" />
              <el-button
                text
                :icon="expandedModels.has(item.key) ? IconChevronUp : IconChevronDown"
                :aria-expanded="expandedModels.has(item.key)"
                aria-label="展开 token 设置"
                @click="expandedModels.has(item.key) ? expandedModels.delete(item.key) : expandedModels.add(item.key)" />
              <el-button
                text
                type="danger"
                :icon="IconTrash"
                aria-label="删除模型"
                @click="models = models.filter((model) => model.key !== item.key)" />
            </div>
            <div v-if="expandedModels.has(item.key)" class="formGrid tokenSettings">
              <el-form-item label="上下文窗口">
                <el-input-number
                  v-model="item.contextWindow"
                  :min="1"
                  :max="Number.MAX_SAFE_INTEGER"
                  :precision="0"
                  controlsPosition="right"
                  placeholder="未设置"
                  aria-label="上下文窗口" />
              </el-form-item>
              <el-form-item label="最大输出 token">
                <el-input-number
                  v-model="item.maxOutputTokens"
                  :min="1"
                  :max="Number.MAX_SAFE_INTEGER"
                  :precision="0"
                  controlsPosition="right"
                  placeholder="未设置"
                  aria-label="最大输出 token" />
              </el-form-item>
            </div>
          </div>
        </div>
        <el-button class="manualAdd" :icon="IconPlus" @click="addManualModel">手动添加模型</el-button>
        <el-alert v-if="formError" :title="formError" type="error" :closable="false" showIcon />
      </el-form>
    </el-scrollbar>
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="fetching || modelRefreshPending" @click="addProvider">
        {{ provider ? "保存修改" : "确定添加供应商" }}
      </el-button>
    </template>
  </el-dialog>
  <el-dialog v-model="resultsVisible" title="选择要添加的模型" width="min(680px, 92vw)" alignCenter appendToBody destroyOnClose>
    <el-input v-model="modelSearch" clearable :prefixIcon="IconSearch" placeholder="搜索模型 ID 或显示名称" aria-label="搜索模型" />
    <div class="modelResults">
      <el-auto-resizer>
        <template #default="{ height, width }">
          <el-table-v2
            :columns="resultColumns"
            :data="filteredModels"
            :width="width"
            :height="height"
            :rowHeight="38"
            :headerHeight="36"
            rowKey="id"
            fixed />
        </template>
      </el-auto-resizer>
    </div>
    <el-text type="info">{{ filteredModels.length }} 个结果，已勾选 {{ selectedIds.size }} 个</el-text>
    <template #footer>
      <el-button @click="resultsVisible = false">取消</el-button>
      <el-button type="primary" :disabled="!selectedIds.size" @click="addSelectedModels">添加勾选的模型（{{ selectedIds.size }}）</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, reactive, ref, shallowRef, watch } from "vue";
import axios from "axios";
import { ElCheckbox, type FormInstance, type FormRules, type Column } from "element-plus";
import {
  IconPlus,
  IconDownload,
  IconTrash,
  IconChevronDown,
  IconChevronUp,
  IconSearch,
} from "@tabler/icons-vue";
import { saveSettings, isEngineProviderId, engineProviders, type CustomProvider, type CustomProviderModel } from "@/stores/settings";
import { languageProviders } from "@toonflow/providers";
import { isTfRouterProvider } from "@/lib/tf";

const props = defineProps<{ provider?: CustomProvider; localEnv?: { apiUrl: string; auth: string; model: string } }>();
const visible = defineModel<boolean>({ default: false });
// 引擎型供应商：id/名称锁定（与内置定义和桥接层一一对应），无协议概念，地址可空。
const isEngineProvider = computed(() => Boolean(props.provider && isEngineProviderId(props.provider.id)));
const apiUrlPlaceholder = computed(() => isEngineProvider.value
  ? "清空并保存则删除本机地址配置，回到官方默认端点"
  : "https://api.example.com/v1");
const apiKeyPlaceholder = computed(() => isEngineProvider.value
  ? "清空并保存则删除本机密钥，回到 CLI 自身登录"
  : "本地无鉴权服务可留空");
const localEnvNotice = computed(() => {
  const env = props.localEnv;
  const configured = env && (env.apiUrl || env.auth || env.model);
  return (configured
    ? "地址与密钥已回显本机 ~/.claude/settings.json 当前值，可直接修改，保存时写回本机（仅更新 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN 两个键，hooks、permissions 等原样保留）。"
    : "未检测到本机 ~/.claude/settings.json 的 env 配置，保存时将写入该文件（仅地址与密钥两个键）。")
    + (env?.model ? `本机默认模型：${env.model}（已加入下方模型列表）。` : "");
});
const providerForm = ref<FormInstance>();
const form = reactive({ id: "", label: "", apiUrl: "", protocol: "openai-completions", apiKey: "" });
const models = ref<(CustomProviderModel & { key: string })[]>([]);
const expandedModels = ref(new Set<string>());
const fetchedModels = shallowRef<CustomProviderModel[]>([]);
const selectedIds = ref(new Set<string>());
const modelSearch = ref("");
const saving = ref(false);
const protocols = ["openai-completions", "openai-responses", "anthropic-messages"];
const addedIds = computed(() => new Set(models.value.map((item) => item.id.trim())));
const filteredModels = computed(() => {
  const query = modelSearch.value.trim().toLowerCase();
  return query ? fetchedModels.value.filter((item) => `${item.id} ${item.label}`.toLowerCase().includes(query)) : fetchedModels.value;
});
const resultColumns = computed<Column[]>(() => [
  {
    key: "selection",
    width: 42,
    cellRenderer: ({ rowData }) =>
      h(ElCheckbox, {
        modelValue: selectedIds.value.has(rowData.id),
        disabled: addedIds.value.has(rowData.id),
        ariaLabel: `选择 ${rowData.id}`,
        onChange: (value: boolean | string | number) => {
          if (value) selectedIds.value.add(rowData.id);
          else selectedIds.value.delete(rowData.id);
        },
      }),
  },
  { key: "id", dataKey: "id", title: "模型 ID", width: 240, flexGrow: 1 },
  { key: "label", dataKey: "label", title: "显示名称", width: 200, flexGrow: 1 },
]);
const resultsVisible = ref(false);
const fetching = ref(false);
const modelRefreshPending = ref(false);
const modelFetchFailed = ref(false);
const formError = ref("");
let request: AbortController | undefined;
// v1.0.0 内置引擎定义曾带的占位模型 ID：条目完全等于这些时视为未自定义，预填时替换为本机真实模型。
const legacyEngineModelIds = new Set(["claude-sonnet-4-5", "claude-opus-4-1[1m]", "claude-haiku-4-5", "gpt-5.2-codex", "gpt-5.2"]);
const rules: FormRules = {
  id: [
    { required: true, message: "请输入 Provider ID", trigger: "blur" },
    { pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, message: "仅支持字母、数字、点、下划线和短横线", trigger: "blur" },
  ],
  label: [{ required: true, whitespace: true, message: "请输入显示名称", trigger: "blur" }],
  apiUrl: [
    {
      validator: (_rule, value, callback) => {
        // 引擎型供应商允许留空（使用 CLI 自身配置）；填写时必须是有效 HTTP 基础地址。
        if (!value) {
          callback();
          return;
        }
        try {
          const url = new URL(value);
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
          callback();
        } catch {
          callback(new Error("请输入有效的 HTTP API 基础地址，不包含查询参数"));
        }
      },
      trigger: "blur",
    },
  ],
};

watch(visible, (value) => {
  if (value) {
    resetForm();
    if (props.provider) {
      const { models: providerModels, ...config } = props.provider;
      Object.assign(form, config);
      models.value = providerModels.map((item) => ({ ...item, key: crypto.randomUUID() }));
    }
    // 引擎模式（配置中心）：地址与密钥直接回显本机真实值，可编辑，保存写回；
    // 内置定义曾带的占位模型（官方 sonnet/opus/haiku 等）与本机实际接入的端点无关，
    // 条目未被用户自定义过时整表替换为本机默认模型。
    if (isEngineProvider.value) {
      form.apiUrl = props.localEnv?.apiUrl ?? "";
      form.apiKey = props.localEnv?.auth ?? "";
      if (models.value.length && models.value.every(item => legacyEngineModelIds.has(item.id))) models.value = [];
      const realModel = props.localEnv?.model;
      if (realModel && !models.value.some(item => item.id === realModel)) {
        models.value.unshift({ id: realModel, label: realModel, key: crypto.randomUUID() });
      }
    }
  } else {
    request?.abort();
    resultsVisible.value = false;
  }
}, { immediate: true });
onBeforeUnmount(() => request?.abort());

watch(
  [visible, () => form.id, () => form.apiUrl, () => form.protocol, () => form.apiKey],
  ([isVisible], _previous, onCleanup) => {
    if (!isVisible || !isTfRouterProvider(form) || !form.apiKey.trim()) return;
    modelRefreshPending.value = true;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try { await fetchModels(true); }
      finally { if (!cancelled) modelRefreshPending.value = false; }
    }, 500);
    onCleanup(() => {
      cancelled = true;
      clearTimeout(timer);
      request?.abort();
      modelRefreshPending.value = false;
    });
  },
);

function resetForm() {
  Object.assign(form, { id: "", label: "", apiUrl: "", protocol: "openai-completions", apiKey: "" });
  models.value = [];
  expandedModels.value = new Set();
  fetchedModels.value = [];
  selectedIds.value = new Set();
  modelSearch.value = "";
  formError.value = "";
  modelFetchFailed.value = false;
}

async function fetchModels(autoApply = false) {
  if (fetching.value || !(await providerForm.value?.validateField("apiUrl").catch(() => false))) return;
  fetching.value = true;
  formError.value = "";
  modelFetchFailed.value = false;
  const controller = new AbortController();
  request = controller;
  try {
    const { data } = await axios.post(
      "/api/providers/models",
      { apiUrl: form.apiUrl.trim(), protocol: form.protocol, apiKey: form.apiKey.trim() },
      { signal: controller.signal, timeout: 35000 }
    );
    if (controller.signal.aborted) return;
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error(data.message || "获取模型列表失败");
    if (autoApply || isTfRouterProvider(form)) {
      if (!data.data.length) throw new Error("未获取到可用模型，请检查 API Key 后重试");
      models.value = data.data.map((item: CustomProviderModel) => ({ ...item, key: crypto.randomUUID() }));
      return;
    }
    fetchedModels.value = data.data;
    selectedIds.value = new Set();
    modelSearch.value = "";
    resultsVisible.value = true;
  } catch (error) {
    if (!controller.signal.aborted) {
      modelFetchFailed.value = true;
      formError.value = axios.isAxiosError(error)
        ? error.response?.data?.message || "获取模型列表失败，请检查连接配置"
        : error instanceof Error
        ? error.message
        : "获取模型列表失败";
    }
  } finally {
    fetching.value = false;
  }
}

function addSelectedModels() {
  const added = new Set(addedIds.value);
  for (const item of fetchedModels.value) {
    if (selectedIds.value.has(item.id) && !added.has(item.id)) {
      models.value.push({ ...item, key: crypto.randomUUID() });
      added.add(item.id);
    }
  }
  resultsVisible.value = false;
}

function addManualModel() {
  const key = crypto.randomUUID();
  models.value.push({ key, id: "", label: "" });
}

async function addProvider() {
  if (fetching.value || modelRefreshPending.value || (isTfRouterProvider(form) && modelFetchFailed.value)) return;
  formError.value = "";
  if (saving.value || !(await providerForm.value?.validate().catch(() => false))) return;
  const providerId = props.provider?.id;
  const ids = models.value.map((item) => item.id.trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    formError.value = "模型 ID 不能为空或重复";
    return;
  }
  if (
    models.value.some((item) =>
      [item.contextWindow, item.maxOutputTokens].some((value) => value != null && (!Number.isSafeInteger(value) || value < 1))
    )
  ) {
    formError.value = "token 限制必须为正整数或留空";
    return;
  }
  saving.value = true;
  try {
    // claude-code 引擎（配置中心）：把地址/密钥写回本机 ~/.claude/settings.json（清空保存 = 删键回退默认），平台条目不落这两个值。
    const engineId = providerId ?? form.id;
    const engineKind = engineProviders.value.find(item => item.id === engineId)?.engine;
    const writeBack = engineKind === "claude-code";
    if (writeBack) {
      try {
        await axios.put("/api/agentEngine/localEnv", {
          apiUrl: form.apiUrl.trim(),
          apiKey: form.apiKey.trim(),
        }, { headers: { "x-toonflow-workspace": "1" } });
      } catch (error) {
        formError.value = axios.isAxiosError(error) ? error.response?.data?.message || (error as Error).message || "写回本机配置失败" : "写回本机配置失败";
        return;
      }
    }
    const updatedProvider = {
      ...form,
      label: form.label.trim(),
      apiUrl: writeBack ? "" : form.apiUrl.trim(),
      apiKey: writeBack ? "" : form.apiKey.trim(),
      // 引擎型供应商无协议概念；空串同样不落盘。
      protocol: isEngineProvider.value ? undefined : form.protocol,
      models: models.value.map(({ key, ...item }) => ({
        ...item,
        id: item.id.trim(),
        label: item.label.trim() || item.id.trim(),
        contextWindow: item.contextWindow ?? undefined,
        maxOutputTokens: item.maxOutputTokens ?? undefined,
      })),
    };
    await saveSettings(settings => {
      const existing = settings.customProviders;
      if (existing !== undefined && !Array.isArray(existing)) throw new Error("已保存的供应商配置格式不正确");
      if (languageProviders.some(item => item.id !== providerId && item.id.toLowerCase() === updatedProvider.id.toLowerCase())
        || existing?.some(item => typeof item?.id === "string" && item.id !== providerId && item.id.toLowerCase() === updatedProvider.id.toLowerCase())) {
        throw new Error("Provider ID 已存在");
      }
      // 编辑态保存即 upsert：引擎卡片从内置定义合成 provider 打开时，条目尚不存在则创建。
      return { customProviders: providerId && existing?.some(item => item.id === providerId)
        ? existing.map(item => item.id === providerId ? updatedProvider : item)
        : [...(existing ?? []), updatedProvider] };
    });
    visible.value = false;
  } catch (error) {
    formError.value = error instanceof Error ? error.message : "保存失败，请重试；当前填写的内容已保留";
  } finally {
    saving.value = false;
  }
}
</script>

<style lang="scss" scoped>
.customProviderForm {
  padding-right: 12px;

  .localEnvNotice {
    margin-bottom: 16px;

    :deep(.el-alert__description) {
      font-size: 12px;
    }
  }

  .formGrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 20px;

    .el-input-number {
      width: 100%;
    }
  }

  .modelHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 8px 0 16px;
  }

  .modelList {
    .modelItem {
      padding: 8px 0;
      border-bottom: 1px solid var(--el-border-color-lighter);

      .modelRow {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 28px 28px;
        align-items: center;
        gap: 8px;

        .el-button {
          margin: 0;
          padding: 4px;
        }
      }

      .tokenSettings {
        padding-top: 12px;

        .el-form-item {
          margin-bottom: 4px;
        }
      }
    }
  }

  .manualAdd {
    width: 100%;
    margin: 16px 0;
  }

  @media (max-width: 560px) {
    .formGrid {
      grid-template-columns: 1fr;
    }
  }
}
.modelResults {
  height: min(420px, 55dvh);
  margin: 12px 0;
}
</style>
