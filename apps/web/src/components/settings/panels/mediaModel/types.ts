export type MediaProviderModel = {
  id: string;
  label: string;
  type: "text" | "image" | "video" | "audio";
  [key: string]: unknown;
};

export type MediaProvider = {
  fileName: string;
  id: string;
  label: string;
  version?: string;
  readme?: string;
  modelsUrl?: string;
  models: MediaProviderModel[];
  revision: string;
  /** form-create 声明式表单规则，服务端静态解析，解析失败或缺省为 undefined。 */
  rules?: Record<string, unknown>[];
  /** 供应商带有 config.html 配置界面（iframe 渲染优先）。 */
  hasConfigHtml?: boolean;
  loadError?: string;
};
