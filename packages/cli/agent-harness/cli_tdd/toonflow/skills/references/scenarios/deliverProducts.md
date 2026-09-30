# 场景：产物交付

适用：生成完成（或部分完成）后，向用户交付产物清单与校验结果。

## 标准交付

```bash
tdd queue export --format md --output 清单.md --verify
```

- 完成消息输出**绝对路径**（相对路径基于终端当前目录——建议显式传绝对路径或以消息为准）；
- md 清单头部标注 `产物根目录: <工作区绝对路径>`，表格含画布/分镜/类型/状态/产物列；
- `--verify` 逐产物 `stat` 校验真实落盘（字节数），任何缺失 → 该行标注 ⚠ 且退出码 5。

## 格式选择

| 格式 | 用途 |
| --- | --- |
| `--format md`（默认） | 人读的交付清单（表格） |
| `--format json` | 结构化（rows 含 nodeId/canvasId/files/bytes/verified），程序消费 |
| `--format csv` | Excel/表格软件 |

多画布聚合：`tdd --canvas 画布1,画布2 queue export …`（清单含画布列）。

## 交付报告要点（给用户的总结应包含）

1. 成功/失败/跳过计数（`queue status` 的 summary）；
2. 产物根目录绝对路径（清单头部）与清单文件绝对路径；
3. `--verify` 结果：全部在盘 ✓ 或缺失项列表（退 5 时必须说明并给原因）；
4. 失败项的处理建议（转[失败排查](failureTroubleshooting.md)）。

## 部分完成也可交付

仍在挂机中的画布 export 不会中断生成——可先出中期清单（状态列如实显示 running/pending）。
