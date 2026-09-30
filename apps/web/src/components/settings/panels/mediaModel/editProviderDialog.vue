<template>
  <el-dialog
    v-model="visible"
    :title="`编辑媒体供应商：${provider?.label ?? ''}`"
    width="min(800px, calc(100vw - 32px))"
    alignCenter
    appendToBody
    destroyOnClose
    :closeOnClickModal="false"
    :closeOnPressEscape="!saving"
    :showClose="!saving">
    <div class="providerEditor">
      <messageMarkdown v-if="provider?.readme" class="providerReadme" :content="provider.readme" />
      <el-divider contentPosition="left">连接配置</el-divider>
      <el-alert
        v-if="provider?.hasConfigHtml && htmlFailed"
        class="configFallback"
        type="warning"
        :title="`配置界面不可用（${htmlError}），已切换为表单编辑。`"
        :closable="false"
        showIcon />
      <configHtmlHost
        v-if="provider?.hasConfigHtml && !htmlFailed"
        :providerId="provider.id"
        :config="initialConfig"
        @change="htmlConfig = $event"
        @failed="htmlFailed = true; htmlError = $event" />
      <form-create v-else-if="providerRules.length" v-model:api="formApi" :rule="providerRules" :option="formOptions" />
      <el-form v-else labelPosition="top" :disabled="saving">
        <el-form-item label="API Key">
          <el-input v-model="apiKey" :prefixIcon="IconKey" type="password" showPassword autocomplete="off" aria-label="媒体供应商 API Key" />
        </el-form-item>
      </el-form>
      <div class="modelHeader">
        <h4>模型配置 <el-text type="info">{{ models.length }}</el-text></h4>
        <el-button :icon="IconPlus" size="small" :disabled="saving" @click="editModel()">手动添加</el-button>
      </div>
      <div class="modelList">
        <el-card v-for="(item, index) in models" :key="index" class="modelCard" shadow="never">
          <div class="topInfo">
            <div class="modelNameWrap">
              <modelIcon :model="item.id" :size="24" />
              <div class="modelInfo">
                <span class="modelName">{{ item.label }}</span>
                <el-text class="modelId" type="info" size="small">{{ item.id }}</el-text>
              </div>
            </div>
            <div class="actionButtons">
              <el-button text size="small" :icon="IconEdit" :disabled="saving" :aria-label="`编辑模型 ${item.label}`" @click="editModel(index)">编辑</el-button>
              <el-button text size="small" type="danger" :icon="IconTrash" :disabled="saving" :aria-label="`删除模型 ${item.label}`" @click="models.splice(index, 1)">删除</el-button>
            </div>
          </div>
          <div class="modelTags">
            <el-tag size="small">{{ modelTypes[item.type] }}</el-tag>
            <el-tag v-for="(tag, tagIndex) in modelTags(item)" :key="tagIndex" size="small" type="info">{{ tag }}</el-tag>
          </div>
        </el-card>
        <el-text v-if="!models.length" type="info">暂无模型</el-text>
      </div>
    </div>
    <el-alert v-if="formError" class="formError" :title="formError" type="error" :closable="false" showIcon />
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">取消</el-button>
      <el-button type="primary" :icon="IconDeviceFloppy" :loading="saving" @click="saveModels">保存</el-button>
    </template>
    <component
      :is="modelEditorDialog"
      v-model="modelEditorVisible"
      :model="editingModelIndex === undefined ? undefined : models[editingModelIndex]"
      :models="models"
      @confirmed="confirmModel" />
  </el-dialog>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, defineAsyncComponent, ref, shallowRef, watch, type Component } from "vue";
