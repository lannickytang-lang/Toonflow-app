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
    title: "API 地址（留空使用 CLI 自身配置）",
    value: "",
    props: { placeholder: "https://api.anthropic.com" },
  },
];

export default {
  id: "claude-code" as const,
  label: "Claude Code（本机引擎）",
  version: "1.0.0",
  kind: "engine" as const,
  engine: "claude-code" as const,
  readme: "## Claude Code（本机引擎）\n\n使用本机安装的 Claude Code CLI 推理，拥有完整官方能力（子代理、技能、上下文压缩）。\n\n- API Key 与地址**留空**时使用 CLI 自身登录（订阅或已配置的第三方端点均可）。\n- 填写后平台会在对话时注入，覆盖 CLI 本机配置。\n- 模型列表请填写本机端点实际提供的模型 ID，会以 `--model` 透传给 CLI；不选则用 CLI 自身默认模型。第三方模型名带 `[1m]` 后缀可声明 1M 上下文窗口。",
  rules,
  // 引擎的实际模型取决于本机接入的端点（如 DeepSeek），不放内置占位名；对话框预填本机 ANTHROPIC_MODEL。
  models: [],
} satisfies ProviderDefinition<typeof rules>;
