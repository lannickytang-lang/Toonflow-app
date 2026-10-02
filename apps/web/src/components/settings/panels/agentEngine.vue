<template>
  <div class="agentEnginePanel">
    <section class="settingSection" aria-labelledby="agentEngineStatusTitle">
      <div class="settingHeader">
        <h3 id="agentEngineStatusTitle">引擎状态</h3>
        <el-button text :icon="IconRefresh" :loading="testing" @click="testCli">测试</el-button>
      </div>
      <el-alert v-if="testResult && !testResult.found" :title="testResult.error" type="error" :closable="false" showIcon />
      <el-alert v-else-if="testResult?.found" :title="`claude CLI 可用：${testResult.version}`" type="success" :closable="false" showIcon />
      <p class="description">
        平台对话支持选择本地安装的 Claude Code 作为推理引擎（通用助手，拥有终端与文件能力）。
        模型与 API Key / 地址请在「文本模型」设置的引擎供应商卡片中管理；此处为引擎全局选项。
      </p>
    </section>

    <section class="settingSection" aria-labelledby="agentEnginePathTitle">
      <h3 id="agentEnginePathTitle">CLI 路径（可选）</h3>
      <div class="pathSetting">
        <el-input v-model="claudePathDraft" placeholder="留空使用 PATH 中的 claude" :disabled="saving" clearable aria-label="claude CLI 路径" />
        <el-button size="small" :loading="saving" :disabled="claudePathDraft === claudeSettings.claudePath" @click="save">保存</el-button>
      </div>
      <p class="description">PATH 找不到时填写完整路径，如 C:\Users\你\.local\bin\claude.exe。</p>
    </section>

    <section class="settingSection" aria-labelledby="agentEngineTimeoutTitle">
      <div class="settingHeader">
        <h3 id="agentEngineTimeoutTitle">单轮超时（分钟）</h3>
        <div class="pathSetting">
          <el-input-number v-model="timeoutDraft" :min="1" :max="60" :precision="0" controlsPosition="right" size="small" :disabled="saving" aria-label="单轮超时分钟" />
          <el-button size="small" :loading="saving" :disabled="timeoutDraft === claudeSettings.timeoutMinutes" @click="save">保存</el-button>
        </div>
      </div>
      <p class="description">官方引擎一轮任务可能运行数分钟，默认 10 分钟；超时进程会被终止，已生成的部分内容保留。</p>
    </section>

    <section class="settingSection" aria-labelledby="agentEngineEnvTitle">
      <h3 id="agentEngineEnvTitle">额外环境变量（可选）</h3>
      <el-input v-model="extraEnvDraft" type="textarea" :rows="3" placeholder="每行一个，格式 KEY=VALUE" :disabled="saving" aria-label="额外环境变量" />
      <div class="pathSetting envActions">
        <el-button size="small" :loading="saving" :disabled="extraEnvDraft === extraEnvText" @click="save">保存</el-button>
      </div>
      <p class="description">透传给引擎进程，例如 ANTHROPIC_BASE_URL、CLAUDE_CODE_MAX_CONTEXT_TOKENS。平台默认注入 CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1（第三方模型直发 API）。</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";
import { IconRefresh } from "@tabler/icons-vue";
import { saveSettings, settings } from "@/stores/settings";

const headers = { "x-toonflow-workspace": "1" };

type EngineSettings = { claudePath?: string; timeoutMinutes?: number; extraEnv?: string[] };

const claudeSettings = computed<EngineSettings>(() => {
  const raw = settings.value.agentEngine;
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    claudePath: typeof value.claudePath === "string" ? value.claudePath : "",
    timeoutMinutes: typeof value.timeoutMinutes === "number" && value.timeoutMinutes >= 1 ? value.timeoutMinutes : 10,
    extraEnv: Array.isArray(value.extraEnv) ? value.extraEnv.filter((item): item is string => typeof item === "string") : [],
  };
});

const claudePathDraft = ref(claudeSettings.value.claudePath ?? "");
const timeoutDraft = ref(claudeSettings.value.timeoutMinutes ?? 10);
const extraEnvDraft = ref((claudeSettings.value.extraEnv ?? []).join("\n"));
const extraEnvText = computed(() => (claudeSettings.value.extraEnv ?? []).join("\n"));
const saving = ref(false);
const testing = ref(false);
const testResult = ref<{ found: boolean; version?: string; error?: string } | undefined>();

async function save() {
  saving.value = true;
  try {
    await saveSettings(current => ({
      ...current,
      agentEngine: {
        claudePath: claudePathDraft.value.trim(),
        timeoutMinutes: timeoutDraft.value,
        extraEnv: extraEnvDraft.value.split("\n").map(line => line.trim()).filter(Boolean),
      },
    }));
    ElMessage.success("已保存");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "保存失败");
  } finally {
    saving.value = false;
  }
}

async function testCli() {
  testing.value = true;
  try {
    const { data } = await axios.get<{ code: number; data: { found: boolean; version?: string; error?: string }; message?: string }>("/api/agentEngine/status", { headers });
    testResult.value = data.code === 200 ? data.data : { found: false, error: data.message || "探测失败" };
  } catch (error) {
    testResult.value = { found: false, error: axios.isAxiosError(error) ? error.response?.data?.message || error.message : "探测失败" };
  } finally {
    testing.value = false;
  }
}
</script>

<style lang="scss">
.agentEnginePanel {
  .pathSetting {
    display: flex;
    gap: 8px;
    align-items: center;

    .el-input,
    .el-input-number {
      flex: 1;
    }
  }

  .envActions {
    margin-top: 8px;
    justify-content: flex-end;
  }

  .description {
    margin-top: 6px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.6;
  }
}
</style>
