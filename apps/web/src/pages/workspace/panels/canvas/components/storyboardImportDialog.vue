<template>
  <el-dialog v-model="visible" title="导入分镜脚本" width="min(960px, 94vw)" alignCenter appendToBody :closeOnClickModal="false">
    <div class="storyboardImport">
      <el-steps :active="activeStep - 1" simple class="stepBar">
        <el-step title="准备原文" />
        <el-step title="校对结果" />
        <el-step title="导入设置" />
      </el-steps>

      <div v-show="activeStep === 1" class="stepContent">
        <div class="templateRow">
          <span class="fieldLabel">解析模板</span>
          <el-select v-model="selectedTemplate" placeholder="选择历史模板" class="templateSelect" :loading="templatesLoading">
            <el-option v-for="item in templates" :key="item.name" :value="item.name" :label="item.name" />
          </el-select>
          <el-tooltip :showArrow="false" content="改名" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]">
            <el-button :disabled="!selectedTemplate" :icon="IconEdit" circle aria-label="模板改名" @click="renameTemplateAction" />
          </el-tooltip>
          <el-tooltip :showArrow="false" content="导出模板" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]">
            <el-button :disabled="!selectedTemplate" :icon="IconDownload" circle aria-label="导出模板" @click="exportTemplate" />
          </el-tooltip>
          <el-upload :auto-upload="false" :show-file-list="false" accept=".json" :on-change="importTemplateFile" class="uploadTrigger">
            <el-tooltip :showArrow="false" content="导入模板" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]">
              <el-button :icon="IconFileUpload" circle aria-label="导入模板" />
            </el-tooltip>
          </el-upload>
          <span class="rowSpacer" />
          <el-tooltip :showArrow="false" content="下载「分镜脚本导入」技能文件，分享给其他用户安装后即可使用 /命令 智能生成模板" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]">
            <el-button :icon="IconDownload" aria-label="下载分镜导入技能" @click="downloadSkill">下载技能</el-button>
          </el-tooltip>
          <el-button :icon="IconRefresh" :loading="templatesLoading" circle aria-label="刷新模板列表" @click="loadTemplates" />
        </div>

        <el-alert v-if="templateDescription" class="descriptionAlert" type="info" :closable="false" showIcon>
          <template #title>{{ templateDescription }}</template>
        </el-alert>

        <el-input v-model="rawText" type="textarea" :rows="6" placeholder="粘贴分镜脚本原文（一批视频指令、资产设定等）" aria-label="分镜脚本原文" />

        <el-upload
          class="scriptUpload"
          drag
          :auto-upload="false"
          :show-file-list="false"
          :on-change="loadScriptFile">
          <div class="uploadHint">
            <p class="uploadMain">拖拽本地脚本文件到此处，或<em>点击选择文件</em></p>
            <p class="uploadSub">支持 .md、.txt 等文本文件，内容将填入上方输入框，也可直接粘贴</p>
          </div>
        </el-upload>
      </div>

      <div v-show="activeStep === 2" class="stepContent">
        <div class="parseRow">
          <span class="parseSummary">{{ parseSummary }}</span>
        </div>
        <el-tabs v-model="activeTab" class="resultTabs">
          <el-tab-pane :label="`资产（${parsed?.assets.length ?? 0}）`" name="assets">
            <el-table v-if="parsed" :data="pagedAssets" size="small" class="resultTable" :height="340">
              <el-table-column label="名称" width="140">
                <template #default="{ row }"><el-input v-model="row.name" size="small" placeholder="资产名" /></template>
              </el-table-column>
              <el-table-column label="生图指令" min-width="220">
                <template #default="{ row }"><el-input v-model="row.imagePrompt" size="small" placeholder="无则留空" /></template>
              </el-table-column>
              <el-table-column label="参考图路径" min-width="150">
                <template #default="{ row }"><el-input v-model="row.filePath" size="small" placeholder="可选，工作区相对路径" /></template>
              </el-table-column>
              <el-table-column label="参考音频" min-width="130">
                <template #default="{ row }"><el-input v-model="row.videoPath" size="small" placeholder="可选" /></template>
              </el-table-column>
              <el-table-column label="" width="60" align="right">
                <template #default="{ $index }"><el-button link type="danger" size="small" :aria-label="`删除资产 ${assetPageStart + $index + 1}`" @click="removeAsset(assetPageStart + $index)">删除</el-button></template>
              </el-table-column>
            </el-table>
            <div class="tableFooter">
              <el-button size="small" @click="addAssetRow">添加资产</el-button>
              <el-pagination
                v-model:current-page="assetPage"
                :page-size="defaultPageSize"
                :total="parsed?.assets.length ?? 0"
                layout="total, prev, pager, next"
                :pager-count="5"
                small />
            </div>
          </el-tab-pane>
          <el-tab-pane :label="`分镜（${parsed?.scenes.length ?? 0}）`" name="scenes">
            <el-table v-if="parsed" :data="pagedScenes" size="small" class="resultTable" :height="340">
              <el-table-column label="序号" width="80">
                <template #default="{ row }"><el-input-number v-model="row.sortNum" size="small" :min="1" :controls="false" aria-label="分镜序号" /></template>
              </el-table-column>
              <el-table-column label="视频指令" min-width="320">
                <template #default="{ row }"><el-input v-model="row.videoPrompt" size="small" type="textarea" :rows="2" placeholder="视频生成提示词" /></template>
              </el-table-column>
              <el-table-column label="出镜资产" min-width="150">
                <template #default="{ row }"><el-input v-model="row.castText" size="small" placeholder="资产名，逗号分隔" /></template>
              </el-table-column>
              <el-table-column label="" width="60" align="right">
                <template #default="{ $index }"><el-button link type="danger" size="small" :aria-label="`删除分镜 ${scenePageStart + $index + 1}`" @click="removeScene(scenePageStart + $index)">删除</el-button></template>
              </el-table-column>
            </el-table>
            <div class="tableFooter">
              <el-button size="small" @click="addSceneRow">添加分镜</el-button>
              <el-pagination
                v-model:current-page="scenePage"
                :page-size="defaultPageSize"
                :total="parsed?.scenes.length ?? 0"
                layout="total, prev, pager, next"
                :pager-count="5"
                small />
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>

      <div v-show="activeStep === 3" class="stepContent">
        <div class="importOptions">
          <span class="fieldLabel">视频模型</span>
          <el-select v-model="videoModel" class="modelSelect" placeholder="选择视频模型" :loading="modelsLoading">
            <el-option v-for="item in videoModelOptions" :key="`${item.providerId}/${item.modelId}`" :value="item" :label="item.label" />
          </el-select>
          <span class="fieldLabel">时长</span>
          <el-input-number v-model="duration" :min="1" :max="15" :controls="false" class="durationInput" aria-label="视频时长秒数" />
          <span class="fieldLabel">分辨率</span>
          <el-select v-model="resolution" class="resolutionSelect">
            <el-option v-for="item in resolutionOptions" :key="item" :value="item" :label="item" />
          </el-select>
        </div>
        <el-checkbox v-model="autoGenerateImages">导入后自动生成缺失资产图</el-checkbox>
        <el-alert class="summaryAlert" type="success" :closable="false" showIcon>
          <template #title>将导入 {{ parsed?.assets.length ?? 0 }} 个资产、{{ parsed?.scenes.length ?? 0 }} 个分镜，导入后自动连线并整理画布</template>
        </el-alert>
      </div>

      <div v-if="importingText" class="importProgress" role="status">{{ importingText }}</div>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button v-if="activeStep > 1" @click="activeStep -= 1">上一步</el-button>
      <el-button v-if="activeStep === 1" type="primary" :disabled="!selectedTemplate || !rawText" :loading="parsing" @click="goToReview">解析并校对</el-button>
      <el-button v-if="activeStep === 2" type="primary" @click="activeStep = 3">下一步</el-button>
      <el-button v-if="activeStep === 3" type="primary" :disabled="!parsed || (!parsed.assets.length && !parsed.scenes.length)" :loading="importing" @click="importStoryboard">确认导入</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import axios from "axios";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconRefresh, IconEdit, IconDownload, IconFileUpload } from "@tabler/icons-vue";
