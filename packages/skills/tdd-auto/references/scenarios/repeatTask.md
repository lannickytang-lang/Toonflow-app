# 场景：重复任务 / 画布已存在

适用：用户再次发来同一（或相近）任务，工作区里已有画布——判断存量是否就是本次任务所要，避免混批或漏做。

## 判断流程

```bash
# 1. 干跑比对：手头分镜 JSON vs 存量画布，直出差异
tdd canvas import 分镜.json --check
```

按比对结果三分支：

**全部一致（skip=N, conflict=0）**——存量就是本任务产物：

```bash
tdd canvas report          # 核验健康度与参数列（时长/比例/分辨率）
tdd queue export --verify  # 核验产物落盘，向用户报告"此前已完成"
```

有未完成的（report 显示非 succeeded）→ 补齐：`tdd canvas import 分镜.json --auto-submit`（全跳过也会补提未完成，零副作用）。

**存在差异（conflict>0）**——用户改过脚本，先向用户确认意图：

- 存量作废重做：`tdd canvas import 分镜.json --new-canvas`（新画布导入，旧画布留档）；
- 以新改旧：`node set <差异节点> --prompt …` 逐项改存量后，重跑 `--check` 确认归零；
- 强制并存追加：`--force-add`（会产生同名新节点，一般不推荐）。

**全部新建（create=N）**——存量与本任务无关（别的项目内容）：

```bash
tdd canvas import 分镜.json --new-canvas    # 不要追加进无关画布
```

## 原则

- 不要凭"画布存在且全部成功"就擅自把任务改写为"核对存量"——用 `--check` 的客观比对结果说话，有歧义问用户。
- 不要对非空画布盲目裸 import——幂等语义下虽不会混批，但差异会被跳过而非生效。
