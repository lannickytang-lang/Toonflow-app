<template>
  <mediaPreview :file="file">
    <div
      class="historyThumb"
      :class="{ active, selectable: !active }"
      role="button"
      :tabindex="selectable ? 0 : -1"
      :aria-label="active ? '当前输出' : `设为当前输出：${file.url.split('/').at(-1)}`"
      :title="active ? '当前输出' : '点击设为当前输出，悬停预览'"
      @click="selectable && emit('select', file)">
      <img v-if="file.mimeType.startsWith('image/') && thumbUrl" :src="thumbUrl" alt="" loading="lazy" />
      <video v-else-if="file.mimeType.startsWith('video/') && thumbUrl" :src="thumbUrl" preload="metadata" muted />
      <div v-else class="thumbFallback">{{ file.url.split(".").at(-1) }}</div>
      <span v-if="active" class="activeBadge">当前</span>
      <span v-if="extra" class="extraBadge">+{{ extra }}</span>
    </div>
  </mediaPreview>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ElMessage } from "element-plus";
import { useNodeFiles } from "../workspaceFiles";
import type { GenerationFile } from "../useNodeGeneration";
import mediaPreview from "./mediaPreview.vue";

const props = defineProps<{ file: GenerationFile; active?: boolean; extra?: number }>();
const emit = defineEmits<{ select: [file: GenerationFile] }>();
const selectable = computed(() => !props.active);
const { useFileUrl } = useNodeFiles();
const thumbUrl = useFileUrl(
  computed(() => props.file),
  error => ElMessage.error((error instanceof Error && error.message) || "历史文件读取失败")
);
</script>

<style scoped lang="scss">
.historyThumb {
  position: relative;
  width: 64px;
  height: 48px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
  overflow: hidden;
  background: var(--el-fill-color-light);
  display: flex;
  align-items: center;
  justify-content: center;

  &.selectable {
    cursor: pointer;

    &:hover,
    &:focus-visible {
      border-color: var(--el-color-primary);
    }
  }

  &.active {
    border-color: var(--el-color-primary);
    box-shadow: 0 0 0 1px var(--el-color-primary) inset;
  }

  img,
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }

  .thumbFallback {
    font-size: 10px;
    color: var(--el-text-color-secondary);
    text-transform: uppercase;
  }

  .activeBadge {
    position: absolute;
    top: 2px;
    left: 2px;
    padding: 0 4px;
    border-radius: 3px;
    font-size: 10px;
    line-height: 16px;
    color: #fff;
    background: var(--el-color-primary);
  }

  .extraBadge {
    position: absolute;
    right: 2px;
    bottom: 2px;
    padding: 0 4px;
    border-radius: 3px;
    font-size: 10px;
    line-height: 14px;
    color: #fff;
    background: rgba(0, 0, 0, 0.6);
  }
}
</style>