import type { UploadFile } from "element-plus";
import type { CanvasContext } from "@toonflow/tool-canvas/runtime";
import useWorkspaceFiles from "@/lib/workspaceFiles";

type TemplateInfo = { name: string; description: string; updatedAt: string; hasScript: boolean };
type AssetRow = { name: string; imagePrompt: string; filePath: string; videoPath: string };
type SceneRow = { sortNum: number; videoPrompt: string; castText: string };
type VideoModelOption = { providerId: string; modelId: string; label: string };
type ParsedData = { assets: AssetRow[]; scenes: SceneRow[] };
type CanvasCallResult = { node: { id: string } };
type ExportedTemplate = { kind: string; name: string; description: string; script: string; exportedAt: string };

const visible = defineModel<boolean>("visible", { default: false });
const props = defineProps<{ canvasId: string; directory: string | undefined }>();
const createCanvasContext = inject<(() => CanvasContext | undefined) | undefined>("canvas", undefined);
const batchHistory = inject<((action: () => Promise<void>) => Promise<void>) | undefined>("batchCanvasHistory", undefined);
const workspaceHeaders = { "x-toonflow-workspace": "1" };
const resolutionOptions = ["480p", "768p", "1080p"];
const templateKind = "toonflow-storyboard-template";
const skillName = "storyboardImport";
const defaultPageSize = 20;

