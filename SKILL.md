# AI-CMO × OpenClaw 自动化推流 Skill

## 概述

AI-CMO 是一个 AI 驱动的社媒营销分析平台。它能自动分析你的产品，在 Reddit、YouTube、Twitter、Quora、Product Hunt、Hacker News 等平台上找到最适合推广的帖子，并为每个帖子生成定制化的评论话术。

结合 **OpenClaw**（本地浏览器自动化工具），你可以实现**全自动定时推流**：AI-CMO 负责"找到哪里推、推什么内容"，OpenClaw 负责"用你的账号自动去发"。

## 工作原理

```
AI-CMO API                          OpenClaw (本地)
┌─────────────┐                    ┌─────────────────────┐
│ 1. 分析产品   │ ── CSV 数据 ──→   │ 3. 逐行读取 CSV      │
│ 2. 找推广帖子  │                   │ 4. 打开帖子 URL       │
│    生成话术   │                    │ 5. 自动发评论/回复     │
└─────────────┘                    └─────────────────────┘
     云端 AI 分析                        本地浏览器操作
   (用你的 API Key)                   (用你登录的账号)
```

## 前置条件

1. **AI-CMO 账号**：注册 [aicmo.site](https://aicmo.site) 并充值积分
2. **API Key**：在 AI-CMO「设置 → API 密钥」中创建
3. **OpenClaw**：本地安装并运行
4. **社媒账号**：在本地浏览器中登录 Reddit、Twitter 等你要推流的平台

## 核心 API

### 一步式分析 + CSV 导出（推荐）

```bash
curl -X POST "https://aicmo.site/api/v1/open/analyze/csv" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"product": "https://your-product.com", "language": "en", "max_results": 10}' \
  -o promotions.csv
```

**消耗 1 积分**，返回 CSV 文件，包含：

| 列名 | 用途 |
|------|------|
| URL | OpenClaw 要访问的帖子链接 |
| Suggested Comment | OpenClaw 要发送的评论内容 |
| Platform | 平台名（reddit/youtube/twitter 等） |
| Best Timing | 建议发布时间 |
| Risk Level | 风险等级（low/medium/high） |
| Score | AI 综合评分（越高越值得推） |

### 查询剩余积分

```bash
curl -H "x-api-key: YOUR_API_KEY" "https://aicmo.site/api/v1/open/quota"
```

### JSON 格式分析（如需更多字段）

```bash
curl -X POST "https://aicmo.site/api/v1/open/analyze" \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"product": "your-product.com", "language": "zh"}'
```

## OpenClaw 自动化流程

### 推荐设置

| 参数 | 保守策略 | 稳健策略 | 激进策略 |
|------|---------|---------|---------|
| 执行频率 | 每 2 天一次 | 每天 1 次 | 每天 1-2 次 |
| 每次帖数 | 3-5 条 | 5-8 条 | 8-10 条 |
| 适用场景 | 新账号、初次使用 | 日常运营 | 老号、多账号轮换 |
| 月积分消耗 | ~15 积分 | ~30 积分 | ~45-60 积分 |

### OpenClaw 执行步骤

OpenClaw 拿到 CSV 后，应按以下流程执行：

1. **读取 CSV** — 解析每一行的 URL 和 Suggested Comment
2. **按 Risk Level 排序** — 优先处理 `low` 风险的帖子
3. **逐个打开 URL** — 用本地浏览器访问帖子页面
4. **找到评论框** — 定位页面的回复/评论输入区域
5. **填入评论内容** — 粘贴 `Suggested Comment` 列的内容
6. **提交评论** — 点击发送按钮
7. **等待间隔** — 每条评论之间随机等待 30-120 秒，模拟真人行为
8. **记录结果** — 标记成功/失败，下次跳过已完成的

### 重要安全建议

- **随机间隔**：每条帖子之间等待 30-120 秒（随机），避免被检测为机器人
- **分散时间**：不要集中在一个时间段操作，模拟真人浏览行为
- **先看后评**：打开页面后先等 5-10 秒"阅读"，再发评论
- **内容微调**：建议对 Suggested Comment 做轻微改写（替换同义词），避免千篇一律
- **账号轮换**：如有多个账号，轮换使用，分散风险
- **遵守规则**：关注各平台的 rate limit 和社区规范

## 完整自动化脚本示例

以下是 OpenClaw 可参考的伪代码逻辑：

```python
# 1. 调用 AI-CMO 获取推广数据
import subprocess
subprocess.run([
    "curl", "-X", "POST", "https://aicmo.site/api/v1/open/analyze/csv",
    "-H", "x-api-key: YOUR_API_KEY",
    "-H", "Content-Type: application/json",
    "-d", '{"product": "https://your-product.com", "language": "en", "max_results": 8}',
    "-o", "promotions.csv"
])

# 2. 读取 CSV
import csv
with open("promotions.csv", "r", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    tasks = [row for row in reader if row["Risk Level"] in ("low", "medium")]

# 3. 按评分排序，取前 5 条
tasks.sort(key=lambda x: float(x.get("Score") or 0), reverse=True)
tasks = tasks[:5]

# 4. 逐条执行（OpenClaw 浏览器操作）
import time, random
for task in tasks:
    url = task["URL"]
    comment = task["Suggested Comment"]
    platform = task["Platform"]
    
    # OpenClaw: 打开页面
    openclaw.navigate(url)
    time.sleep(random.uniform(5, 15))  # 模拟阅读
    
    # OpenClaw: 找到评论框并填写
    openclaw.find_comment_box(platform)
    openclaw.type_text(comment)
    openclaw.submit()
    
    # 随机等待 30-120 秒
    time.sleep(random.uniform(30, 120))

print(f"Done! Posted {len(tasks)} comments.")
```

## 定时任务设置

建议将上述流程设置为定时任务：

- **macOS/Linux**: 使用 `cron` — `0 10 * * * /path/to/run_promotion.sh`（每天上午 10 点）
- **Windows**: 使用任务计划程序
- **或直接在 OpenClaw 中配置定时执行**

推荐执行时间：目标用户所在时区的 **上午 9-11 点** 或 **晚上 7-9 点**（高活跃时段）。

## API 完整文档

访问 AI-CMO 平台的「API Docs」页面查看所有可用接口的详细说明：
[https://aicmo.site/api-docs](https://aicmo.site/api-docs)

## 常见问题

**Q: 每次分析消耗多少积分？**
A: 每次调用 `/analyze` 或 `/analyze/csv` 消耗 1 积分。导出历史 CSV 不消耗积分。

**Q: 分析失败会退积分吗？**
A: 会。如果分析过程出错，积分会自动退回。

**Q: CSV 里的帖子都适合评论吗？**
A: AI 已经筛选了最合适的帖子，但建议优先处理 Score 高、Risk Level 为 low 的。

**Q: 多久分析一次比较好？**
A: 建议每 1-2 天分析一次，因为社媒内容更新很快，热帖的时效性有限。
