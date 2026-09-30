# 设计方案：媒体供应商自定义配置界面（config.html + 配置链路改造）

> 依据：`.omc/specs/deep-interview-provider-config-ui.md`（访谈 8 轮，模糊度 18%）
> 本方案只做设计，不写代码。

## 一、目标与范围

媒体供应商插件可自带 HTML 配置界面：设置 → 模型 → 媒体模型 → 编辑供应商时按三层降级渲染；保存统一由宿主落库；执行链路不动；zip 分发全链路与 tdd-dev 开发链路同步升级。

**不在范围**：亮色主题完整适配（CSS 变量预留）、内置供应商迁移 html、插件自管保存、无头浏览器验证、节点/工具类插件的界面能力。

## 二、总体架构

```
┌─ 设置对话框（web）─────────────────────────────────────────────┐
│ 编辑供应商（editProviderDialog.vue）                            │
│ ┌─ 配置区（三层降级）────────────────────────────────────┐     │
│ │ ① 有 config.html → iframe srcdoc + sandbox             │     │
│ │    └ 插件 HTML ←postMessage桥→ configHtmlHost.vue      │     │
│ │      SDK: getConfig / setConfig / validate / ready     │     │
│ │ ② 仅有 rules    → <form-create :rule>（修复现有缺口）    │     │
│ │ ③ 都没有        → apiKey 单密码框（现状不变）            │     │
│ └────────────────────────────────────────────────────────┘     │
│ 模型配置列表（现有，不动）                                       │
│ 底部：取消 / 保存（宿主统管）                                    │
└──────┬─────────────────────────────────────────────────────────┘
       │ 保存: ①收集配置(iframe缓存/formData/apiKey)
       │      ②POST /api/providers/media/validateConfig (可选钩子)
       │      ③通过 → saveSettings → settings.mediaProviderConfigs.<id>（整对象）
       │      ④继续现有 /api/providers/media/save（models）
       ▼
  settings.json（唯一存储源）
       ▲
       ├── tdd provider config <id> --set k=v（CLI 写，同一处）
       └── generateMedia 执行时全量注入 context.config（现有链路，不动）
```

## 三、核心决策（访谈已锁定）

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 界面运行形态 | iframe 沙箱（`sandbox="allow-scripts"`，无 allow-same-origin）+ postMessage 桥 |
| 2 | 文件形态 | 独立 `config.html` 伴生文件，本地平铺 `data/providers/<id>.ts` + `<id>.html` |
| 3 | 分发 | zip 压缩包（一期全做：远程安装/市场/首启/tudodo-center） |
| 4 | 渲染降级 | config.html → rules 表单 → apiKey 单框；内置供应商不补 html |
| 5 | 保存数据流 | 宿主管数据写 `mediaProviderConfigs`；插件可选 `validateConfig` 纯函数钩子 |
| 6 | 保存交互 | 宿主统管（对话框底部统一按钮），界面只编辑上报 |
| 7 | tdd-dev 调通 | inspect 静态校验 + 宿主人工确认；不引入无头浏览器 |

## 四、插件包格式规范

### zip 包
```
<providerId>.zip           ← 根级，小驼峰，≤ 2MB
├── <providerId>.ts        ← 必须恰好一个，供应商源码（现有规范不变）
└── config.html            ← 可选，根级，≤ 512KB，自包含（内联 CSS/JS）
```
- 本地安装态：`data/providers/<id>.ts` + `data/providers/<id>.html`（平铺，关联靠同名约定；`directory()` 逻辑不变）
- `revision` 仍只哈希 .ts 源码（html 无冲突协商需求）；删除供应商连带删 `<id>.html`
- 文档强烈建议内联资源；外链 http(s) 允许但不推荐（离线不可用、隐私），inspect 对外链发警告

### validateConfig 钩子（ProviderDefinition 新增可选字段）
```ts
validateConfig?: (config: Record<string, unknown>) =>
  { ok: true } | { ok: false; errors: string[] | Record<string, string> }
  | Promise<同左>
```
- 纯函数语义：入参配置 → 校验结果；可用 `context.tool.fetch` 联网（从服务端发出，无 CORS），适合"测试连接"
- 同一份钩子两处复用：界面内"测试连接"按钮（SDK validate）+ 宿主保存时自动校验

## 五、桥接 SDK 契约（宿主注入，插件作者零成本）

