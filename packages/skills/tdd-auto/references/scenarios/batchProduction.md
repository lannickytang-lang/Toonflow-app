# 场景：挂机批量生产（几百个视频）

适用：大批量生成、长时间无人值守。单视频真实生成约 15 分钟，单画布可达数百视频。

## 标准流程

```bash
export TOONFLOW_WORKSPACE="D:/prod/demo"    # 一次设定，长流程省 -w

tdd canvas import 分镜.json --auto-submit   # 建图+入队（依赖编排在 server：资产图先行）

tdd queue status --watch --interval 60 || true
# 退 0=全部成功；退 5=有失败/跳过（下一步排查）；|| true 让挂机脚本不中断
```

## 挂机期间

- 用户可随时打开画布页面查看（revision 乐观锁保证人机不互相覆盖；偶发 409 见 errors.md）。
- 中途查看一次进度：`tdd queue status`（不带 watch）。

## server 重启 / 断点重建

队列是内存态，server 重启即清空——属正常设计，产物都在盘上：

```bash
tdd queue submit            # missing 语义：已成功且产物在盘的自动跳过，只补未完成
tdd queue status --watch --interval 60
```

## 完成交付

```bash
tdd queue export --format md --output 清单.md --verify
# 完成消息含绝对路径；清单头部有产物根目录，url 为工作区相对路径
```

## 失败处理（挂机结束后）

失败任务已自动重试 3 次后跳过（不拖垮队列），逐个处理：

```bash
tdd queue logs <taskId>                 # 失败原因原文（如提示词被拒）
tdd node set <节点> --prompt "修改后…"   # 修正
tdd queue retry <节点>                  # 重提
```

详见[失败排查](failureTroubleshooting.md)。
