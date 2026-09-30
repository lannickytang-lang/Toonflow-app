# 场景：失败排查

适用：`queue status --watch` 退 5、`canvas report` 有异常、生成结果不对。

## 排查三步

```bash
# 1. 画布体检：异常清单（每条带建议）+ 节点表（模型/参数列/状态/产物）
tdd canvas report

# 2. 看失败原因原文（report 的 error 项或 watch 输出的任务）
tdd queue logs <taskId> --tail 30

# 3. 修正后重提
tdd node set <节点> --prompt "修正后的提示词"     # 或 --model / --duration 等参数修正
tdd queue retry <节点>                            # 也可 --set fix.json 批量
tdd queue status --watch                          # 确认归零
```

## 常见失败对照

| report 异常 / logs 原文 | 根因 | 修正 |
| --- | --- | --- |
| 未配置模型 | 节点没 model | `tdd models` 查后 `node set --model p/m` |
| 无提示词 | prompt 空 | `node set --prompt` |
| 提示词被拒/敏感词 | 供应商内容审查 | 改写提示词后 retry |
| 凭证无效/401 | 供应商 apiKey 未配或失效 | `tdd config set mediaProviderConfigs.<供应商>.ts <key>` |
| 上游未成功（warning） | 依赖的资产图失败，分镜被级联跳过 | 先修上游资产节点 |
| 产物缺失（成功标记但文件不在盘） | 产物被移动/删除 | `queue submit`（missing 会视为未完成重做） |
| 限流/超时 | 请求过频或网络抖动 | 无需处理——自动退避重试，不计失败 |

## 深挖

- 节点全量数据：`tdd --json node get <节点>`（含 generationHistory 最近 50 次记录）。
- 画布字段含义：`tdd canvas report --explain`。
- 需要肉眼看画布：转[页面协作](pageCollaboration.md)。
