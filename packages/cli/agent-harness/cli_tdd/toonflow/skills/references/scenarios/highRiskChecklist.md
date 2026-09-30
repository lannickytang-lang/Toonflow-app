# 场景：高风险操作与确认时机

适用：执行前必须先向用户给出选项确认的操作（不可先斩后奏）。

## 高风险清单

| 操作 | 命令 | 风险 |
| --- | --- | --- |
| 删除节点 | `node` 域删除类操作（经画布操作） | 破坏画布结构，产物引用悬空 |
| 覆盖/删除文件 | 工作区文件写入（import --force-add 以外的人工改画布 JSON 等） | 数据不可恢复 |
| 批量消耗生成额度 | `queue submit --scope all`、大分镜 `--auto-submit`、真实供应商 retry | 真金白银的 API 费用 |
| 指定版本降级 CLI | `tdd update --version <旧版>` | 行为回退 |
| 画布内容整体替换 | `--force-add` 追加、大规模 `node set`/`node cast` | 覆盖用户已有编排 |

## 确认方式

给出**具体影响面**让用户选择，例：

> 即将提交 120 个视频生成任务（真实供应商 grsai，预估消耗 …），或先跑前 5 个验证效果。
> A. 全部提交　B. 先提交前 5 个　C. 取消

## 安全默认（无需确认）

- `tdd canvas import`（幂等：一致跳过、差异不生效）与 `--check`；
- `queue submit` 默认 missing（只补未完成，不重复消耗）；
- 所有只读命令（list/get/report/logs/export --verify）；
- `tdd install` / `tdd update --check`。

## 真实供应商凭证

涉及消耗额度的任务前，确认凭证已配置：`tdd config get mediaProviderConfigs.<供应商>`；未配置时向用户索取（不要把明文 key 写进日志/回显，配置后即删）。
