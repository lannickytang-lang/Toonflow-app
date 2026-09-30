# Deep Interview Spec: tdd-dev 技能（定制开发 agent 的画布扩展开发技能）

## Metadata
- Interview ID: tdd-dev-20260930
- Rounds: 7（含 Round 0 拓扑门）
- Final Ambiguity Score: 20%（PASSED，压线达标）
- Type: brownfield
- Generated: 2026-09-30
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.80 | 0.35 | 0.28 |
| Constraint Clarity | 0.80 | 0.25 | 0.20 |
| Success Criteria Clarity | 0.80 | 0.25 | 0.20 |
| Context Clarity | 0.80 | 0.15 | 0.12 |
| **Total Clarity** | | | **0.80** |
| **Ambiguity** | | | **0.20** |

## Topology
| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| tdd-dev 技能本体 | active | SKILL.md 结构、随 CLI 自动分发、与 tdd-auto 的边界 | 已覆盖：分发策略 R4、规范事实源 R5、验收方式 R7 |
| 供应商开发全流程引导 | active | 资料收集→开发→校验导入→配置→测试→投入使用六环节编排，小白用户+低智能 agent 兼容 | 已覆盖：执行通道 R1、验收线+费用红线 R3 |
| 扩展性预留 | active | 后续其他画布扩展开发类型的架构预留 | 已覆盖：最简形态 R6（目录约定即预留，清单未定不预设） |

## Goal
新建宿主技能 tdd-dev（面向"需要定制的开发 agent"）并配套扩展 tdd CLI 新增 provider 命令组，首期实现自定义媒体供应商（自定义模型）的**开发 → 校验导入 → 配置 → 真实测试 → 投入画布使用**全流程引导；全程兼容小白用户与低智能 agent（CLI 门面封装、访谈式资料收集、每步有可判定验收）；架构上仅以"references 按开发类型分目录 + SKILL.md 路由表可加行 + CLI 命令组横向扩展"作为扩展机制，不引入任何额外预留机制，为后续其他画布扩展开发类型（清单未定）做好准备。

## Constraints
- **执行通道**：所有供应商操作经扩展的 tdd CLI 命令组完成（agent 只碰 CLI，不裸调 HTTP/NDJSON 流）。
- **费用红线（最高优先级）**：真实测试发起前必须①准备就绪（校验通过、配置完成）②询问用户③用户显式确认；严禁静默发起真实调用、严禁乱扣费。inspect 静态校验与 modelsUrl 拉模型列表为零费用操作，可自由执行。
- **分发**：tdd-dev 随 CLI 自动安装（manifest 驱动，与 tdd-auto 同等待遇）；与 tdd-auto 靠 description 区分路由（auto=批量生产视频，dev=开发定制扩展）。
- **规范事实源**：tdd-dev 技能内自足新建完整供应商开发规范（对齐 parseProvider 硬约束与 types.d.ts 契约）；Web 端 providerPrompt.ts 本批不动，两份短期并存，方案中标注后续统一路径。
- **扩展机制**：零额外机制。新开发类型接入 = references/ 新目录 + SKILL.md 路由表加行 + CLI 命令组横向增加，不动公共结构。
- **技能编写规范**：遵循 tdd-auto 已验证范式（渐进式三层加载、SKILL.md 行数约束、scenarios 组织）；遵循仓库文件命名小驼峰等全部开发规范。
- **既有安全红线延续**：GitHub 仓库地址不得出现在任何公开分发物（技能/引导语/中心文档）中。

