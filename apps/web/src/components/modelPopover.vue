<template>
  <div class="modelPopover">
    <el-popover
      v-model:visible="visible"
      trigger="click"
      placement="top-start"
      :width="340"
      :offset="10"
      :showArrow="false"
      popperClass="agentModelPopover"
      :popperStyle="{ padding: '20px', maxWidth: 'calc(100vw - 24px)' }">
      <template #reference>
        <el-button class="modelButton" text :disabled="disabled" aria-label="模型与推理设置">
          <modelIcon v-if="selectedModelChoice" :model="selectedModelChoice.modelId" :size="14" />
          <span class="modelName">{{ selectedModelChoice?.label ?? "选择模型" }}</span>
          · <span class="reasoningLabel">{{ reasoningLabel }}</span>
          <icon-chevron-down :size="12" />
        </el-button>
      </template>
      <el-form class="modelOptions" labelPosition="top">
        <el-form-item label="模型">
          <el-select v-model="selectedModel" filterable :disabled="disabled" :teleported="false" placeholder="选择模型" aria-label="选择模型" noDataText="请先在设置中添加模型">
            <template #prefix><modelIcon v-if="selectedModelChoice" :model="selectedModelChoice.modelId" :size="18" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option v-for="model in provider.models" :key="model.id" :label="model.label" :value="JSON.stringify([provider.id, model.id])" :disabled="model.disabled">
                <el-space :size="8">
                  <modelIcon :model="model.id" :size="16" />
                  <span>{{ model.label }}</span>
                </el-space>
              </el-option>
            </el-option-group>
          </el-select>
        </el-form-item>
        <p v-if="currentEngineModel" class="modelHint">本机当前模型：{{ currentEngineModel }}</p>
        <p v-if="catalogError" class="modelHint" role="alert">{{ catalogError }}</p>
        <el-form-item label="思考强度">
          <el-segmented v-model="reasoningEffort" :options="reasoningOptions" :disabled="disabled" block aria-label="推理等级" />
        </el-form-item>
      </el-form>
    </el-popover>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconChevronDown } from "@tabler/icons-vue";
import { modelIcon } from "@toonflow/model-icons";
import { customProviders, engineProviders, modelChoices, getEngineProviderModels, getEngineDefaultLabel, loadEngineModels, engineModelCatalog } from "@/stores/settings";

const selectedModel = defineModel<string>({ default: "" });
const reasoningEffort = defineModel<string>("reasoningEffort", { default: "" });
const props = withDefaults(defineProps<{ active?: boolean; disabled?: boolean }>(), { active: true, disabled: false });
const visible = ref(false);
const selectedProviderId = computed(() => {
  try {
    const value = JSON.parse(selectedModel.value);
    return Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
  } catch { return ""; }
});
const reasoningLabels: Record<string, string> = { none: "关闭", minimal: "最少", low: "低", medium: "中", high: "高", xhigh: "超高", max: "最大", ultra: "极高" };
const reasoningOptions = computed(() => {
  const choice = selectedModelChoice.value;
  const catalog = engineModelCatalog.value[selectedProviderId.value];
  const model = catalog?.models.find(item => item.id === (choice?.modelId || catalog.defaultModel));
  const levels = selectedProviderId.value === "codex" ? model?.reasoningEfforts ?? [] : ["low", "medium", "high"];
  return [{ label: "默认", value: "" }, ...levels.filter(level => reasoningLabels[level]).map(level => ({ label: reasoningLabels[level], value: level }))];
});
// 引擎供应商固定为第一组，未接入的引擎禁用。
const implementedEngines = new Set(["claude-code", "codex"]);
const modelGroups = computed(() => {
  const engineGroup = engineProviders.value.map(provider => {
    const items = [{ id: "", label: getEngineDefaultLabel() }, ...getEngineProviderModels(provider.id)];
    return {
      id: provider.id,
      label: provider.label,
      models: items.map(model => ({
        id: model.id, label: model.label, disabled: !implementedEngines.has(provider.engine ?? ""),
      })),
    };
  });
  const normalGroups = customProviders.value
    .filter(provider => !engineProviders.value.some(engine => engine.id === provider.id))
    .toSorted((left, right) => Number(right.id === "tfRouter") - Number(left.id === "tfRouter"))
    .map(provider => ({ id: provider.id, label: provider.label, models: provider.models.map(model => ({ id: model.id, label: model.label, disabled: false })) }));
  return [...engineGroup, ...normalGroups];
});
const selectedModelChoice = computed(() => modelChoices.value.find(item => item.value === selectedModel.value));
const currentEngineModel = computed(() => selectedModelChoice.value?.modelId === "" ? engineModelCatalog.value[selectedModelChoice.value.providerId]?.defaultModel : "");
const catalogError = computed(() => engineModelCatalog.value[selectedProviderId.value]?.error);
const reasoningLabel = computed(() => reasoningOptions.value.find(item => item.value === reasoningEffort.value)?.label ?? "默认");
watch(reasoningOptions, options => {
  if (selectedProviderId.value === "codex" && (!engineModelCatalog.value.codex || engineModelCatalog.value.codex.error)) return;
  if (!options.some(item => item.value === reasoningEffort.value)) reasoningEffort.value = "";
});
watch(visible, open => { if (open) void loadEngineModels().catch(() => {}); });
watch(modelChoices, items => {
  if (engineProviders.value.some(provider => provider.id === selectedProviderId.value) && (!engineModelCatalog.value[selectedProviderId.value] || engineModelCatalog.value[selectedProviderId.value]?.error)) return;
  // 默认选中跳过引擎供应商：未确认本机安装前不作为默认选项。
  if (!selectedModel.value || !items.some(item => item.value === selectedModel.value)) {
    const first = items.find(item => item.providerId === selectedProviderId.value) ?? items.find(item => !item.providerId.startsWith("claude-code") && !item.providerId.startsWith("codex")) ?? items[0];
    if (first) selectedModel.value = first.value;
  }
}, { immediate: true });
watch(() => !props.active || props.disabled, close => { if (close) visible.value = false; });
</script>

<style lang="scss">
.modelPopover {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;

  .modelButton {
    max-width: 100%;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    color: var(--el-text-color-regular);

    > span {
      display: flex;
      gap: 6px;
      min-width: 0;
    }
    svg {
      flex-shrink: 0;
    }

    .reasoningLabel {
      flex-shrink: 0;
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }

    .modelName {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
    }
  }
}

.agentModelPopover {
  .modelHint {
    margin: 0 0 12px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
  .modelOptions {
    .el-form-item {
      margin-bottom: 24px;

      &:last-child {
        margin-bottom: 0;
      }
      .el-form-item__label {
        margin-bottom: 10px;
        font-weight: 500;
        color: var(--el-text-color-primary);
      }
      .el-segmented {
        width: 100%;
        .el-segmented__item {
          padding-inline: 4px;
        }

        @media (max-width: 360px) {
          .el-segmented__item {
            padding-inline: 4px;
          }
        }
      }
    }
  }
}
</style>
