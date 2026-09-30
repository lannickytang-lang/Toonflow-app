# 七环节工作流（自主推进，判定信号驱动）

总原则：你自己完成全流程，只在三个停点（方案确认 / 缺密钥 / 真测授权）找用户，且必须给出方案与推荐。每环节有判定信号——信号不亮不进下一环节，亮了才在收尾汇报进度。

## 环节 1：调研（自主，结束必停确认）

弄清目标供应商的 API，产出"请求→响应"样例（后续 dryrun 的样例文件就来自这里）。

调研清单（按序弄清，全部零费用）：

| 项 | 要弄清什么 | 常见来源 |
| --- | --- | --- |
| 端点 | 生成接口 URL、方法、请求体结构 | 用户给的文档链接 > 官网/开放平台 > 通用协议推断 |
| 鉴权 | header 形态（多为 `Authorization: Bearer`）、key 获取地址 | 文档"鉴权"章节；控制台/注册页给用户 |
| 模型 | 可用模型 id、能力（图片/视频）、参数（比例/尺寸/时长） | 文档模型列表或 `probe` 实测 |
| 异步协议 | 同步返回 or 任务 id + 轮询；轮询间隔与终态判定 | 文档"异步任务"章节 |
| 响应 | 成功响应的结构（媒体 url 在哪个字段）、错误码含义 | 文档示例（**注意：示例可能与实际不符，真测才可最终验证**） |

资料不全时的补充手段：
- apifox 文档站支持 `llms.txt`（如 `https://xxx.apifox.cn/llms.txt`）拿全量文档目录——同站的关联接口常分页面（"创建视频"与"查询进度"分开）；首次请求偶发 500，重试即可；
- 有模型列表地址时 `tdd provider probe --url <地址> --config apiKey=<key>` 只读预检：**密钥实际能用到哪些模型**（中转站按分组授权，文档里的模型 key 未必能用）。

**停点 1（必停）：调研完成、动工前**，输出接入方案确认卡：

1. **接入模型清单**（表格：模型 id / 类型 / 能力来源）——按用户需求与密钥实际权限圈定。**不强求图片视频全有**：纯生图供应商/密钥只注册 image 模型是正常形态，确认卡里如实写"密钥无视频渠道"之类结论即可；
2. **方案要点**：端点、鉴权、同步/异步协议、样例响应来源；
3. **注意事项**：预计费用、限流策略、文档疑点、密钥权限范围（probe 结论）；
4. **你的推荐与理由**（存在多解时列方案对比）。

用户确认后才进环节 2。用户提供的资料里有直接答案、且方案唯一无歧义时，确认卡照发（让用户知情），但可以一句话请用户"无异议即开始"。

## 环节 2：开发（自主）

照 [providerSpec.md](providerSpec.md) 骨架填空生成 `<id>.ts`。id 取供应商语义名（如 `acmeVideo`）。生成代码时把调研到的端点/鉴权/轮询协议如实落入实现，不要虚构字段；参考素材字段名按契约（images/firstFrame/lastFrame）。

## 环节 3：校验（自主，零费用）

```bash
tdd provider inspect demoProvider.ts
```

失败输出具体原因（语法错误带行号、字面量违规指明字段）。修复 → 重跑，循环到退出码 0。

## 环节 4：干跑（自主，零费用，dryrun 请求不出网）

先写样例文件 `samples.json`（来自环节 1 调研的响应样例）：

```json
[
  { "match": "api.example.com/v1/images", "method": "POST", "status": 200,
    "body": { "result": { "url": "https://cdn.example.com/x.png" } } }
]
```

- `match`：URL 子串（域名或路径片段）；`method`：可选，区分同路径不同动词（POST 创建 vs GET 轮询）；
- `times`：该样例可消耗次数（默认 1）；轮询序列写多条样例按序消耗（先"处理中"再"成功"）；
- body 可为对象（自动序列化）；`contentType` 缺省 application/json。

```bash
tdd provider dryrun demoProvider.ts --model demoImage --samples samples.json
```

凭证说明：dryrun/test **自动回退读取已装供应商的持久化凭证**（已 import 且 config 过即可省 `--config`）；未安装或未配置时用 `--config apiKey=test` 传临时值。

**验证两件事**（这是 dryrun 的全部意义）：

1. **构造入参**：输出里每条请求的 方法/URL/headers/body——对照上游文档逐字段核对（鉴权头形态、字段名、单位）；
2. **解析结果**：最终输出 `成功: 1 个媒体（image）`——上游样例响应被正确转为 MediaAsset。

`mock_unmatched` 404 = 代码请求了样例没覆盖的地址（或动词不匹配）：看日志该请求的 URL/method，补对应样例重跑。循环到全绿。

## 环节 5：导入（自主）

```bash
tdd provider import demoProvider.ts
```

409 = 已安装同名供应商：向用户报告差异；确认替换则 `delete <id> --yes` 后重新 import。**注意：delete 会连带清除该供应商已配置的凭证**，重装后必须重新执行环节 6。

## 环节 6：配置（自主；停点 2）

```bash
tdd provider config demoProvider --set apiKey=sk-真实密钥
```

连通性验证（按 modelsUrl 适用性选方式，见 [providerSpec.md](providerSpec.md) "modelsUrl 适用边界"）：

- 配置了 modelsUrl（上游列表干净/可按 type 过滤）：`tdd provider models demoProvider --refresh`；
- 未配置 modelsUrl（全量中转站/无列表接口）：`tdd provider probe --url <模型列表地址> --config apiKey=<key>` 验证密钥有效即可，模型清单由静态注册保证。

- `config` 支持临时密钥先行（dryrun 的 `--config` 同理）：用户 key 未到位时用占位值走通流程，到位后覆盖；
- **停点 2（缺密钥）**：用户没给 key——告知获取地址（调研阶段查到的控制台/注册链接）、需要什么权限档位，等用户提供后写入并验证连通。

## 环节 7：真测与交付（停点 3）

按 SKILL.md 费用红线四条件向用户申请（说明供应商/模型/费用风险），同意后：

```bash
tdd provider test demoProvider.ts --model demoImage --yes
```

（凭证自动回退已装配置；`--config` 仅临时覆盖用。）

失败先看输出的请求日志定位（429=限流等待重试；401/403=凭证；No available channel=密钥分组无该模型渠道——详见 [errors.md](errors.md)），修复后**先 dryrun 再真测**，不要反复烧钱试错。

成功后按 SKILL.md"任务收尾"汇报，并说明画布使用方式：生成节点模型下拉选 `demoProvider/demoImage`；批量生产交接 tdd-auto。

## 断点续作（会话中断后恢复）

`tdd provider list` 看现状即可定位断点：无该供应商 → 从环节 2 续；有但缺凭证 → 环节 6；有且已配置 → 环节 7。本地中间产物（.ts、samples.json）记录在汇报里，丢了按调研结论重生成。
