# Deep Interview Spec: 即梦媒体供应商（浏览器自动化，画布+普通双模式）

## Metadata
- Interview ID: di-jimeng-provider-20261011
- Rounds: 6（含 Round 0 拓扑门）
- Final Ambiguity Score: 15.4%（阈值 20%）
- Type: brownfield
- Generated: 2026-10-11
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.86 | 0.35 | 0.301 |
| Constraint Clarity | 0.78 | 0.25 | 0.195 |
| Success Criteria | 0.92 | 0.25 | 0.230 |
| Context Clarity | 0.80 | 0.15 | 0.120 |
| **Total Clarity** | | | **0.846** |
| **Ambiguity** | | | **15.4%** |

## Topology
| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| 调研补全 | active | 即梦两模式生图/生视频端点、请求体、轮询接口的抓包确认 + CDP 原型脚本验证技术路线 | 已覆盖：CDP 原型脚本连用户默认 Chrome（已登录即梦）抓包；jimeng2api 逆向文档为起点（视频链路函数级证据已备，生图端点与图片模型清单为调研缺口） |
| 浏览器会话基础设施 | active | Bun.spawn 启动可配置浏览器 + CDP 直连（原生 WebSocket）+ 常驻即梦页面页内 fetch 通道（a_bogus 自动注入） | 已覆盖：零依赖技术路线（Round 1 拍板）；会话生命周期（懒初始化/复用/重建）与节流在方案文档设计 |
| 即梦供应商实现 | active | `jimeng.ts`：全量 models 声明 + normal/canvas 双模式生成链路 + signal 取消，适配 provider 契约与 tdd-dev 流程 | 已覆盖：模式暴露方式（Round 5 拍板：配置 submitMode 开关）；视频实现不真测（Round 2）；dryrun 缺口的适配设计在方案文档 |
| 配置界面与真实验收 | active | rules 动态表单（浏览器路径/数据目录/模式/节流）+ seedream4.1 两模式生图真测验收 | 已覆盖：验收=两模式各 1 张 seedream4.1 流程完整正确（Round 6）；登录方式=复用已登录浏览器/独立 profile 手动登录一次 |
| 多浏览器多账号并行 | deferred | 后续支持多浏览器、多即梦账号并行 | 用户确认延后（Round 0）：仅架构预留（会话管理器按 browserPath+userDataDir+port 键化，配置层可扩展账号数组），本期不实现 |

## Goal
为 Toonflow 新增自定义媒体供应商 `jimeng.ts`：通过零依赖 CDP 直连驱动用户本机浏览器（已登录即梦），以**普通模式**（直调即梦 aigc 生成接口）与**画布模式**（画布 AI 对话接口）两条链路生成图片与视频，页内 fetch 借即梦自带 bdms SDK 自动注入 a_bogus 签名；模型清单全量声明（各自带比例/时长/参考图能力），配置无 API key，浏览器路径与用户数据目录可配置；canvas 模式的存在理由是更灵活的参考图协议（"图N是角色XX"一致性玩法）与不同的积分/额度策略。

## Constraints
- 技术路线锁定**零依赖 CDP 直连**：`Bun.spawn` 启动浏览器 exe（`--remote-debugging-port` + `--user-data-dir`），原生 WebSocket 走 CDP（`Runtime.evaluate` 页内 fetch）；不给宿主引入 playwright/puppeteer 依赖，provider 目标**零 import**（Bun/fetch/WebSocket 均为全局注入）
- provider 运行约束（`apps/server/src/utils/media/provider.ts`）：文件名 `jimeng.ts`（`^[a-z][a-zA-Z0-9]*\.ts$`）；export default 纯对象字面量；models 纯 JSON 字面量；≤2MB；禁相对导入；模块顶层 evaluate 限时 1s → 一切重初始化必须懒加载
- 页内 fetch 是唯一请求通道（a_bogus 由页面 SDK 注入，不自研签名）；tdd-dev dryrun 环节 mock 的是 `this.tool.fetch`，对本 provider 无效 → 需适配设计（方案文档定义 dryrun = 结构校验 + 请求计划回放）
- 调研协作方式：CDP 原型脚本连用户默认 Chrome（已登录即梦）抓包；后续可带调试端口连接该浏览器补充调研（注意日常 Chrome 默认不开调试端口，需重启参数或复制 profile，方案处理）
- 节流防风控：provider 内保留随机提交间隔（参考 jimeng2api 12-15s 量级，生图可保守调低），队列并发（默认 3）由宿主队列管理
- 费用红线（tdd-dev）：真测前 dryrun 必须全绿；真测消耗仅限验收所需（两模式各 1 张 seedream4.1 量级）
- 源码唯一源：packages/providers（如走收录）/ providerWork 暂存 → import 安装到 data/providers；不手改 data/