const activeStep = ref(1);
const templates = ref<TemplateInfo[]>([]);
const templatesLoading = ref(false);
const selectedTemplate = ref("");
const rawText = ref("");
const parsing = ref(false);
const parsed = ref<ParsedData | null>(null);
const activeTab = ref("assets");
const assetPage = ref(1);
const scenePage = ref(1);
const videoModelOptions = ref<VideoModelOption[]>([]);
const modelsLoading = ref(false);
const videoModel = ref<VideoModelOption | null>(null);
const duration = ref(6);
const resolution = ref("768p");
const autoGenerateImages = ref(false);
const importing = ref(false);
const importingText = ref("");
let pushAbort: AbortController | undefined;

const parseSummary = computed(() => parsed.value ? `解析出 ${parsed.value.assets.length} 个资产、${parsed.value.scenes.length} 个分镜，可在表格中手动调整` : "");
const templateDescription = computed(() => templates.value.find(item => item.name === selectedTemplate.value)?.description ?? "");
const assetPageStart = computed(() => (assetPage.value - 1) * defaultPageSize);
const scenePageStart = computed(() => (scenePage.value - 1) * defaultPageSize);
const pagedAssets = computed(() => parsed.value?.assets.slice(assetPageStart.value, assetPageStart.value + defaultPageSize) ?? []);
const pagedScenes = computed(() => parsed.value?.scenes.slice(scenePageStart.value, scenePageStart.value + defaultPageSize) ?? []);

watch(visible, open => {
  if (open) {
    activeStep.value = 1;
    void loadTemplates();
    void loadVideoModels();
  }
});

onMounted(listenStoryboardPush);
onBeforeUnmount(() => pushAbort?.abort());

// AI 通过 pushStoryboardImport 工具推送解析结果时,自动打开弹框、跳到校对步骤并填入表格。
// ACT: EventSource 同源请求不带 Origin 会触发来源校验 403,因此用 fetch 流读取并手动解析 SSE。
function handlePushData(raw: string) {
  try {
    const payload = JSON.parse(raw) as { type?: string; assets?: unknown; scenes?: unknown };
    if (payload.type !== "storyboardImport") return;
    parsed.value = normalizeParsed(payload);
    assetPage.value = 1;
    scenePage.value = 1;
    activeStep.value = 2;
    activeTab.value = parsed.value.scenes.length ? "scenes" : "assets";
    visible.value = true;
    ElMessage.success("AI 已推送分镜解析结果，请校对表格后确认导入");
  } catch {
    ElMessage.error("收到无效的分镜推送数据");
  }
}

