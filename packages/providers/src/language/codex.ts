const rules = [
  {
    type: "input",
    field: "apiKey" as const,
    title: "API Key（留空使用 CLI 自身登录）",
    value: "",
    props: { type: "password", showPassword: true, autocomplete: "off" },
  },
  {
    type: "input",
    field: "apiUrl" as const,
    title: "API 地址（留空使用官方端点）",
    value: "",
    props: { placeholder: "https://api.openai.com" },
  },
];

export default {
  id: "codex" as const,
  label: "Codex（本机引擎）",
  version: "1.0.0",
  kind: "engine" as const,
  engine: "codex" as const,
  readme: "## Codex（本机引擎）\n\n使用本机安装的 OpenAI Codex CLI 推理。\n\n- 需要本机已安装 Codex CLI 并完成登录（或填写 API Key）。\n- 模型 ID 与推理档位经 `-c` 参数透传给 CLI。\n- **当前版本尚未接入，将在后续更新中可用。**",
  rules,
  // 引擎的实际模型取决于本机 CLI 登录的账号，不放内置占位名；接入后按实际情况填写。
  models: [],
} satisfies ProviderDefinition<typeof rules>;
