import { defineStore } from "pinia";
import { ref } from "vue";
import axios from "axios";

export type Project = {
  directory: string;
  name: string;
  lastOpenedAt: number;
};

export const useWorkspaceStore = defineStore("workspace", () => {
  const project = ref<Project | null>(null);
  const projectList = ref<Project[]>([]);
  const pendingAgentMessage = ref<{ directory: string; prompt: string; model: string; reasoningEffort: string } | null>(null);
  // 用户移除过的磁盘项目（归一化路径）：syncProjectsFromDisk 不再自动补回，移除持久有效。
  const dismissedDiskProjects = ref<string[]>([]);

  async function openProject(path: string, previousDirectory = path, signal?: AbortSignal) {
    const { data } = await axios.get<{ code: number; data?: { directory: string }; message?: string }>("/api/workspaces/check", {
      params: { directory: path }, headers: { "x-toonflow-workspace": "1" }, signal,
    });
    signal?.throwIfAborted();
    if (data.code !== 200 || !data.data?.directory) throw new Error(data.message || "工作目录校验失败");
    const checkedDirectory = data.data.directory;
    pendingAgentMessage.value = null;
    const existing = projectList.value.find(project => project.directory === previousDirectory)
      ?? projectList.value.find(project => project.directory === checkedDirectory);
    project.value = { directory: checkedDirectory, name: existing?.name || checkedDirectory.split(/[\\/]/).filter(Boolean).at(-1) || checkedDirectory, lastOpenedAt: Date.now() };
    projectList.value = [
      project.value,
      ...projectList.value.filter(item => item.directory !== previousDirectory && item.directory !== checkedDirectory),
    ];
  }

  function renameProject(path: string, name: string) {
    const target = projectList.value.find(item => item.directory === path);
    if (!target || !name.trim()) return;
    target.name = name.trim();
    if (project.value?.directory === path) project.value = target;
  }

  function removeProject(path: string) {
    projectList.value = projectList.value.filter(item => item.directory !== path);
    if (project.value?.directory === path) project.value = null;
    dismissedDiskProjects.value = [...new Set([
      ...dismissedDiskProjects.value,
      path.split(/[\\/]/).filter(Boolean).join("/").toLowerCase(),
    ])];
  }

  // 磁盘项目合并：CLI/外部 agent 建的工作区（data/workspaces 下）不在浏览器收藏夹里，
  // 首页加载时扫盘补入，用户已有的命名/排序/手动添加的外部目录保持不变；
  // 用户移除过的目录（dismissedDiskProjects）不补回。
  async function syncProjectsFromDisk(signal?: AbortSignal) {
    const { data } = await axios.get<{ code: number; data?: { name: string; directory: string; modifiedAt: number }[]; message?: string }>(
      "/api/projects/list", { headers: { "x-toonflow-workspace": "1" }, signal });
    signal?.throwIfAborted();
    if (data.code !== 200 || !Array.isArray(data.data)) return;
    const normalize = (path: string) => path.split(/[\\/]/).filter(Boolean).join("/").toLowerCase();
    const known = new Set(projectList.value.map(item => normalize(item.directory)));
    const dismissed = new Set(dismissedDiskProjects.value);
    const merged = data.data
      .filter(item => !known.has(normalize(item.directory)) && !dismissed.has(normalize(item.directory)))
      .map(item => ({ directory: item.directory, name: item.name, lastOpenedAt: item.modifiedAt || 0 }));
    if (merged.length) projectList.value = [...projectList.value, ...merged];
  }

  return { project, projectList, pendingAgentMessage, dismissedDiskProjects, openProject, renameProject, removeProject, syncProjectsFromDisk };
}, {
  persist: {
    key: "toonflow.projectList",
    pick: ["project", "projectList", "dismissedDiskProjects"],
  },
});
