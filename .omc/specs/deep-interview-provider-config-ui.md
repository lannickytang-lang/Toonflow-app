# Deep Interview Spec: 媒体供应商自定义配置界面（插件自带 HTML + 配置链路改造）

## Metadata
- Interview ID: di-media-provider-custom-config-ui-20260930
- Rounds: 8（Round 0 拓扑 + Round 1-7）
- Final Ambiguity Score: 18%
- Type: brownfield
- Generated: 2026-09-30
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.88 | 0.35 | 0.308 |
| Constraint Clarity | 0.80 | 0.25 | 0.200 |
| Success Criteria Clarity | 0.72 | 0.25 | 0.180 |
| Context Clarity | 0.85 | 0.15 | 0.128 |
| **Total Clarity** | | | **0.816** |
| **Ambiguity** | | | **18%** |

## Topology
| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| ①插件侧配置界面规范 | active | 供应商作者如何编写/携带 config.html，桥接 SDK 读写配置的 API 契约 | 覆盖验收标准 1/5/9 |
| ②平台侧渲染回显 | active | 设置→媒体模型→编辑供应商时按三层降级渲染，UI 美观与暗色主题适配 | 覆盖验收标准 1/2/3/8 |
| ③配置保存与校验链路 | active | 保存数据流（宿主管数据 + 可选 validateConfig）、错误回显 | 覆盖验收标准 4 |
| ④执行时配置注入 | active | 任务执行时插件读到最新配置（现有链路已通，保持不动） | 覆盖验收标准 1 尾段 |
| ⑤tdd-dev 开发链路适配 | active | providerSpec 规范、inspect 校验、tdd CLI import/config 与新界面的同步适配 | 覆盖验收标准 1/5/6/9 |

## Goal
让媒体供应商插件能自带 HTML 配置界面（config.html 伴生文件）：平台在设置→媒体模型→编辑供应商时按 **config.html（iframe）→ rules（form-create 表单）→ apiKey 单框** 三层降级回显渲染；保存统一由宿主落 `settings.mediaProviderConfigs`（插件可选声明 `validateConfig` 纯函数钩子做校验）；执行链路保持现有"每次生成注入完整配置"不变；同步升级 zip 包分发全链路（远程安装/插件市场/首启初始化/tudodo-center）与 tdd-dev 开发链路（规范/校验/引导词）。

## Constraints
- 界面运行形态：iframe 沙箱 + 桥接 SDK（postMessage 协议），插件界面拥有完全前端自由度
- 文件形态：独立 `config.html` 伴生文件（`data/providers/` 与 `<id>.ts` 关联），分发统一 zip 压缩包
- 三层降级规则：有 config.html 用 iframe → 仅有 rules 用 form-create 表单回显（顺手修复现有回显缺口）→ 都没有维持 apiKey 单框；内置供应商不补 html
- 保存数据流路线 A：宿主管数据（写 `settings.mediaProviderConfigs.<id>`，单一存储源）；插件非常驻进程，不提供保存方法；`validateConfig(config) → {ok, errors}` 为可选纯函数钩子，临时加载执行
- 保存交互宿主统管：编辑对话框底部统一保存/取消按钮，iframe 界面只负责编辑与变更上报；"测试连接"类即时交互由界面自理
- tdd-dev 调通深度：`tdd provider inspect` 静态校验（config.html 存在性、HTML 语法、桥接 SDK 用法）+ 引导用户宿主人工确认；不引入无头浏览器
- zip 分发全链路一期完成：`installRemotePlugin`、插件市场安装、首启初始化同步伴生文件、tudodo-center manifest 与 sync 脚本
- 主题适配走 CSS 变量方案（当前应用为暗色）；UI 需与现有对话框风格协调（留白、圆角、加载/错误态兜底）
- 遵循仓库 AGENTS.md 全部代码规范（小驼峰命名、server 单接口单文件、路由生成 `bun run routes`、插件源码唯一在 packages/ 修改等）

## Non-Goals
- 不做亮色主题完整适配（CSS 变量方案预留扩展）
- 不迁移内置供应商（tfRouter/grsai/apiMart/meta）到 html 界面
- 不做插件自管保存模式（界面内保存按钮方案已否决）
- 不引入无头浏览器（playwright/puppeteer）做界面自动化验证
- 不改执行链路的配置注入方式（generateMedia 已每次全量注入，保持）
- 不扩展节点/工具类插件的自定义界面能力（仅媒体供应商）
- 不实现插件的常驻服务/后台进程