## Non-Goals
- 多浏览器/多即梦账号并行（延后，仅架构预留）
- 视频生成真测（本期实现 generateVideo 完整链路但只做 dryrun 级验证）
- 自研 a_bogus/签名算法（永远交给页面 SDK）
- API key 凭证体系（本 provider 无鉴权字段）
- 收录进 tudodo-center 分发中心（本期为本地自定义供应商，除非用户后续要求）
- 油猴脚本/浏览器扩展形态组件

## Acceptance Criteria
- [ ] CDP 原型脚本可拉起用户配置的浏览器、打开即梦页面、经 `Runtime.evaluate` 页内 fetch 发请求成功（技术路线验证）
- [ ] 抓包样本解析出：normal 模式生图端点+请求体+轮询接口；canvas 模式会话端点+提示词协议；即梦生图/生视频**全量模型清单**（含各自比例/分辨率/时长选项）
- [ ] `jimeng.ts` 通过 `tdd provider inspect`（AST 全约束：models 字面量、文件名、无相对导入、零 import）
- [ ] dryrun 适配：`this.config` 带 dryrun 标志时 generateImage 返回组装后的请求计划（不连浏览器），tdd provider dryrun 可跑出请求计划并校验
- [ ] 配置表单（rules）含：browserPath（默认自动探测）、userDataDir（默认独立目录）、submitMode（normal/canvas）、提交节流参数；validateConfig 校验 browserPath 合法性
- [ ] **真测验收**：submitMode=normal 下 seedream4.1 生成 1 张图，`MediaAsset` 返回并在画布节点落盘
- [ ] **真测验收**：submitMode=canvas 下 seedream4.1 生成 1 张图，同上
- [ ] generateVideo 代码路径完整（提交+轮询+下载骨架与生图共享），dryrun 级验证通过，不真测
- [ ] signal 取消：dryrun/超时路径下中止并不残留浏览器进程（会话复用，不反复拉起）
- [ ] 登录态失效时返回可诊断错误（提示重新登录而非静默失败）

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "两种模式都做"可能只是照搬 jimeng2api | Contrarian（Round 4）：normal 已满足结构化生图时 canvas 的存在理由是什么 | canvas 有独立价值：图N 参考协议更灵活（角色一致性玩法）+ 积分/额度策略不同；两模式都必交付 |
| "参考的插件应该已经有模型清单" | Round 5 后事实核查 | jimeng2api 是纯视频插件（UI 只有 Seedance 视频模型）；图片模型清单是调研缺口，抓包时从即梦页面获取 |
| 浏览器自动化需要 playwright | Round 1 选型对比 | 零依赖 CDP 直连（Bun.spawn + 原生 WebSocket），零 import 避开依赖解析限制 |
| 视频要不要真测 | Round 2 范围界定 | 实现完整但不真测（消耗高），验收只看生图 |
| 抓包需要用户重度配合 | Round 3 协作方式 | 用户默认 Chrome 已登录即梦；CDP 原型脚本连接抓包，后续可自行连接补充 |
| 验收要多张图验证 | Simplifier（Round 6） | 验收=两模式各 1 张流程完整正确；代码交付完整（全量清单） |

