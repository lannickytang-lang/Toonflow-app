# 方案：分镜导入任意字段支持 + 节点 tags + 参考顺序与 cast 一致性保障

> 调研结论全部经代码核实（file:line 为当前 dev @ 9bf02a2）。

## 一、现状与关键事实

### 导入链路（三条入口汇合到同一实现）
| 入口 | 位置 | 未知字段现状 |
|------|------|--------------|
| 画布工具栏弹框 | `storyboardImportDialog.vue`（normalizeParsed :374-398 白名单重建） | **静默丢弃**（videoPromptZh、duration 都丢） |
| AI 推送 | `routes/storyboardImport/push.ts:7-19`（strictObject） | **400 报错** |
| CLI `tdd canvas import` | `ops.ts:355` 过 `canvasSchemas.importStoryboard.parse`（strictObject，`packages/tools/canvas/src/runtime.ts:25-47`） | **抛错** |

执行实现：headless `apps/server/src/utils/canvas/ops.ts:354-508` 与页面版 `useCanvasTools.ts:303-430`（同构两份）。

### 视频节点数据
- 画布 JSON `nodes[].data` 是自由 Record，磁盘层不校验（`repository.ts:8-35`）——加 `tags` 键天然存活
- 现有字段：label/prompt/promptModel/model/duration/resolution/ratio/mode/generateAudio/handles/outputs/generationHistory/referenceOrder，**无扩展位**
- 全部正规写入通道（导入 schema、nodeTools set 工具）都是 strictObject 拦截

### 参考顺序链路（需求 3 的核心事实）
```
cast 数组序（导入时）→ edges 数组序（ops.ts:488-496 按 cast 序 push）
→ collectReferences 按 edges 序遍历 + Map 插入序保序（nodeTools.ts:106-125）
→ images = references.filter(IMAGE)（nodeTools.ts:327）
→ generateMedia Promise.all 保序读文件（generation.ts:69-79）
→ provider 纯位置语义透传（grsai.ts:147-159 images.slice(0,9) → payload.images）
```
**结论：cast 序 → 参考图顺序在导入时刻已天然一致，全程保序。** 风险在三处：
1. **bug**：referenceOrder 键格式前后端错位——前端写 `encodeURIComponent(JSON.stringify([source, handle]))`（`useNodeReferences.ts:14-19`），headless 用文件 url 查（`nodeTools.ts:121`），两套键永不匹配 → 前端拖拽排序 headless 不认，headless 排序恒等于边序
2. **静默丢边**：cast 中不存在于 assets 的名字被 `.filter(!!source)` 丢掉（`ops.ts:488-496`），无任何提示
3. **帧模式交互**：startEndRequired 等帧模式下 `images[0]→firstFrame、images[1]→lastFrame`（nodeTools.ts:328-346）——cast 前两项会被当首尾帧消耗，Ref2VA 纯参考模式不受影响

另外：prompt 里的 `@小满` 与参考文件之间**不存在名字映射**（模型侧一致性靠"prompt 行文中 Subject 出现顺序 = 图片数组顺序"这一约定，即 Ref2VA 的 Subject N = 第 N 张图）。

## 二、需求 1+2：任意字段支持 + tags 归集

### 策略：schema 放宽为"必须字段校验 + catchall 透传"，落盘时归集进 data.tags

1. **schema 层**（4 处 strictObject → `z.object(必须字段).catchall(z.json())`）：
   - `packages/tools/canvas/src/runtime.ts:25-47` importStoryboard（scenes 项 + 顶层 args.options）
   - `apps/server/src/routes/storyboardImport/push.ts`
   - `packages/tools/storyboardTemplate/src/index.ts:99-124`
   - 必须字段维持：scenes 项 `sortNum/videoPrompt`（cast、duration 保持现状可选）；assets 项 `name`
