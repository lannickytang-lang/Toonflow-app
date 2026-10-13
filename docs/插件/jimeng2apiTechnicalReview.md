# jimeng2api 插件技术复刻梳理

> 对象：`docs/插件/jimeng2api_V4.1.3(2)(1)(1)/`（"字字动画"软件的第三方闭源插件）
> 目的：完整还原其"操作即梦画布、批量挂机生图生视频"的实现流程与技术方案，为后续在 Toonflow 中复刻一个自定义媒体供应商做准备。
> 证据来源：`main.py`（入口 shim 源码）、`ui/*.html`（配置界面源码）、`jimeng_tasks.db`（真实任务数据）、`main_core.cp312-win_amd64.pyd` 符号表与字符串提取（核心逻辑被 Cython 编译闭源，本文档的函数行为均为符号名 + docstring 字符串 + 数据佐证的还原；标注"待抓包确认"处为编译期字符串压缩导致无法直接提取的部分）。

---

## 1. 一句话原理

**用 Playwright 启动一个带用户真实数据目录的 Chrome/Edge，登录即梦网页版；之后所有 API 请求（含 SSE 流式会话）都在这个缓存页面的 JS 上下文里用 `fetch` 发出——页面上已加载的字节 bdms 风控 SDK 会自动为请求注入 `a_bogus` 签名**，从而绕过签名门槛，把"普通生成接口"和"画布 AI 会话接口"都变成可编程调用的 API；再配合后台任务管理器做并发限流、随机间隔、轮询取片、自动下载，实现批量挂机。

pyd 内注释原话（最重要的两行证据）：

```
POST request via cached Playwright page (bdms SDK auto-injects a_bogus).
When stream=True, reads SSE incrementally in the browser page.
```

## 2. 它是什么、跑在哪

