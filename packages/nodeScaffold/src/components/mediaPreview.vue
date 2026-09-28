<template>
  <el-popover trigger="hover" placement="right" :width="previewWidth" :showAfter="150" :hideAfter="200" teleported>
    <template #reference><slot /></template>
    <div class="mediaPreviewBody" :style="{ width: `${previewWidth - 24}px` }">
      <img v-if="isImage && fileUrl" class="previewImage" :src="fileUrl" alt="" />
      <video v-else-if="isVideo && fileUrl" class="previewVideo" :src="fileUrl" controls autoplay muted />
      <audio v-else-if="isAudio && fileUrl" class="previewAudio" :src="fileUrl" controls />
      <div v-else class="previewLoading">{{ fileUrl ? "无法预览该文件" : "加载中…" }}</div>
      <div class="previewName" :title="file.url">{{ file.url.split("/").at(-1) }}</div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ElPopover, ElMessage } from "element-plus";
import { useNodeFiles } from "../workspaceFiles";
import type { GenerationFile } from "../useNodeGeneration";

const props = defineProps<{ file: GenerationFile }>();
const isImage = computed(() => props.file.mimeType.startsWith("image/"));
const isVideo = computed(() => props.file.mimeType.startsWith("video/"));
const isAudio = computed(() => props.file.mimeType.startsWith("audio/"));
const previewWidth = computed(() => (isVideo.value ? 460 : isImage.value ? 420 : 320));
const { useFileUrl } = useNodeFiles();
const fileUrl = useFileUrl(
  computed(() => props.file),
  error => ElMessage.error((error instanceof Error && error.message) || "文件读取失败")
);
</script>

<style scoped lang="scss">
.mediaPreviewBody {
  display: flex;
  flex-direction: column;
  gap: 6px;

  .previewImage {
    max-width: 100%;
    max-height: 420px;
    object-fit: contain;
    border-radius: 4px;
  }

  .previewVideo {
    width: 100%;
    max-height: 300px;
    border-radius: 4px;
    background: #000;
  }

  .previewAudio {
    width: 100%;
  }

  .previewLoading {
    padding: 24px 0;
    text-align: center;
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }

  .previewName {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