import { IconPlus, IconTrash, IconDeviceFloppy, IconEdit, IconKey } from "@tabler/icons-vue";
import { modelIcon } from "@toonflow/model-icons";
import messageMarkdown from "@/components/messageMarkdown.vue";
import formCreate, { type Api, type Options, type Rule } from "../../formCreate";
import configHtmlHost from "./configHtmlHost.vue";
import type { MediaProvider, MediaProviderModel } from "./types";
import { settings, saveSettings } from "@/stores/settings";
import { invalidateNodeModels } from "@toonflow/nodes-scaffold/nodeAi";

const { provider } = defineProps<{ provider?: MediaProvider }>();
const modelEditorDialog = shallowRef<Component>();
const visible = defineModel<boolean>({ default: false });
const emit = defineEmits<{ saved: [provider: MediaProvider] }>();
const models = ref<MediaProviderModel[]>([]);
const modelEditorVisible = ref(false);
const editingModelIndex = ref<number>();
const saving = ref(false);
const apiKey = ref("");
const formError = ref("");
const initialConfig = ref<Record<string, unknown>>({});
const htmlConfig = ref<Record<string, unknown>>();
const htmlFailed = ref(false);
const htmlError = ref("");
const formApi = shallowRef<Api>();
const formOptions = computed<Options>(() => ({ form: { labelPosition: "top", disabled: saving.value }, submitBtn: false, resetBtn: false }));
// rules 回显：copyRules 后用已存配置覆盖各字段默认值。
const providerRules = computed(() => {
  const rules = formCreate.copyRules((provider?.rules ?? []) as Rule[]);
  const current = initialConfig.value;
  for (const rule of rules) {
    if (typeof rule.field === "string" && rule.field in current) rule.value = current[rule.field];
  }
  return rules;
});
const modelTypes = { image: "图片", video: "视频", audio: "音频", text: "文本" };
const modeLabels: Record<string, string> = {
  singleImage: "单图参考", multiReference: "多图参考", startEndRequired: "首尾帧必填",
  endFrameOptional: "尾帧可选", startFrameOptional: "首帧可选",
  imageReference: "图片参考", videoReference: "视频参考", audioReference: "音频参考",
};

watch(visible, isVisible => {
  if (!isVisible) return;
  formError.value = "";
  modelEditorVisible.value = false;
  editingModelIndex.value = undefined;
  htmlFailed.value = false;
  htmlError.value = "";
  htmlConfig.value = undefined;
  formApi.value = undefined;
  const configs = settings.value.mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
  const current = provider && configs?.[provider.id];
  initialConfig.value = current && typeof current === "object" && !Array.isArray(current) ? { ...current } : {};
  apiKey.value = typeof initialConfig.value.apiKey === "string" ? initialConfig.value.apiKey : "";
  models.value = JSON.parse(JSON.stringify(provider?.models ?? []));
}, { immediate: true });

function modelTags(model: MediaProviderModel) {
  const modes = Array.isArray(model.mode) ? model.mode.flat().filter((mode): mode is string => typeof mode === "string") : [];
  return modes.map(mode => {
    if (mode === "text") return model.type === "image" ? "文生图" : "文生视频";
    const reference = /^(imageReference|videoReference|audioReference):(\d+)$/.exec(mode);
    return reference ? `${modeLabels[reference[1]!]} ×${reference[2]}` : modeLabels[mode] ?? mode;
  });
}

function editModel(index?: number) {
  modelEditorDialog.value ??= defineAsyncComponent(() => import("./modelEditorDialog.vue"));
  editingModelIndex.value = index;
  modelEditorVisible.value = true;
}

function confirmModel(model: MediaProviderModel) {
  const index = editingModelIndex.value;
  if (index === undefined) models.value.push(model);
  else models.value.splice(index, 1, model);
}