- **宿主**："字字动画"（AI 短剧制作软件，安装目录如 `E:\AI\字字动画\`），自带 `python-3.12` 运行时，插件放在宿主 `plugins/<插件名>/` 下。
- **UI 通信协议**：`ui/index.html` 引用 `../../../plugin-sdk.css|js`（相对插件目录向上三级，指向宿主 SDK）。前端用 `PluginSDK.sendAction(action)` / `PluginSDK.onAction(action, cb)` / `PluginSDK.saveParam(key, value)` 与 Python 侧 `handle_action(action, data)` 交互；参数持久化由宿主代管，`generate(context)` 时经 `context.plugin_params` 回传。
- **数据闭环**：宿主把分镜任务（prompt + 参考图路径）经 `generate(context)` 灌给插件 → 插件提交即梦并轮询 → 下载 mp4 到宿主工作目录（如 `E:\AI\字字动画\工作目录\默认\天机当铺\0001_video_20260728_021624_636263.mp4`）→ 宿主自动取走。
- **血统**：pyd 注释多处引用 `videos.ts`、`browser-service.ts` 的函数对应关系，并出现 `对应 POST /v1/videos/generations`（OpenAI 风格端点）——核心逻辑移植自 jimeng-free-api 一类的 TypeScript 开源项目，用 Cython 编译闭源后商业化售卖。

## 3. 目录结构与组件分工

| 文件/目录 | 性质 | 职责 |
| --- | --- | --- |
| `main.py` | 明文 Python | 入口 shim：**禁用原版许可证检查**，把 `handle_action` / `generate` / `check_license` / `__getattr__` 转发到编译核心。本地这份是破解后的形态 |
| `main_core.cp312-win_amd64.pyd` | Cython 编译 | 全部业务逻辑（`VideoGenerations` / `JiMengWeb` / `BackgroundTaskManager` / `VideoTask`），内含 `IsDebuggerPresent` 反调试、字符串压缩 |
| `CsPluginLicense.dll` / `CsPluginMachine.exe` / `license.dat` | .NET | 机器码授权系统（激活/校验），与业务无关，复刻可整体舍弃 |
| `update.cp312-win_amd64.pyd` | Cython 编译 | 手动"同步任务"实现 |
| `同步任务(双击执行).bat` | 批处理 | 用宿主 `..\..\..\python-3.12\python.exe` 执行 update 模块的 `main()`，挂机中断后手动对账 |
| `ui/index.html` | 配置面板 | sessionid、提交模式、模型、并发、间隔、画布提示词模板等 |
| `ui/task_log.html` | 任务日志 | 查询 `jimeng_tasks.db` 展示任务状态，支持取消 |
| `jimeng_tasks.db` | SQLite | 任务账本（见 §7） |
| `user_resources/plugins/JimengReverse/Plugin/` | 空目录 | 浏览器端组件（油猴脚本/扩展形态）的预留投放位，本副本为空；目录名 JimengReverse 暗示存在页面侧注入组件的可能 |

## 4. 核心技术逐项拆解

### 4.1 身份与登录（两种方式，二选一）

| 方式 | 实现 | 说明 |
| --- | --- | --- |
| 浏览器登录 | UI 点「打开登录浏览器」→ `JiMengWeb.open_browser` → Playwright `launchPersistentContext(用户数据目录)` 打开即梦页面，用户手动登录 | 用 `_get_chrome_user_data_dir` / `_get_edge_user_data_dir` 定位真实浏览器 profile（非 headless、非临时上下文），登录态持久 |
| 直填 sessionid | `_make_cookie` / `_make_browser_cookies` / `_pick_token` / `_get_action_sessionid` | 把 sessionid 构造为 cookie 注入 Playwright 上下文；`_pick_token` 从 cookie 池里选可用 token |

- 浏览器查找顺序：自定义路径（`browser_path` 参数）→ Chrome → Edge；仅支持 Chromium 内核。
- `JiMengWeb._setup_page_listeners` 监听 `on_page_close` / `on_context_close`，页面被关后 `reload_page` 重建，保证"缓存页面"常活。

### 4.2 反爬核心：cached page fetch + a_bogus 自动签名（复刻成败的关键）

即梦接口（字节系）要求请求带 `a_bogus` 签名参数，由页面内 bdms 风控 SDK 实时计算，纯服务端代码无法稳定伪造。本插件的解法：

1. `_get_browser_page` 拿到（并缓存）一个已加载即梦页面的 Playwright `Page`，`_route`（`page.route()`）负责必要的请求拦截处理；
2. `_browser_fetch`（注释标明等价于 browser-service.ts 的 `BrowserService.fetch()`）在**页面 JS 上下文内**执行 `fetch(url, options)`（`page.evaluate`）；
3. 页面里驻留的 bdms SDK 自动给这个 fetch 补 `a_bogus`（以及 msToken 等风控参数）；
4. 返回值序列化回 Python 侧处理。

**SSE 流式响应同理**：`stream=True` 时不是 Python 读流，而是"reads SSE incrementally in the browser page"——在页面里用 fetch + ReadableStream 增量解析，把逐段结果传回。这保证了画布会话这类长连接同样带签名。

> 复刻提示：不要尝试自己实现 a_bogus 算法（版本迭代快、混淆重），也不要在 Node/Bun 侧裸发请求；一切请求经真实页面上下文发出即可。`_generate_seedance_direct` 的注释也印证了这一点——"（备用）直接调用上游 API 的 Seedance 实现，需要 a_bogus 支持"，即不走页面的直连路线只是备胎。

### 4.3 素材上传：字节 ImageX + AWS SigV4

参考图/音频上传到字节 ImageX（火山引擎对象存储图片服务）：

- `_upload_image_bytes` / `_upload_media_bytes` / `_upload_image_url`（后者：从 URL 取图再传 ImageX，返回 image URI）
- 签名链：`_aws4_sign`（AWS Signature V4）+ `_amz_timestamp` + `_crc32_hex` + `_material_hash`，纯标准算法，无页面依赖
- 产物是 image URI，后续拼进 prompt 的素材引用或 material_list
- 当前版本仅支持图片类素材上传

### 4.4 normal 普通模式（直调网页版生成接口）

调用链：`submit_generate_normal` → `_generate_normal`：

1. `_upload_images`：本地参考图批量上传 ImageX；
2. `aigc_draft/generate` 接口提交生成任务（即梦网页版自身的生成端点），请求经 `_browser_fetch` 发出；
3. `_poll_video_result`：轮询 `get_history_by_ids` 直到视频生成完毕，返回视频 URL（`_extract_history_by_ids_record` 兼容新旧返回结构提取记录）；
4. `cancel_generate`：取消 `aigc_draft/generate` 任务。

Seedance 版本为 `submit_generate_seedance` → `_generate_seedance`（`_generate_seedance_direct` 为不走页面的备用实现）：

- 模型默认 `seedance-2.0-fast`；UI 提供 Seedance 2.0 / mini / Fast / VIP / Fast VIP 档位，VIP 档走"VIP 提示词模板"，普通档走"不要使用VIP功能"模板（`_seedance_use_fast_5s_free_trial`：fast 5s 档有免费试用判定）；
- 时长：Seedance 支持 4–15 秒（普通视频模型仅 5/10）；分辨率 720p/1080p；画幅 16:9 / 9:16 / 1:1 / 4:3 / 3:4（`_aspect_ratio` 折算）；
- 素材协议：**prompt 内用 `@1`、`@2` 占位符引用素材**，`_build_meta_list`（对应 videos.ts 的 `buildMetaListFromPrompt()`）解析占位符构建 meta_list，`_build_material_list`（对应 videos.ts 的 materialList 构建）+ `_upload_seedance_materials` 上传后产出 material_list；`_seedance_material_types` 区分素材类型，`_seedance_input_video_duration` 处理输入视频时长；
- `file_paths` 支持首帧/尾帧图。

### 4.5 canvas 画布模式（操作即梦"画布"）

调用链：`_get_canvas_project_list` / `create_canvas_project` → `_upload_images` → `submit_canvas_conversation`：

1. **画布项目管理**：`get_canvas_project_list` 拉取现有画布；`build_canvas_project_name` 按命名规则生成项目名；`create_canvas_project` 创建并返回 `project_id`；
2. **素材就位**：参考图上传 ImageX（同 §4.3）；
3. **提交会话（SSE）**：`submit_canvas_conversation` 把「画布提示词模板 + 分镜正文」作为自然语言指令，经 SSE 流式接口发给画布 AI 助手（等价于在画布里对 AI 助手说一句话）；
4. **结果解析**：`_extract_canvas_submit_result`（`_normalize`/`_apply_obj`/`_scan` 递归扫描）从 SSE 响应里解析 `submit_id` / `history_id` / `ret`；`_scan_text_for_ids` 从文本兜底扫 ID；`_resolve_canvas_history_id` + `_valid_canvas_history_id` 解析并校验 history_id 有效性；
5. 之后走与 normal 相同的 `get_history_by_ids` 轮询—下载链路。

**画布提示词模板**（UI 可改，`{}` 为占位符，这就是发给画布 AI 的原话）：

```
普通档：使用{model}帮我生成一个{duration}秒的视频，比例{aspect_ratio}，分辨率{resolution}，不要使用VIP功能，下面是我的提示词:
VIP 档：使用{model}帮我生成一个{duration}秒的视频，比例{aspect_ratio}，分辨率{resolution}，下面是我的提示词:
```

**参考图引用协议**（来自 db 真实任务数据）：

```
图2是角色陆临渊，图3是角色傅镇岳，…，图8是场景万寿楼宴会主厅，图9是物品盲杖
参考图：@图片2，是人物林晓梅（精致外出装）的图片；@图片1，是人物陈建国的图片；…
参考音频：@图片2的声音，这是林晓梅（精致外出装）的参考音频   ← 音色参考开关开启时
```

即：canvas 模式下素材靠「图N/@图片N + 文字说明」在提示词内声明对应关系，由画布 AI 理解；这与 Seedance 直调模式的 `@1/@2` 占位符协议不同。画布模式本质是**把结构化需求降维成一段对话指令，借用画布 AI 的编排能力出片**，省去自己拼 material_list 的复杂度。

**「画布分镜数」**（默认 8）：单画布会话内承载的分镜数量上限，控制单会话负载与失败半径。

具体 canvas SSE 端点路径被 Cython 字符串压缩，无法静态提取，**复刻时用浏览器 DevTools 抓一次包即可确认**（Network 面板过滤 `canvas` / EventStream）。

### 4.6 批量挂机调度

- **常驻线程**：`BackgroundTaskManager`（`__init__` / `wake_up` / `run`）后台循环，`submit_next_busy_task`（内部 `_do_submit`）按序取任务提交；
- **并发控制**：`_get_busy_submit_limit`（即 UI「即梦并发数量」，默认 10）限制在途任务数；`_get_busy_retry_interval` / `busy_retry_interval` 控制调度重试节奏；
- **拟人节奏**：提交间隔取 `[min_interval, max_interval]`（默认 12–15 秒）随机值；
- **等待出片**：`wait_for_task_completion`（`_safe_int_duration`）+ `_poll_video_result` 轮询；
- **落盘回写**：`download_video` / `download_file` 下载 mp4（`_fetch_hq_url` 取高清地址、`_extract_video_url` 提取 URL、`get_video_duration_seconds` 校验时长）→ 写宿主工作目录 → `save_task_to_db` 记账；
- **对账恢复**：`load_tasks_from_db` / `delete_task_from_db` / `cleanup_task` / `handle_history_by_ids`；UI「同步任务」action（`update_tasks`）与双击 bat（update.pyd）均为手动触发对账，把 db 里未完结任务与即梦服务端状态拉齐，实现挂机中断后续跑；
- **取消**：`_mark_task_api_cancel` / `_cancel_task_from_log`（任务日志页操作）。
- **Playwright 线程模型**：`get_playwright_instance` + `_playwright_worker` + `_ensure_playwright_thread` + `_run_in_playwright_thread`——Playwright 实例独占一个工作线程，所有页面操作经 `run_coroutine_threadsafe` 风格投递到该线程执行（Playwright 的 sync API 不允许跨线程使用，这是标准解法，复刻时必须照做）。

### 4.7 UI 参数清单（plugin_params）

| 参数键 | 默认 | 说明 |
| --- | --- | --- |
| `sessionid` | — | 即梦 cookie，二选一登录方式 |
| `submit_mode` | normal | `normal` / `canvas` |
| `model` | Seedance 2.0 | mini / Fast / VIP / Fast VIP |
| `generation_mode` | 全能参考模式 | 生成模式 |
| `aspect_ratio` | 16:9 | 9:16 / 1:1 / 4:3 / 3:4 |
| `duration` | 12 | 4–15 秒 |
| `resolution` | 720p | 720p / 1080p |
| `jimeng_concurrency` | 10 | 并发上限 |
| `canvas_scene_count` | 8 | 单画布分镜数 |
| `min_interval` / `max_interval` | 12 / 15 | 随机提交间隔（秒） |
| `canvas_prompt` / `canvas_prompt_vip` | 见 §4.5 模板 | 画布提示词模板（普通/VIP 两套） |
| `audio_reference` | 关 | 音色参考（配合宿主角色管理的音色导入） |
| `browser_path` | 空 | 自定义浏览器路径，空则自动找 Chrome/Edge |

## 5. 完整调用时序

### normal 链路

```
宿主 generate(context)          # prompt + 参考图路径 + plugin_params
 └─ BackgroundTaskManager 入队 → jimeng_tasks.db 记账(status=排队)
     └─ submit_next_busy_task（并发<上限 && 距上次提交≥随机间隔）
         ├─ _upload_images → ImageX(AWS4签名) → image URI 列表
         ├─ _build_meta_list(解析 @1/@2) + _build_material_list
         ├─ _browser_fetch POST aigc_draft/generate（页面内发，自动带 a_bogus）
         │    └─ 解析 submit_id/history_id → db 更新
         ├─ _poll_video_result：轮询 get_history_by_ids → video_url
         └─ download_video → 宿主工作目录/xxxx_video_*.mp4 → db 更新(status=完成)
             └─ 宿主自动取走成品