宿主拿到 config.html 后：头部注入 `<style>`（主题 CSS 变量）与 `<script>`（SDK），以 `srcdoc` 载入 iframe。作者只需在 HTML 里调用 `window.toonflow`。

### API
```js
toonflow.ready()                                // 界面初始化完成（握手，10s 超时判定失败）
toonflow.getConfig() → Promise<object>          // 当前已保存配置（init 时注入，getConfig 再取）
toonflow.setConfig(config)                      // 上报编辑态；宿主缓存 latestConfig，保存时取用
toonflow.validate(config?) → Promise<Result>    // 调服务端 validateConfig（缺省用 latestConfig）
toonflow.theme                                  // { mode: "dark" }
```

### 消息协议（postMessage，双向）
| 方向 | type | payload |
|------|------|---------|
| 宿主→iframe | `toonflow:init` | `{ config, theme }` |
| iframe→宿主 | `toonflow:ready` | — |
| iframe→宿主 | `toonflow:change` | `{ config }`（setConfig 触发） |
| iframe→宿主 | `toonflow:validate` | `{ id, config }`（id 关联回执） |
| 宿主→iframe | `toonflow:validateResult` | `{ id, result }` |

- 宿主侧校验 `event.source === iframe.contentWindow`，忽略未知 type
- 保存取值兜底链：`latestConfig`（有过 setConfig）→ 初始 config（未编辑）→ 空对象

### 主题 CSS 变量（注入 `<style>`，值取 element-plus 暗色变量）
```css
:root { --tf-bg, --tf-bg-soft, --tf-fg, --tf-muted, --tf-primary,
        --tf-border, --tf-danger, --tf-radius, --tf-font }
```
providerSpec.md 附"起步样式模板"（引用上述变量的输入框/按钮/卡片基础样式），作者复制即得与平台协调的暗色 UI。

## 六、服务端改动（apps/server）

| 文件 | 改动 |
|------|------|
| `utils/media/provider.ts` | ① `parseProvider` 的 `literal()` 扩展支持 `rules` 数组字面量（解析失败单独降级为 `[]`，不拖垮整个供应商）；② `metadata()` 增加 `hasConfigHtml`（lstat `<id>.html`）与 `rules` 返回 → list 接口自动带出；③ `addMediaProvider(source, configHtml?)` 写伴生文件；④ `deleteMediaProvider` 连带删 `<id>.html`；⑤ 新增 `validateMediaProviderConfig(id, config)`：临时 vm 加载插件（复用 `loadMediaProviderSource`），无钩子直接 `{ok:true}`，**vm 加载失败不阻塞保存**（返回 ok + warning，源码 bug 不劫持配置） |
| `routes/providers/media/` 新增 | `configHtml/get.ts`（`GET ?id=` 返回 html 内容，路径校验同 readProvider）；`validateConfig/post.ts`（`POST {id, config}`，5s 超时）；改动后 `bun run routes` 重新生成 `router.ts` |
| `routes/providers/media/add.ts` | body 增加可选 `configHtml`（≤512KB） |
| `utils/plugins/install.ts` | `installRemotePlugin` 的 provider pattern 增加 `.zip`；解包复用 agent zip 的既有解压路径；校验包内恰好一个 .ts + 可选根级 config.html，转调 `addMediaProvider` |
| `utils/plugins/initialize.ts` + `app.ts` | `autoInstallProviders` 支持伴生 html 种子同步（`packages/providers/src/media/<id>.html` → `data/providers/<id>.html`，仍只补首次安装） |
| `packages/providers/types.d.ts` | `ProviderDefinition` 增加可选 `validateConfig` |

## 七、前端改动（apps/web）

| 文件 | 改动 |
|------|------|
| `panels/mediaModel/editProviderDialog.vue` | 配置区改为三分支降级（新子组件承载）；保存流程改为：收集配置 → `POST validateConfig`（失败且 errors 非空则中止回显）→ `saveSettings` 写 `mediaProviderConfigs.<id>` **整对象**（不再只写 apiKey）→ 继续 models 保存（现有逻辑不变） |
| 新组件 `panels/mediaModel/configHtmlHost.vue` | iframe 宿主：拉取 configHtml → srcdoc 注入 → postMessage 桥 → latestConfig 缓存 → 加载/错误态 → **失败降级**（错误卡 + "使用基础配置表单"按钮，回落 rules/apiKey 层，任何情况可配） |
| rules 层 | 复用 `addCustomProviderDialog.vue` 的 `<form-create :rule>` 模式（list 已返回 rules 后直接可用）；rules 里的 password 字段照常渲染 |
| 兜底层 | 现有 apiKey 密码框原样保留为第三分支 |
| `panels/pluginMarket/index.vue` | 无必改（zip 安装接口层打通即可）；可选：展示"带配置界面"标记 |

