# 场景：首次使用（从零到第一个视频）

适用：新机器/新环境，tdd 尚未安装。

## 步骤

```bash
# 1. 环境就绪（探测顺序不可颠倒：先确认命令，失败才装）
tdd --version || echo "未安装"
```

未安装 → 按 [environment.md](../environment.md) 安装（python 自检 → curl+pip 一行安装）。

```bash
# 2. 安装技能与插件（幂等；知道自己的技能目录时用 --hosts <目录> 直达，免探测）
tdd install --hosts ~/.zcode/skills
# 出现 404/技能安装失败 → 多为 CLI 版本过旧：先 tdd update 再重试；
# 紧急可读数据目录副本：<数据根>/skills/（tdd status 可查数据根，各技能含 SKILL.md）

# 3. 自检：server 在线、工作区、PATH
tdd status

# 4. 打开工作区（目录不存在自动创建；记住默认）
tdd project open "D:/prod/demo"

# 5. 查可用模型（分镜 JSON 的 options 要用）
tdd models

# 6. 写分镜 JSON 后导入建图并提交队列
tdd canvas import 分镜.json --auto-submit

# 7. 挂机盯进度（mock 秒级；真实模型单视频约 15 分钟）
tdd queue status --watch --interval 60

# 8. 交付：产物清单 + 落盘校验
tdd queue export --format md --output 清单.md --verify
```

## 判断点

- 第 3 步报"无法连接 server"（退 6）→ 提醒用户启动 Toonflow 再继续。
- 第 6 步结构报错 → `tdd canvas import --schema` 对照示例修正 JSON。
- 第 7 步退出码 5 → 转[失败排查](failureTroubleshooting.md)。
