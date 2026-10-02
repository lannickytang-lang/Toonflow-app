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
    title: "Responses API 地址（留空跟随 CLI，只有密钥时使用官方端点）",
    value: "",
    props: { placeholder: "https://api.openai.com/v1" },
  },
];

export default {
  id: "codex" as const,
  label: "Codex（本机引擎）",
  version: "1.0.0",
  kind: "engine" as const,
  engine: "codex" as const,
  readme: "## Codex（本机引擎）\n\n通过本机 Codex exec 推理，支持原生会话续接、图片和平台 MCP 工具。\n\n- 需要安装 Codex CLI，并完成登录或填写 API Key。\n- 自定义地址必须支持 Responses 协议；地址与密钥仅保存到 Toonflow，不修改本机配置。\n- CLI 默认模型不覆盖本机模型；指定模型逐轮传递。\n- 平台说明仅在新原生会话首轮提供，回复按 CLI 实际段落粒度显示。\n- 思考强度按模型支持的档位选择，默认沿用 CLI 配置；显式选择只覆盖当前回合。",
  rules,
  // 引擎的实际模型取决于本机 CLI 登录的账号，不放内置占位名；接入后按实际情况填写。
  models: [],
} satisfies ProviderDefinition<typeof rules>;
