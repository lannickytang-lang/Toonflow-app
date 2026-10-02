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
          ·
          <span class="reasoningLabel">{{ reasoningLabel }}</span>
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
        <el-form-item label="推理等级">
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
import { customProviders, engineProviders, modelChoices } from "@/stores/settings";

const selectedModel = defineModel<string>({ default: "" });
const reasoningEffort = defineModel<string>("reasoningEffort", { default: "" });
const props = withDefaults(defineProps<{ active?: boolean; disabled?: boolean }>(), { active: true, disabled: false });
const visible = ref(false);
const reasoningOptions = [
  { label: "默认", value: "" },
  { label: "低", value: "low" },
  { label: "中", value: "medium" },
  { label: "高", value: "high" },
];
// 引擎供应商固定为第一组（已添加的用保存配置，未添加的用内置定义合成）；codex 等未接入引擎的模型禁用。
const implementedEngines = new Set(["claude-code"]);
const modelGroups = computed(() => {
  const byId = new Map(customProviders.value.map(provider => [provider.id, provider]));
  const engineGroup = engineProviders.value.map(provider => {
    const models = byId.get(provider.id)?.models ?? provider.models;
    // 引擎未配置模型时给一条"CLI 默认模型"（id 空串 = 发送时不传 modelId，CLI 用自身默认），避免下拉里选不到引擎。
    const items = models.length ? models : [{ id: "", label: "CLI 默认模型" }];
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
const reasoningLabel = computed(() => reasoningOptions.find(item => item.value === reasoningEffort.value)?.label ?? "默认");
watch(selectedModel, () => { reasoningEffort.value = ""; });
watch(modelChoices, items => {
  // 默认选中跳过引擎供应商：未确认本机安装前不作为默认选项。
  if (!selectedModel.value || !items.some(item => item.value === selectedModel.value)) {
    const first = items.find(item => !item.providerId.startsWith("claude-code") && !item.providerId.startsWith("codex")) ?? items[0];
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

        @media (max-width: 360px) {
          .el-segmented__item {
            padding-inline: 6px;
          }
        }
      }
    }
  }
}
</style>