## Technical Context
（brownfield 代码库事实，来自 explore 代理）
- **供应商契约**：`packages/providers/types.d.ts` — `generateImage/generateVideo(this: ProviderContext, request) => Promise<MediaAsset[]>`，黑盒自闭环（提交+轮询+下载在方法内完成），取消靠 `this.signal`，不能返回任务 ID；网络出口约定 `this.tool.fetch`（本 provider 用页内 fetch 替代，是经过确认的偏离点）
- **VM 运行时**：`apps/server/src/utils/media/provider.ts` — Bun Transpiler + `node:vm` SourceTextModule；注入 `Buffer/URL/Blob/AbortController/Bun/process/require`；与宿主同权限；顶层 evaluate 1s 限时
- **模型声明**：`ProviderModel`：`type: image|video` + `mode`（imageReference/videoReference 数量）+ imageRatios/durationResolutionMap 等能力字段，按模型粒度
- **配置**：rules（form-create 动态表单）存 `settings.mediaProviderConfigs.jimeng`；无鉴权则 rules 不含 apiKey
- **队列**：`utils/canvas/queue.ts` 并发默认 3（可 1-20），取消=AbortController，重试 3 次
- **tdd-dev 七环节**：调研→开发→inspect 循环→dryrun→import→config→真测（三停点+费用红线）；providerWork/ 是本机暂存惯例
- **jimeng2api 逆向**（`docs/插件/jimeng2apiTechnicalReview.md`）：cached page fetch 借 bdms 注 a_bogus；normal=`aigc_draft/generate`+`get_history_by_ids` 轮询；canvas=create_canvas_project+submit_canvas_conversation（SSE）+"图N是XX"协议；ImageX 上传 AWS SigV4；这些是 provider 实现的蓝图

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| JimengProvider | core domain | id=jimeng, models[], rules[], generateImage, generateVideo | 拥有 BrowserSession；按 SubmitMode 分链路 |
| BrowserSession | supporting | browserPath, userDataDir, debugPort, ws 连接, 常驻页面 | JimengProvider 持有单例；按路径+目录+端口键化（多账号余量） |
| CachedPage | supporting | 即梦页面 target, sessionId, ready 状态 | BrowserSession 内常驻；承载页内 fetch |
| SubmitMode | core domain (enum) | normal / canvas | provider 配置项，决定生成链路 |
| BrowserConfig | supporting | browserPath, userDataDir, submitMode, 节流参数 | 存于 settings.mediaProviderConfigs.jimeng |
| CdpPrototypeScript | supporting | spawn+WS+Network 域抓包 | 调研补全组件的交付物；技术路线验证 |
| ImageRequest | core domain (既有契约) | prompt, 参考图, 比例, 分辨率 | 由画布节点传入 generateImage |
| MediaAsset | core domain (既有契约) | url/base64/binary, mediaType | generateImage 返回 |
| JimengAccount | supporting (deferred) | 登录态, userDataDir | 多账号并行时引入 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 8 | 8 | - | - | N/A |
| 2 | 8 | 0 | 0 | 8 | 100% |
| 3 | 9 | 1 (CdpPrototypeScript) | 0 | 8 | 89% |
| 4 | 9 | 0 | 0 | 9 | 100% |
| 5 | 9 | 0 | 0 | 9 | 100% |
| 6 | 9 | 0 | 0 | 9 | 100%（连续三轮收敛） |

## Interview Transcript
<details>
<summary>Full Q&A（6 轮）</summary>

### Round 0（拓扑门）
**Q:** 5 组件划分是否成立？多账号并行是否延后？
**A:** 正确，多账号并行延后（推荐）——仅架构预留。

### Round 1
**Q:** 浏览器自动化技术路线：零依赖 CDP 直连 / server 装 playwright / 混合？
**A:** 零依赖 CDP 直连（推荐）。
**Ambiguity:** 51%（Goal 0.42, Constraints 0.50, Criteria 0.45, Context 0.72）

### Round 2
**Q:** 视频生成本期交付边界？
**A:** 实现但不真测（推荐）——验收仍只看生图。
**Ambiguity:** 42%（Goal 0.60, Constraints 0.50, Criteria 0.55, Context 0.72）

### Round 3
**Q:** 生图端点抓包调研怎么协作？
**A:** （自由回答）你可以使用我的默认谷歌浏览器，已经登录好了即梦。建议先用方案1 CDP脚本，后续可以自行连接默认浏览器补充。
**Ambiguity:** 35%（Goal 0.65, Constraints 0.70, Criteria 0.55, Context 0.75）

### Round 4（Contrarian 模式）
**Q:** canvas 模式在 Toonflow 里的存在理由是什么？（挑战"照搬 jimeng2api"假设）
**A:** 参考图协议更灵活 + 积分/额度策略不同（多选）。
**Ambiguity:** 26%（Goal 0.75, Constraints 0.72, Criteria 0.75, Context 0.75）

### Round 5
**Q:** 两种模式怎么暴露给用户：两个模型条目 / 配置开关 / 自动路由？
**A:** （自由回答）有个配置选择是画布还是普通模式，然后生图/生视频有哪些模型、比例、时长等可选性都要支持。参考的那个插件应该已经有了吧。
**Ambiguity:** 21%（Goal 0.82, Constraints 0.75, Criteria 0.78, Context 0.78；附事实纠偏：jimeng2api 无图片模型清单，需抓包获取）

### Round 6（Simplifier 模式）
**Q:** 验收最简充分形式 + models 清单边界？
**A:** （自由回答）代码要调研清楚，写完整。验收只需要画布和普通模式只是4.1生图片流程完整正确即可。
**Ambiguity:** 15.4% ✅ 过线
</details>
