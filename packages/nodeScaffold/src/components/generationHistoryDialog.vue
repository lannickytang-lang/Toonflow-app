<template>
  <el-dialog
    v-model="visible"
    title="生成历史"
    width="min(920px, 94vw)"
    alignCenter
    appendToBody
    :closeOnClickModal="false">
    <div v-if="!records.length" class="historyEmpty">暂无生成历史，生成一次后这里会记录每轮的提示词、参考与产出结果</div>
    <el-scrollbar v-else max-height="64vh">
      <div class="historyTable">
        <div class="tableRow head">
          <span class="cell preview">预览</span>
          <span class="cell time">时间</span>
          <span class="cell status">状态</span>
          <span class="cell model">模型</span>
          <span class="cell prompt">提示词</span>
          <span class="cell refs">参考</span>
          <span class="cell action">操作</span>
        </div>
        <div v-for="record in records" :key="record.id ?? record.startedAt" class="tableRow" :class="record.status">
          <span class="cell preview">
            <generationHistoryFile
              v-if="record.files?.length"
              :file="record.files[0]"
              :active="record.files[0].url === currentUrl"
              :extra="record.files.length - 1"
              @select="emit('select', $event)" />
            <span v-else class="noFile">—</span>
          </span>
          <span class="cell time" :title="record.startedAt">{{ formatTime(record.startedAt) }}</span>
          <span class="cell status">
            <el-tag :type="record.status === 'succeeded' ? 'success' : record.status === 'failed' ? 'danger' : 'info'" size="small" effect="light">
              {{ record.status === "succeeded" ? "成功" : record.status === "failed" ? "失败" : "生成中" }}
            </el-tag>
          </span>
          <span class="cell model" :title="record.model">{{ record.model || "—" }}</span>
          <span class="cell prompt">
            <span class="promptText" :title="record.prompt">{{ record.prompt || "—" }}</span>
            <span v-if="record.error" class="errorText" :title="record.error">{{ record.error }}</span>
          </span>
          <span class="cell refs" :title="record.inputs?.map(item => item.url).join('\n')">
            {{ record.inputs?.length ? `${record.inputs.length} 个文件` : "—" }}
          </span>
          <span class="cell action">
            <template v-if="record.files?.length">
              <el-tag v-if="isCurrentRecord(record)" size="small" effect="plain" round>当前输出</el-tag>
              <el-button v-else-if="record.files.length === 1" size="small" type="primary" plain @click="emit('select', record.files[0])">设为当前</el-button>
              <el-dropdown v-else trigger="click" @command="(url: string) => emit('select', record.files!.find(item => item.url === url)!)">
                <el-button size="small" type="primary" plain>设为当前</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item v-for="(file, index) in record.files" :key="file.url" :command="file.url">
                      文件 {{ index + 1 }}

                      {{ file.url.split("/").at(-1) }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
            <span v-else>—</span>
          </span>
        </div>
      </div>
    </el-scrollbar>
    <template #footer>
      <span class="historyHint">悬停缩略图可放大预览；点击「设为当前」或缩略图将对应结果设为当前输出，下游连线立即引用</span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ElDialog, ElTag, ElScrollbar, ElButton, ElDropdown, ElDropdownMenu, ElDropdownItem } from "element-plus";
import generationHistoryFile from "./generationHistoryFile.vue";
import type { GenerationFile, GenerationRecord } from "../useNodeGeneration";

const visible = defineModel<boolean>({ default: false });
const props = defineProps<{ history: GenerationRecord[]; currentUrl?: string }>();
const emit = defineEmits<{ select: [file: GenerationFile] }>();
const records = computed(() => [...props.history].reverse());

function isCurrentRecord(record: GenerationRecord) {
  return !!props.currentUrl && (record.files ?? []).some(file => file.url === props.currentUrl);
}

function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${sameYear ? "" : `${date.getFullYear()}-`}${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
</script>

<style scoped lang="scss">
.historyEmpty {
  padding: 32px 0;
  text-align: center;
  color: var(--el-text-color-secondary);
}

.historyTable {
  display: flex;
  flex-direction: column;
  font-size: 13px;

  .tableRow {
    display: grid;
    grid-template-columns: 76px 128px 56px 150px 1fr 72px 96px;
    gap: 8px;
    align-items: center;
    padding: 8px 4px;
    border-bottom: 1px solid var(--el-border-color-extra-light);

    &.head {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--el-bg-color);
      color: var(--el-text-color-secondary);
      font-weight: 500;
    }

    .cell {
      min-width: 0;
      overflow: hidden;

      &.preview {
        display: flex;
        justify-content: center;
      }

      &.time {
        font-size: 12px;
        color: var(--el-text-color-secondary);
        white-space: nowrap;
      }

      &.model {
        font-size: 12px;
        color: var(--el-text-color-secondary);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &.prompt {
        display: flex;
        flex-direction: column;
        gap: 2px;

        .promptText {
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .errorText {
          font-size: 12px;
          color: var(--el-color-danger);
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }

      &.refs {
        font-size: 12px;
        color: var(--el-text-color-secondary);
        white-space: nowrap;
      }

      &.action {
        display: flex;
        justify-content: center;
      }

      .noFile {
        color: var(--el-text-color-placeholder);
      }
    }
  }
}

.historyHint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