### UI/UX 细节
- iframe 容器：`border: 1px solid var(--el-border-color); border-radius: 8px; min-height: 200px; max-height: 40dvh` 内部滚动，视觉与 el-card 协调
- 加载态：区域骨架屏；握手超时（10s）→ 错误态 + 降级按钮
- 校验错误：字段级错误回传 iframe（作者自行展示）+ 宿主侧 el-alert 兜底展示 errors 文本
- 对话框宽度维持 `min(800px, …)`，配置区位于 readme 与"模型配置"之间
- 密钥字段展示：iframe 由作者自理（文档模板用 password input）；rules 层用 form-create password

## 八、tdd-dev 链路改动

| 文件 | 改动 |
|------|------|
| `packages/skills/tdd-dev/references/providerSpec.md` | 新章：config.html 编写规范（结构/自包含/大小）、SDK API 全文、起步样式模板、validateConfig 钩子规范、完整最小示例 |
| `packages/skills/tdd-dev/SKILL.md` | 环节 2"开发"注明可选产出 config.html；环节 3"校验"判定信号补 html 项；`provider import` 支持包/伴生文件说明；停点 1 确认卡模板补"配置界面"栏（有/无 + 字段清单） |
| `packages/cli/agent-harness/cli_tdd/toonflow/core/provider.py` | ① `import`：接受 `.zip`（解包后入 add 接口）或 `.ts`（同目录存在 `<id>.html` 自动随附）；② `inspect`：新增 html 静态检查——存在性/大小、HTML 基本语法、SDK 用法（`toonflow.getConfig/setConfig` 调用检测）、外链资源警告；③ `list`：显示 `hasConfigHtml`；退出码语义不变 |
| `workflow.md` / `errors.md` | 相应补 html 相关报错与自愈条目（如 html 缺失/超限/SDK 未调用的处理指引） |

调通闭环（已定）：`inspect 静态校验 → import → 引导用户在 设置→媒体模型→编辑 打开确认界面`（agent 可用浏览器自动化截图核实，不作硬性要求）。

## 九、实施顺序（同一期内完成，依赖排序）

1. **基础打通**：服务端 rules 静态解析返回 + list 扩展；前端 rules 表单回显（独立可交付：先修复现有缺口，grsai/apiMart 立即受益）
2. **HTML 界面核心**：configHtml/get + validateConfig/post 接口；configHtmlHost.vue + 桥接 SDK；editProviderDialog 三层降级与保存流
3. **插件包与本地链路**：add 接口 configHtml、delete 连带、types.d.ts validateConfig；tdd import/inspect 扩展；providerSpec.md/SKILL.md 文档
4. **zip 分发全链路**：installRemotePlugin zip、首启种子同步、tudodo-center manifest/sync 支持 zip 条目与 `--publish`/`--check`、市场验证

每步验证锚点：① grsai 编辑弹窗能改 baseUrl 并保存生效；② mock 供应商带示例 config.html 全流程（回显→编辑→校验拦截→保存→生成读到新值）；③ tdd-dev 七环节跑通带 html 插件；④ 市场安装 zip 插件成功。

## 十、风险与对策

| 风险 | 对策 |
|------|------|
| 插件源码有 bug 致 validateConfig vm 加载失败 | 校验接口容错：load 失败返回 ok+warning，不阻塞保存 |
| iframe 挂死/超时 | 10s 握手超时 → 错误态 + 降级到基础表单 |
| html 内嵌脚本恶意 | sandbox 无 allow-same-origin（够不到宿主 DOM/storage）、postMessage 校验 source；信任模型与插件本身一致（本地完整权限代码） |
| srcdoc 体积失控 | config.html ≤ 512KB，add/install 双端校验 |
| 旧插件回归 | 三层降级天然兼容（无 html 无 rules → apiKey 框不变）；验收标准 7 全链路回归 |
| zip 解包路径穿越/炸弹 | 复用 agent zip 安装的既有防护；条目数与大小上限校验 |