## Non-Goals
- 不修改 Web 端 providerPrompt.ts 与供应商 UI（后续另批统一）。
- 不预设具体未来开发类型（自定义节点/工具等不在本批）。
- 不做开发类型索引文件、注册机制等额外预留层。
- 不做 uninstall 等与本期无关的 CLI 功能。
- 不改 server 端供应商接口（现有 /api/providers/* 能力已够，仅 CLI 封装）。

## Acceptance Criteria
- [ ] `tdd provider` 命令组可用：inspect（零费用静态校验）、import、list、config（写 mediaProviderConfigs）、models（含 refresh）、test（封装 debug/run 流式为聚合输出）全部实测通过。
- [ ] test 命令内置费用闸门：默认要求显式确认（--yes 或交互确认），技能引导中闸门为显著红线条款。
- [ ] tdd-dev 技能三层门禁全绿：selfcheck 静态断言（技能结构/manifest 注册/命令契约）+ 命令级（provider 组 help 全树）+ 真实冒烟（mockProvider 零费用走完 开发→inspect→导入→配置→真测→清理 全流程）。
- [ ] 子代理冷启动验收：零上下文只给技能文件，低智能模拟 agent 独立走通 mockProvider 接入全流程。
- [ ] `tdd install` 在干净宿主自动装出 tdd-dev（manifest 驱动实测），tdd-auto 既有行为不受影响（selfcheck 全绿）。
- [ ] 中心发布链路完整：sync.py 收录、manifest 含 tdd-dev、CLI 打包副本同步。

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| tdd-dev 引导 agent 直调 HTTP 即可 | R1 Contrarian：NDJSON 流对低智能 agent 失败率高 | 扩展 tdd CLI provider 命令组，agent 只碰 CLI |
| 扩展类型需要预设计清单 | R2 | 方向已知清单未定，不预设 |
| 验收可仅静态校验（省费用） | R3 | 必须真实测试，但前置用户确认闸门，严禁乱扣费 |
| tdd-dev 应像 tdd-auto 一样见宿主就装 | R4 Contrarian：对创作者是污染？ | 仍随 CLI 自动装：小白不会主动装任何东西，靠 description 区分路由 |
| 两份供应商规范会双头维护 | R5 | 技能新建自足规范，Web 暂不动，标注后续统一路径 |
| 预留需要类型索引/注册机制 | R6 Simplifier：机制空转 | 目录约定即预留，零额外机制 |
| 验收做到 selfcheck 三层即可 | R7 | 三层 + 子代理冷启动（最贴近低智能诉求）|

## Technical Context（brownfield 关键事实）
- **供应商硬约束单一裁判**：`apps/server/src/utils/media/provider.ts::parseProvider`（≤2MB、export default 对象字面量、id/label/version/readme/models/modelsUrl 必须字面量[version 可引用顶层 const]、文件名=<id>.ts、id 小驼峰≤96）。
- **调试闭环已存在**：`POST /api/providers/debug/inspect`（零费用静态解析）、`POST /api/providers/debug/run`（NDJSON 流式真实调用，请求日志打码、32MB 预览限制、30 分钟超时）；接受未安装的 source + 临时 config → 支持"先测后装"。
- **管理接口**：`/api/providers/media/add|save|delete|list|models`；key 存 `settings.mediaProviderConfigs.<id>.apiKey`；生成链路按需即时加载（改文件即生效）。
- **零费用靶子**：`mockProvider`（rules=[]、读本地 mock 素材、含失败模型）可用于冒烟与冷启动验收。
- **分发红利**：CLI install 已 manifest 驱动——中心登记 tdd-dev 后任意版本 CLI 自动跟随安装，install.py 无需改动。
- **范式参照**：`packages/skills/tdd-auto/`（SKILL.md 意图路由 + references 渐进加载 + scenarios）；CLI 打包副本在 `cli_tdd/toonflow/skills/`。
- **Web 端重叠物**：`apps/web/src/components/settings/panels/mediaModel/providerPrompt.ts`（内嵌 types.d.ts + 四阶段引导 + ComfyUI 专章），本批不动。

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| tdd-dev 技能 | 核心交付物 | SKILL.md、references/provider/、随 CLI 分发 | 与 tdd-auto 并存，靠 description 区分 |
| CLI provider 命令组 | 核心交付物 | inspect/import/list/config/models/test | 封装 /api/providers/*，test 内置费用闸门 |
| 供应商文件(.ts) | 领域实体 | id/label/version/rules/models/generate* | 导入后存 data/providers/<id>.ts |
| 调试闭环 | 支撑系统 | debug/inspect、debug/run | test 命令的底层 |
| 用户确认闸门 | 流程控制点 | 准备就绪→询问→确认→真测 | 费用红线的执行机制 |
| 小白用户 | 角色 | 提供接口资料（url/key/模型名） | agent 代其执行全流程 |
| 画布节点 | 消费方 | data.model=[providerId,modelId] | 接入成功的最终消费者 |
| 开发规范事实源 | 约定 | tdd-dev 技能内（本批） | 后续与 providerPrompt.ts 统一 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 7 | 7 | - | - | N/A |
| 2 | 7 | 0 | 0 | 7 | 100% |
| 3 | 8 | 1 | 0 | 7 | 88% |
| 4 | 8 | 0 | 0 | 8 | 100% |
| 5 | 9 | 1 | 0 | 8 | 89% |
| 6 | 9 | 0 | 0 | 9 | 100% |
| 7 | 9 | 0 | 0 | 9 | 100%（连续收敛）|

## Interview Transcript
<details>
<summary>Full Q&A (7 rounds)</summary>

### Round 0（拓扑门）
**Q:** 3 个顶层组件（技能本体/供应商流程引导/扩展预留）划分对吗？
**A:** 对，就这 3 块。

### Round 1
**Q:** tdd-dev 引导 agent 的执行通道？
**A:** 扩展 tdd CLI（新增 provider 命令组）。
**Ambiguity:** 39%（组件 2）

### Round 2
**Q:** 后续开发类型清单的状态？
**A:** 方向已知清单未定 → 结构性预留，不预设。

### Round 3
**Q:** "正确接入"的验收线？
**A:** 需要真实测试。真测前确保准备就绪，再询问用户，确认后发起。严禁乱扣费。

### Round 4（Contrarian）
**Q:** tdd-dev 分发：见宿主就装还是按需？
**A:** 随 CLI 自动装，与 tdd-auto 同等待遇，description 区分路由。

### Round 5
**Q:** 与 Web 端 providerPrompt.ts 的规范事实源关系？
**A:** 技能新建完整规范，Web 暂不动，后续统一。

### Round 6（Simplifier）
**Q:** 扩展预留的最简形态？
**A:** 目录约定即预留（零额外机制）。

### Round 7
**Q:** 技能本身验收做到哪层？
**A:** 三层门禁 + 子代理冷启动。
**Final Ambiguity:** 20% ✓
</details>