2. **前端弹框**（`storyboardImportDialog.vue` normalizeParsed）：白名单重建改为"标准字段 + 剩余键归入 tags"；表格校对界面加"扩展字段"列（默认折叠 JSON 预览），确认导入时 tags 原样透传
3. **落盘归集**（`ops.ts` 与 `useCanvasTools.ts` 写节点处）：定义标准字段名单（`sortNum/videoPrompt/cast/duration/videoPromptZh`），scenes 项中名单外的键收进 `node.data.tags = {...}`；`videoPromptZh` 提升为标准字段（写 `node.data.promptZh`，现为丢弃）
4. **字段文档**：`report.ts:152-161` canvasFieldGuide 增补 `tags` 与 `promptZh`；CLI `canvas.py:9-18` 字段说明同步
5. **幂等比对**：diffStoryboard 维持只比标准字段——重导入不覆盖用户手改的 tags（推荐行为）

### 旧 spec 纪律例外声明
deep-interview-storyboard-import spec 约定"不改 packages/tools/* 源码"，但 importStoryboard 的 schema 就定义在 `packages/tools/canvas/src/runtime.ts`，无替代落点，本次必须例外（schema 与执行逻辑分离无既有机制，为此新建迁移层成本不值）。

## 三、需求 3：确认参考顺序与 cast 一致

**回答：顺序一致性在导入建边时已定型且全程保序（见一、链路），需要的是"守住 + 可验证"，三件事：**

1. **修 referenceOrder 键错位**（bug 修复）：统一为同一键格式（推荐统一用 `source:id + handle` 组合键，两侧同改 `nodeTools.ts:121` 与 `useNodeReferences.ts:14-19`），修后前端拖拽排序在 headless 侧真实生效——用户主动重排优先于 cast 序（符合直觉：手动调整是更晚的意图）
2. **导入时 cast 校验（防静默丢边）**：`ops.ts` / `useCanvasTools.ts` 建 edge 前校验 cast 每个名字都能匹配到资产节点；匹配不到的收集为导入警告（弹框表格标红该行 + CLI 输出 warning），不再静默
3. **cast 顺序持久化 + 生成对照可查**：
   - 导入时把该分镜的 cast 序写进视频节点 `data.cast = [...]`（标准字段）
   - 生成侧 `runGeneration` 已有调试日志通道，参考列表带资产 label 输出（collectReferences 已能拿到 source 节点 label），真测/dryrun 日志中"参考 N: <资产名>"与 data.cast 对照即可确认
   - 不做生成时强制断言（用户手动拖拽重排后强制会误报）

### 边界提醒（写进方案与文档，不改行为）
- 帧模式（首尾帧必填/可选）下 cast 前两项被消耗为首尾帧，剩余才进 images——Ref2VA 纯参考模式无此问题；导入时若模型 mode 含帧模式可在警告中提示
- cast 重复同名经 dedupe 只算一次参考（现有行为，合理）

## 四、改动落点清单

| 文件 | 改动 |
|------|------|
| `packages/tools/canvas/src/runtime.ts` | importStoryboard schema 放宽（catchall 透传） |
| `apps/server/src/routes/storyboardImport/push.ts` | 同上 |
| `packages/tools/storyboardTemplate/src/index.ts` | 推送工具 schema 同上 |
| `apps/web/.../storyboardImportDialog.vue` | normalizeParsed 归集 tags；表格扩展字段列；cast 未匹配标红 |
| `apps/server/src/utils/canvas/ops.ts` | 节点 data 写 tags/promptZh/cast；cast 校验警告 |
| `apps/web/.../useCanvasTools.ts` | 页面版同构改动 |
| `apps/server/src/utils/canvas/nodeTools.ts` | referenceOrder 键格式统一 |
| `packages/nodeScaffold/src/useNodeReferences.ts` | 同上（另一侧） |
| `apps/server/src/utils/canvas/report.ts` + CLI `canvas.py` | 字段文档增补 tags/promptZh/cast |

## 五、风险与边界

- zod v4 catchall 与 strictObject 互斥：strictObject 换 object + catchall 后必须字段校验语义不变
- 弹框表格新增"扩展字段"列需控制 UI 复杂度（默认折叠）
- 两份同构实现（headless / 页面版）需同步改，避免行为分叉
- 旧画布/旧导入数据无 tags：所有读取路径对 tags 缺省容错（`data.tags ?? {}`）
