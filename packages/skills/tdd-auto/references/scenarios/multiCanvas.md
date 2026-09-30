# 场景：多画布工作流

适用：按项目/批次/版本划分画布（用户大概率按画布组织工作），一次管理多块。

## 建画布

```bash
tdd canvas create 第二季            # 新建空画布（同名自动加时间戳后缀）
tdd canvas import 分镜.json --new-canvas      # 建新画布（自动编号）并导入
tdd canvas import 分镜.json --new-canvas 第二季   # 指定名
```

原则：**一轮任务一块画布**——不要把新内容追加进无关画布（幂等 import 会防混批，但画布语义靠划分维持）。

## 查看与切换

```bash
tdd canvas list                 # 全部画布（节点/边/revision）
tdd --canvas 第二季 canvas get   # 指定画布摘要（省略 .json 自动补全）
tdd --canvas 第二季 canvas report
```

## 多画布批量与监控（逗号分隔）

```bash
tdd --canvas 画布1,画布2,第二季 queue submit          # 各画布分别入队
tdd --canvas 画布1,画布2 queue status --watch          # 一次盯多块
tdd --canvas 画布1,画布2 queue export --output 总清单.md --verify   # 聚合清单（含画布列）
```

## 注意

- `--canvas` 是全局选项：写在子命令**之前**（`tdd --canvas X queue status` ✓ / `tdd queue status --canvas X` ✗）。
- 页面里也能看到 CLI 建的画布：打开画布切换器即实时列出（外部建图对页面可见）。
- 画布删除属高风险（server 尚未提供删除操作；清理旧画布先与用户确认替代方案）。