```

### canvas 链路

```
宿主 generate(context)
 └─ 入队 → 调度（同上）
     ├─ get_canvas_project_list / create_canvas_project → project_id
     ├─ _upload_images → image URI 列表
     ├─ 拼 canvas_prompt 模板 + 「图N是…」引用协议 + 分镜正文
     ├─ submit_canvas_conversation：页面内 SSE 增量读取（自动带 a_bogus）
     │    └─ _extract_canvas_submit_result → submit_id/history_id（校验有效性）
     ├─ 轮询 get_history_by_ids → video_url
     └─ 下载回写（同上）
```

## 6. jimeng_tasks.db schema

```sql
CREATE TABLE tasks (
  unique_name  TEXT,      -- 即梦侧唯一名
  viewer_index INTEGER,   -- 宿主分镜序号
  task_id      TEXT,      -- 服务端任务 id
  submit_id    TEXT,      -- 提交 id（UUID）
  created_time INTEGER,   -- unix 时间戳
  status       INTEGER,   -- 状态码（枚举含义因字符串压缩未完全还原；实测 status=1 时已有本地成品文件）
  video_url    TEXT,      -- 成片 URL
  video_path   TEXT,      -- 本地落盘路径（宿主工作目录）
  prompt       TEXT,      -- 完整提交提示词（复刻时最宝贵的语料）
  ori_name     TEXT,      -- 原始名
  search_key   TEXT,      -- 检索键
  workspace_id INTEGER,   -- 宿主工作区
  context_json TEXT       -- 提交时 context 快照（断点续跑用）
);
```

`context_json` 存了提交时刻的完整上下文快照，配合 `video_path` 兜底，是挂机中断后不丢任务的关键。

## 7. Toonflow 复刻映射（自定义媒体供应商）

Toonflow 供应商体系（`packages/providers/`，接入流程见 tdd-dev 技能）与本插件能力点的对应关系：

| Toonflow 供应商环节 | 本插件对应实现 | 复刻建议 |
| --- | --- | --- |
| 凭证配置 | `sessionid` 参数 / Playwright 持久 profile | 凭证字段收 sessionid；浏览器 profile 路径放供应商配置 |
| 提交（submit） | `submit_generate_normal` / `submit_canvas_conversation` | 建议先做 normal（Seedance `aigc_draft/generate`），canvas 模式作为第二档；`@1/@2` 素材协议与 Toonflow 参考图（cast/art 资产）天然契合 |
| 轮询（poll） | `_poll_video_result`（get_history_by_ids） | 直接对齐现有 provider 的轮询模型 |
| 取消（cancel） | `cancel_generate` | 对齐 |
| 产物下载 | `download_video`（`_fetch_hq_url` 取高清） | Toonflow 已有下载/缓存层，供应商只需回 result_url |
| 参考图上传 | ImageX + AWS SigV4（`_aws4_sign` 等） | 标准算法可直译成 TypeScript；这一步无页面依赖，可独立单测 |
| 并发/节流 | `jimeng_concurrency` + 随机 12–15s 间隔 | 供应商内部做信号量 + 随机抖动，参数暴露到模型配置 |
| 断点对账 | db + `update_tasks` / bat | Toonflow 队列已有任务状态，无需另建账本 |

技术栈落地要点（Toonflow server 为 Bun + TypeScript）：

1. **用 `playwright` npm 包的 `launchPersistentContext`** 维护一个常驻浏览器上下文（与用户日常浏览器 profile 隔离，建议独立目录），首次登录页面由用户手动完成或扫二维码；
2. **所有即梦请求封装成一个 `pageFetch`**：`page.evaluate` 内 `fetch(url, opts)`，SSE 用同一页面内 ReadableStream 增量解析；Playwright 对象独占一个工作线程/协程，禁止跨任务并发共享句柄（照抄 `_playwright_worker` 的单线程投递模式）；
3. **风控红线**：保留随机提交间隔与并发上限；不要并发打 SSE；a_bogus 永远交给页面 SDK，不自研签名；
4. **抓包先行**：canvas 的 SSE 端点、`aigc_draft/generate` 的完整请求体字段（模型 key、`multi_area`、`capacity` 等）需在真实页面 DevTools 抓包确认后再写死映射——静态分析因字符串压缩拿不到全量字段名；
5. **授权体系（CsPluginLicense 等）不移植**——那是卖插件的钱庄，与功能无关。

**路线取舍提醒**：字节官方渠道（火山方舟）对外提供 Seedance 系列视频生成 API，若可接受按量计费，走官方端点是更稳定、无风控风险的路线；本插件这条"网页版灰色路径"的核心价值在于**复用网页版的免费额度/积分**，以及拿到画布 AI 会话这种官方 API 没有能力。复刻前先明确要哪一种。

## 8. 风险与合规

- 本插件模拟网页端行为调用即梦接口，**违反即梦服务条款**，批量挂机有账号风控/封禁的实际风险；Toonflow 复刻版仅应作个人/授权用途，并保留人工可控的开关与频控。
- 本地副本的 `main.py` 已破解许可证检查（"License check is temporarily disabled for local testing"），分发或商用原插件有法律风险；复刻时应仅借鉴技术方案，不搬运其代码。
- 即梦接口无公开契约：模型 key、端点路径、`a_bogus` 生成逻辑均随版本漂移，复刻版必须把"端点/字段映射"外置成可热更的配置，而非硬编码。

## 9. 附录：从 pyd 符号表还原的函数清单

```
VideoGenerations（请求/生成核心）
  _api_request  _make_cookie  _make_browser_cookies  _pick_token
  _get_proxies  _unix_ts  _md5  _new_uuid  _gcd  _aspect_ratio  _resolve_resolution
  _get_model  _is_seedance  _seedance_material_types
  _seedance_use_fast_5s_free_trial  _seedance_input_video_duration
  _aws4_sign  _amz_timestamp  _crc32_hex  _material_hash
  _upload_image_bytes  _upload_media_bytes  _upload_image_url  _upload_images
  _upload_seedance_materials  _build_material_list  _build_meta_list
  submit_generate_normal  _generate_normal
  submit_generate_seedance  _generate_seedance  _generate_seedance_direct(备用)
  get_canvas_project_list  create_canvas_project  build_canvas_project_name
  submit_canvas_conversation  _extract_canvas_submit_result  _scan_text_for_ids
  _resolve_canvas_history_id  _valid_canvas_history_id  _extract_canvas_history_id
  _poll_video_result  _extract_history_by_ids_record  _extract_video_url  _fetch_hq_url
  cancel_generate  generate  _validate_params  _frame_obj

浏览器管理（JiMengWeb / Playwright）
  get_playwright_instance  _playwright_worker  _ensure_playwright_thread
  _run_in_playwright_thread  _get_browser_page(._route)  _browser_fetch
  _close_browser_session  _get_chrome_executable_path  _get_edge_executable_path
  _get_chrome_user_data_dir  _get_edge_user_data_dir
  JiMengWeb.open_browser  _open_browser_impl  _setup_page_listeners
  reload_page  close

任务调度与账本
  BackgroundTaskManager(init/wake_up/run)  submit_next_busy_task(._do_submit)
  _get_busy_submit_limit  _get_busy_retry_interval  wait_for_task_completion
  VideoTask(post_init/update_progress/generate/_generate_impl)
  load_tasks_from_db  save_task_to_db  delete_task_from_db  cleanup_task
  _get_submit_mode_from_context  _get_task_submit_mode  _task_status_info
  _format_task_time  _load_task_context  _fetch_task_logs
  _mark_task_api_cancel  _cancel_task_from_log  handle_history_by_ids
  submit_next_busy_task  download_video  download_file
  get_video_duration_seconds  check_license
```