/** 收集三层降级各自的编辑结果；返回 null 表示配置无变化，跳过校验与写入。 */
async function collectConfig(): Promise<Record<string, unknown> | null> {
  const current = initialConfig.value;
  if (provider?.hasConfigHtml && !htmlFailed.value) {
    const next = htmlConfig.value ?? current;
    return JSON.stringify(next) === JSON.stringify(current) ? null : next;
  }
  if (providerRules.value.length) {
    if (!formApi.value) return null;
    if (!(await formApi.value.validate().then(() => true, () => false))) throw new Error("请完善连接配置的必填项");
    const values = formApi.value.formData() as Record<string, unknown>;
    const rawKey = values.apiKey;
    if (typeof rawKey === "string") {
      const trimmed = rawKey.trim();
      if (trimmed.length > 8192) throw new Error("API Key 过长");
      values.apiKey = trimmed;
    }
    const next = { ...current, ...values };
    return JSON.stringify(next) === JSON.stringify(current) ? null : next;
  }
  const nextKey = apiKey.value.trim();
  if (nextKey === (typeof current.apiKey === "string" ? current.apiKey : "")) return null;
  if (nextKey.length > 8192) throw new Error("API Key 过长");
  return { ...current, apiKey: nextKey };
}

async function saveModels() {
  if (saving.value || !provider) return;
  const { id: providerId, fileName, revision } = provider;
  formError.value = "";
  let configSaved = false;
  try {
    const ids = new Set<string>();
    const values = models.value.map((item, index) => {
      const id = item.id.trim();
      const label = item.label.trim();
      if (!id || !label) throw new Error(`请填写第 ${index + 1} 个模型的 ID 和显示名称`);
      if (ids.has(id)) throw new Error(`模型 ID 重复：${id}`);
      ids.add(id);
      return { ...item, id, label };
    });
    const nextConfig = await collectConfig();
    if (nextConfig && JSON.stringify(nextConfig).length > 128 * 1024) throw new Error("连接配置过大");
    saving.value = true;
    if (nextConfig) {
      const { data: validated } = await axios.post<{ data: { ok: boolean; errors?: string[] } }>("/api/providers/media/validateConfig", { id: providerId, config: nextConfig });
      if (validated.data?.ok === false) throw new Error(validated.data.errors?.length ? validated.data.errors.join("；") : "配置校验未通过");
      configSaved = await saveSettings(settings => {
        const configs = settings.mediaProviderConfigs as Record<string, Record<string, unknown>> | undefined;
        if (configs !== undefined && (!configs || typeof configs !== "object" || Array.isArray(configs))) throw new Error("媒体供应商配置格式无效");
        const current = configs?.[providerId];
        if (current !== undefined && (!current || typeof current !== "object" || Array.isArray(current))) throw new Error("当前供应商配置格式无效");
        return { mediaProviderConfigs: { ...configs, [providerId]: nextConfig } };
      });
    }
    const { data } = await axios.put<{ data: MediaProvider }>("/api/providers/media/save", {
      fileName, revision, models: values,
    });
    invalidateNodeModels("media");
    emit("saved", data.data);
    visible.value = false;
  } catch (error) {
    const message = axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "保存失败，请重试";
    formError.value = configSaved ? `连接配置已保存，模型未保存：${message}。模型修改已保留，请重试。` : message;
  } finally {
    saving.value = false;
  }
}
</script>

<style lang="scss" scoped>
.providerEditor {
  max-height: 65dvh;
  padding: 8px 4px;
  overflow-y: auto;
  overscroll-behavior: contain;

  .providerReadme { margin-bottom: 20px; }

  .configFallback { margin-bottom: 16px; }

  .modelHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;

    h4 { margin: 0; }
  }

  .modelList {
    display: flex;
    flex-direction: column;
    gap: 10px;

    .modelCard {
      .topInfo {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;

        .modelNameWrap {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;

          .modelInfo {
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 0;
            overflow-wrap: anywhere;

            .modelName { font-size: 15px; font-weight: 600; }
            .modelId { align-self: flex-start; }
          }
        }

        .actionButtons {
          display: flex;
          flex-shrink: 0;
          margin-left: auto;
        }
      }

      .modelTags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 16px;
      }
    }
  }
}

.formError { margin-top: 16px; }
</style>