## Acceptance Criteria
- [ ] 1. tdd-dev 全流程：生成带 config.html 的插件 → `tdd provider import`（多文件/包）装入 → 设置→媒体模型→编辑该供应商 → iframe 回显当前配置 → 修改保存 → `settings.mediaProviderConfigs` 更新 → 生成任务读到新配置
- [ ] 2. 有 rules 无 html 的已装插件（如 grsai）：编辑对话框以 form-create 表单回显全部字段（apiKey/baseUrl 等），可编辑保存
- [ ] 3. 无 rules 无 html 插件：维持现有 apiKey 单框行为不变
- [ ] 4. validateConfig：声明钩子的插件保存失败时错误回显在界面内、不落库；未声明钩子直接落库
- [ ] 5. `tdd provider inspect` 扩展：校验 config.html 存在性/HTML 语法/桥接 SDK 用法，退出码语义保持（0/2/3/4/6）
- [ ] 6. zip 分发：远程安装 zip 包、插件市场安装带 html 插件、首启初始化同步伴生文件、tudodo-center manifest 支持 zip 条目且 `--publish`/`--check` 通过
- [ ] 7. 旧插件（仅 .ts 单文件）在安装/列表/编辑/执行/删除全链路行为不变
- [ ] 8. UI：iframe 区域与现有对话框风格协调（暗色、留白、圆角），加载态/加载失败有兜底展示
- [ ] 9. tdd-dev 技能文档同步：SKILL.md、providerSpec.md 增加 config.html 编写规范与桥接 SDK API 文档、七环节判定信号更新

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| 插件应提供保存配置的抽象方法 | 插件 .ts 非常驻进程（vm 按需加载）；插件自存会造成双源不一致、保存被源码 bug 劫持 | 宿主管数据 + 可选 validateConfig 纯函数校验钩子 |
| HTML 应内嵌 .ts 单文件保持单文件体系 | 分发形态权衡 | 独立 config.html 伴生文件 + zip 包分发（分发链路接受升级） |
| 所有新插件都要写 HTML 界面 | form-create 能力澄清：静态字段够用，动态行/按钮/布局做不到 | 三层降级共存，HTML 仅服务复杂场景 |
| zip 分发链路可延后 | Simplifier 挑战：核心价值是配置能力，市场分发是通道 | 一期全做（用户明确） |
| 保存按钮由插件界面自写 | 体验一致性与作者负担 | 宿主统管（对话框底部统一按钮） |
| 界面调通需自动化验证 | CLI 终端无浏览器；无头浏览器重依赖 | inspect 静态校验 + 宿主人工确认 |

## Technical Context
（brownfield 探索结论，全部为已核实事实）

**前端（apps/web）**
- 设置面板注册：`apps/web/src/components/settings/index.vue:57`（mediaModel 面板）
- 媒体模型页：`apps/web/src/components/settings/panels/mediaModel/index.vue`（getProviderApiKey/saveProviderApiKey 读写 `settings.mediaProviderConfigs.<id>.apiKey`）
- **改造主目标**：`editProviderDialog.vue:15-17` 硬编码单 apiKey 密码框 → 改为三层降级渲染
- 添加对话框：`addCustomProviderDialog.vue`（内置模式已用 `<form-create :rule>` 渲染 rules，可复用）
- settings store：`apps/web/src/stores/settings.ts`（模块级单例，非 Pinia；`PUT /api/settings/save`）
- iframe+sandbox 先例：`tfRechargeDialog.vue:41`；工具插件客户端组件先例：`packages/toolScaffold/src/client.ts`

**供应商插件体系（packages/providers）**
- `packages/providers/types.d.ts:167` `ProviderDefinition`（rules 为 form-create Rule[] 字面量）
- 现有供应商：src/media/ 下 tfRouter（apiKey）、grsai（apiKey+baseUrl）、apiMart（apiKey+isOverseas）、meta、mockProvider
- 源码唯一源在 `packages/providers/`，安装态 `data/providers/<id>.ts`，首启初始化 `apps/server/src/app.ts:11` autoInstallProviders + `utils/plugins/initialize.ts`（供应商只补首次安装）

**服务端（apps/server）**
- 加载执行：`apps/server/src/utils/media/provider.ts:274` `loadMediaProviderSource`（Bun.Transpiler + node:vm，非常驻）；`parseProvider:87` 只解析字面量元数据
- **缺口**：`metadata()` 不返回 rules；`list.ts` 列表无 rules/html 信息
- 路由组 `/api/providers/media/*`：list/add/save/delete/models（`apps/server/src/router.ts:192-197`）；debug 组 inspect/run 已能返回 rules（`utils/media/debug.ts`）
- 生成链路：`utils/media/generation.ts:143-148` 每次读 `mediaProviderConfigs.<id>` 全量注入 `context.config` —— **执行时读最新配置已通，不动**
- 远程安装：`utils/plugins/install.ts:392` `installRemotePlugin`（现仅单文件直链，需扩展 zip）