async function listenStoryboardPush() {
  pushAbort = new AbortController();
  try {
    const response = await fetch("/api/storyboardImport/events", { headers: { "x-toonflow-workspace": "1" }, signal: pushAbort.signal });
    if (!response.ok || !response.body) throw new Error(`连接失败 HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const dataLine = chunk.split("\n").find(line => line.startsWith("data: "));
        if (dataLine) handlePushData(dataLine.slice(6));
      }
    }
  } catch {
    // 中断或网络异常后延迟重连;组件卸载时 pushAbort 已中止,不再重连。
  } finally {
    if (pushAbort && !pushAbort.signal.aborted) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (!pushAbort.signal.aborted) void listenStoryboardPush();
    }
  }
}

async function loadTemplates() {
  templatesLoading.value = true;
  try {
    const { data } = await axios.get("/api/storyboardTemplates/list", { headers: workspaceHeaders });
    templates.value = data.data ?? [];
    if (selectedTemplate.value && !templates.value.some(item => item.name === selectedTemplate.value)) selectedTemplate.value = "";
    if (!selectedTemplate.value && templates.value.length) selectedTemplate.value = templates.value[0]!.name;
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || "模板列表读取失败" : "模板列表读取失败");
  } finally {
    templatesLoading.value = false;
  }
}

async function loadVideoModels() {
  modelsLoading.value = true;
  try {
    const { data } = await axios.get("/api/providers/media/list", { headers: workspaceHeaders });
    const providers = (data.data ?? []) as { id: string; label: string; models: { id: string; label: string; type: string }[] }[];
    videoModelOptions.value = providers.flatMap(provider => provider.models
      .filter(model => model.type === "video")
      .map(model => ({ providerId: provider.id, modelId: model.id, label: `${provider.label} / ${model.label || model.id}` })));
    videoModel.value = videoModelOptions.value.find(item => item.providerId === "grsai" && item.modelId === "minimax-h3") ?? videoModelOptions.value[0] ?? null;
  } catch {
    videoModelOptions.value = [];
  } finally {
    modelsLoading.value = false;
  }
}

async function renameTemplateAction() {
  if (!selectedTemplate.value) return;
  const { value } = await ElMessageBox.prompt("请输入新的模板名称", "模板改名", {
    inputValue: selectedTemplate.value,
    inputPattern: /^[a-zA-Z0-9_\-\u4e00-\u9fa5]{1,64}$/,
    inputErrorMessage: "名称只能包含中文、字母、数字、下划线和短横线",
    confirmButtonText: "改名", cancelButtonText: "取消",
  }).catch(() => ({ value: "" }));
  if (!value || value === selectedTemplate.value) return;
  try {
    await axios.post("/api/storyboardTemplates/rename", { name: selectedTemplate.value, target: value }, { headers: workspaceHeaders });
    selectedTemplate.value = value;
    await loadTemplates();
    ElMessage.success("模板已改名");
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || "改名失败" : "改名失败");
  }
}

function downloadBlob(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function exportTemplate() {
  if (!selectedTemplate.value) return;
  try {
    const { data } = await axios.get(`/api/storyboardTemplates/get?name=${encodeURIComponent(selectedTemplate.value)}`, { headers: workspaceHeaders });
    const exported: ExportedTemplate = {
      kind: templateKind,
      name: data.data.name,
      description: data.data.description ?? "",
      script: data.data.script,
      exportedAt: new Date().toISOString(),
    };
    downloadBlob(JSON.stringify(exported, null, 2), `${exported.name}.sbtpl.json`, "application/json");
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || "导出失败" : "导出失败");
  }
}

async function importTemplateFile(uploadFile: UploadFile) {
  try {
    const content = await uploadFile.raw?.text();
    if (!content) return;
    const imported = JSON.parse(content) as Partial<ExportedTemplate>;
    if (imported.kind !== templateKind || typeof imported.script !== "string" || !imported.name) {
      throw new Error("不是有效的分镜导入模板文件");
    }
    await axios.post("/api/storyboardTemplates/save", {
      name: imported.name,
      description: imported.description ?? "",
      script: imported.script,
    }, { headers: workspaceHeaders });
    await loadTemplates();
    selectedTemplate.value = imported.name;
    ElMessage.success(`模板「${imported.name}」已导入`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "模板导入失败");
  }
}

async function downloadSkill() {
  try {
    const { data } = await axios.get(`/api/skills/read?name=${skillName}`, { headers: workspaceHeaders });
    downloadBlob(data.data.content, "分镜脚本导入技能.md", "text/markdown");
  } catch (error) {
    ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || "技能下载失败" : "技能下载失败");
  }
}

async function loadScriptFile(uploadFile: UploadFile) {
  try {
    const content = await uploadFile.raw?.text();
    if (content === undefined) return;
    rawText.value = content;
    ElMessage.success(`已载入「${uploadFile.name}」（${content.length} 字符）`);
  } catch {
    ElMessage.error("文件读取失败，请确认是文本文件");
  }
}

function normalizeParsed(value: unknown) {
  const source = (value ?? {}) as { assets?: unknown; scenes?: unknown };
  const assets = Array.isArray(source.assets) ? source.assets : [];
  const scenes = Array.isArray(source.scenes) ? source.scenes : [];
  return {
    assets: assets.map((item, index) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        name: String(row.name ?? "").trim() || `资产${index + 1}`,
        imagePrompt: String(row.imagePrompt ?? ""),
        filePath: row.filePath ? String(row.filePath).trim() : "",
        videoPath: row.videoPath ? String(row.videoPath).trim() : "",
      };
    }),
    scenes: scenes.map((item, index) => {
      const row = (item ?? {}) as Record<string, unknown>;
      const cast = Array.isArray(row.cast) ? row.cast : typeof row.cast === "string" ? row.cast.split(/[,，、;；]/) : [];
      return {
        sortNum: Number(row.sortNum) || index + 1,
        videoPrompt: String(row.videoPrompt ?? ""),
        castText: cast.map(item => String(item).trim()).filter(Boolean).join("，"),
      };
    }),
  };
}

async function goToReview() {
  if (!selectedTemplate.value) return;
  parsing.value = true;
  try {
    const { data } = await axios.get(`/api/storyboardTemplates/get?name=${encodeURIComponent(selectedTemplate.value)}`, { headers: workspaceHeaders });
    const script = String(data.data?.script ?? "");
    const factory = new Function(`${script}\nreturn typeof parse === "function" ? parse : undefined;`);
    const parse = factory();
    if (typeof parse !== "function") throw new Error("模板脚本未定义 parse 函数");
    const result = await parse(rawText.value);
    parsed.value = normalizeParsed(result);
    assetPage.value = 1;
    scenePage.value = 1;
    if (!parsed.value.assets.length && !parsed.value.scenes.length) {
      ElMessage.warning("解析结果为空，请检查模板与原文是否匹配");
      return;
    }
    activeStep.value = 2;
    activeTab.value = parsed.value.scenes.length ? "scenes" : "assets";
  } catch (error) {
    ElMessage.error(error instanceof Error ? `解析失败：${error.message}` : "解析失败");
  } finally {
    parsing.value = false;
  }
}

function addAssetRow() {
  parsed.value?.assets.push({ name: `资产${parsed.value.assets.length + 1}`, imagePrompt: "", filePath: "", videoPath: "" });
}

function addSceneRow() {
  parsed.value?.scenes.push({ sortNum: parsed.value.scenes.length + 1, videoPrompt: "", castText: "" });
}

function removeAsset(index: number) {
  parsed.value?.assets.splice(index, 1);
  const lastPage = Math.max(1, Math.ceil((parsed.value?.assets.length ?? 0) / defaultPageSize));
  if (assetPage.value > lastPage) assetPage.value = lastPage;
}

function removeScene(index: number) {
  parsed.value?.scenes.splice(index, 1);
  const lastPage = Math.max(1, Math.ceil((parsed.value?.scenes.length ?? 0) / defaultPageSize));
  if (scenePage.value > lastPage) scenePage.value = lastPage;
}

function guessMimeType(filePath: string) {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "image/png";
}

async function callCanvas<T = CanvasCallResult>(name: string, args: Record<string, unknown>): Promise<T> {
  const context = createCanvasContext?.();
  if (!context) throw new Error("画布未就绪，请确认已打开画布");
  return context.call({ name, args }) as Promise<T>;
}

async function importStoryboard() {
  const data = parsed.value;
  if (!data || importing.value) return;
  importing.value = true;
  importingText.value = "正在读取画布…";
  try {
    await (batchHistory ? batchHistory(() => runImport(data)) : runImport(data));
    ElMessage.success("导入完成");
    importingText.value = "";
    visible.value = false;
  } catch (error) {
    importingText.value = "";
    ElMessage.error(error instanceof Error ? error.message : "导入失败");
  } finally {
    importing.value = false;
  }
}

async function runImport(data: ParsedData) {
  const snapshot = await callCanvas<{ availableNodeTypes: { type: string; label: string }[] }>("getCanvas", {});
  const findType = (...names: string[]) => snapshot.availableNodeTypes.find(item => names.some(name => item.type === `remote-${name}` || item.type === name))?.type;
  const imageType = findType("imageNode");
  const imageGenType = findType("imageGenerationNode");
  const videoGenType = findType("videoGenerationNode");
  if (!videoGenType) throw new Error("未找到视频生成节点，请确认节点插件已安装并启用");

  const total = data.assets.length + data.scenes.length;
  let completed = 0;
  const assetNodeIds = new Map<string, string>();

  for (const asset of data.assets) {
    importingText.value = `正在创建资产节点（${++completed}/${total}）：${asset.name}`;
    if (asset.filePath && imageType) {
      const info = await callCanvas("addNode", { type: imageType, position: { x: 0, y: 0 }, label: asset.name });
      await callCanvas("nodeTools", { nodeId: info.node.id, name: "node:setImage", args: { path: asset.filePath, mimeType: guessMimeType(asset.filePath) } });
      assetNodeIds.set(asset.name, info.node.id);
    } else if (imageGenType && (asset.imagePrompt || asset.filePath)) {
      const info = await callCanvas("addNode", { type: imageGenType, position: { x: 0, y: 0 }, label: asset.name });
      await callCanvas("nodeTools", { nodeId: info.node.id, name: "node:setPrompt", args: { prompt: asset.imagePrompt || `参考图：${asset.filePath}` } });
      if (autoGenerateImages.value && asset.imagePrompt) await callCanvas("nodeTools", { nodeId: info.node.id, name: "node:generateImage", args: {} });
      assetNodeIds.set(asset.name, info.node.id);
    }
  }

  const sceneNodeIds: { id: string; cast: string[] }[] = [];
  for (const scene of [...data.scenes].sort((left, right) => left.sortNum - right.sortNum)) {
    importingText.value = `正在创建分镜节点（${++completed}/${total}）：分镜${scene.sortNum}`;
    const info = await callCanvas("addNode", { type: videoGenType, position: { x: 0, y: 0 }, label: `分镜${scene.sortNum}` });
    await callCanvas("nodeTools", { nodeId: info.node.id, name: "node:setPrompt", args: { prompt: scene.videoPrompt } });
    if (videoModel.value) {
      await callCanvas("nodeTools", {
        nodeId: info.node.id,
        name: "node:setConfig",
        args: { providerId: videoModel.value.providerId, modelId: videoModel.value.modelId, duration: duration.value, resolution: resolution.value },
      });
    }
    sceneNodeIds.push({ id: info.node.id, cast: scene.castText.split(/[,，、;；]/).map(item => item.trim()).filter(Boolean) });
  }

  importingText.value = "正在连接出镜资产…";
  const connections = sceneNodeIds.flatMap(({ id, cast }) => cast
    .map(name => assetNodeIds.get(name))
    .filter((source): source is string => !!source)
    .map(source => ({ source, target: id, sourceHandle: "image", targetHandle: "in" })));
  if (connections.length) await callCanvas("connectNodes", { connections });

  importingText.value = "正在整理画布…";
  await callCanvas("arrangeCanvas", {});
  await callCanvas("fitCanvas", {});
}
</script>

<style lang="scss" scoped>
.storyboardImport {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .stepBar {
    --el-process-icon-color: var(--el-color-primary);
    padding: 0 12px;
  }

  .stepContent {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 380px;
  }

  .templateRow,
  .parseRow,
  .importOptions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .fieldLabel {
    flex-shrink: 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }

  .rowSpacer {
    flex: 1;
  }

  .templateSelect {
    flex: 1;
    min-width: 220px;
  }

  .modelSelect {
    width: 240px;
  }

  .durationInput {
    width: 72px;
  }

  .resolutionSelect {
    width: 100px;
  }

  .descriptionAlert {
    --el-alert-padding: 8px 12px;
  }

  .uploadTrigger {
    display: inline-flex;
  }

  .scriptUpload {
    width: 100%;

    :deep(.el-upload-dragger) {
      padding: 16px 0;
    }
  }

  .uploadHint {
    .uploadMain {
      margin: 0;
      font-size: 14px;
      color: var(--el-text-color-regular);

      em {
        color: var(--el-color-primary);
        font-style: normal;
      }
    }

    .uploadSub {
      margin: 4px 0 0;
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }
  }

  .parseRow {
    justify-content: flex-start;
  }

  .parseSummary {
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }

  .resultTabs {
    :deep(.el-table) {
      --el-table-header-bg-color: var(--el-fill-color-light);
    }
  }

  .tableFooter {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
  }

  .addRowButton {
    margin-top: 8px;
  }

  .summaryAlert {
    --el-alert-padding: 8px 12px;
  }

  .importProgress {
    color: var(--el-color-primary);
    font-size: 13px;
  }
}
</style>