**tdd-dev 链路（packages/cli/agent-harness + packages/skills/tdd-dev）**
- 技能：`packages/skills/tdd-dev/SKILL.md`（v1.1.1，七环节：调研→开发→inspect→dryrun→import→config→test）
- 规范骨架：`packages/skills/tdd-dev/references/providerSpec.md`（需增 config.html 章节）
- CLI：`packages/cli/agent-harness/cli_tdd/toonflow/core/provider.py`（inspect/import/config 等，需扩展多文件/zip 与 html 校验）

**分发（tudodo-center，独立 git 仓库）**
- manifest.json providers 条目 `{name, version, file}`，`scripts/sync.py` 生成 dist 与 manifest，`--publish`/`--check`

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| 供应商插件（Provider） | core domain | id/label/version/rules/models/生成函数 | 拥有 0..1 个 config.html；读写 mediaProviderConfigs |
| config.html | core domain | HTML/内联 JS/桥接调用 | 伴生于供应商插件；经 iframe 渲染 |
| 桥接 SDK | supporting | getConfig/saveConfig(上报)/主题变量 | 宿主注入 iframe；服务 config.html |
| rules（form-create Rule[]） | supporting | type/field/title/value/props | 供应商插件的声明式降级界面 |
| mediaProviderConfigs | supporting | settings.json 中按 providerId 的自由 JSON | 被宿主写入；被执行链路/tdd config 读取 |
| 编辑供应商对话框 | supporting | 三层降级渲染/宿主统管保存 | 渲染 config.html 或 rules 表单 |
| validateConfig 钩子 | supporting | (config) → {ok, errors} 纯函数 | 可选声明于供应商插件；保存时临时加载执行 |
| 插件包（zip） | supporting | .ts + config.html（+未来资源） | 分发单位；install/import 的输入 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 7 | 7 | - | - | N/A |
| 2 | 8 | 1（validateConfig 概念） | 0 | 7 | 93% |
| 3-7 | 8 | 0 | 0 | 8 | 100%（连续 5 轮收敛） |

## Interview Transcript
<details>
<summary>Full Q&A（Round 0-7）</summary>

### Round 0（拓扑确认）
**Q:** 读成 4 组件（①插件界面规范②平台渲染回显③保存校验链路④执行时注入），对吗？
**A:** 4 个对，补充：新增的 tdd-dev 开发自定义模型逻辑也要处理 → 加入⑤tdd-dev 链路适配，锁定 5 组件。

### Round 1（①/Goal：界面运行形态）
**Q:** "HTML 界面"的运行形态：iframe 沙箱+桥接 / 宿主共享运行时组件 / 两者都支持 / 方案里定？
**A:** iframe 沙箱 + 桥接 API。
**Ambiguity:** 57%（Goal 0.50 / Constraints 0.30 / Criteria 0.30 / Context 0.70）

### Round 2（③/Goal：保存数据流向）
**Q:** 保存数据流：宿主管数据+插件可选校验 / 插件 saveConfig 主导 / 再分析？（事实：插件非常驻进程、settings 是单一存储源）
**A:** 先"再分析利弊"→ 展开分析后选"接受 A + validateConfig 校验钩子"，并要求思考 tdd-dev 写新插件时如何调通。
**Ambiguity:** 55%

### Round 3（①/Constraints：文件物理形态）
**Q:** HTML 内嵌 .ts 单文件 / 独立 .html 伴生文件 / 两种都支持？
**A:** 独立 .html 伴生文件，分发用压缩包（zip）。
**Ambiguity:** 46%

### Round 4（①/Constraints + Contrarian：与 rules 体系关系）
**Q:**（先补充介绍了 form-create 能力与"仅静态字面量、无动态行/按钮/布局"的限制）三层降级 / HTML 唯一标准 / 只要 rules 回显？
**A:** 三层降级（推荐方案）。
**Ambiguity:** 38%

### Round 5（⑤/Goal：tdd-dev 调通深度）
**Q:** 静态校验+宿主人工看 / 桥接自测协议 / 无头浏览器干跑？
**A:** 静态校验 + 宿主人工看。
**Ambiguity:** 34%

### Round 6（全局/Criteria + Simplifier：验收范围）
**Q:** zip 全链路一期做 / 本地先行 zip 二期 / 方案里定分期？
**A:** zip 全链路一期做。
**Ambiguity:** 23%

### Round 7（②/Goal：保存交互归属）
**Q:** 宿主统管（底部统一按钮）/ 插件自管 / 两种都支持？（主题适配注：CSS 变量方案）
**A:** 宿主统管。
**Ambiguity:** 18% ✅ 达标
</details>
