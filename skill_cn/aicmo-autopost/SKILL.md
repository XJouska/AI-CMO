---
name: aicmo-autopost
description: 端到端社媒营销自动化。当用户希望自动推广产品（通过 URL 或产品名）到 Reddit、YouTube、Twitter/X、Quora、Product Hunt、Hacker News 时使用此 skill。该 skill 会调用 AI-CMO API 对帖子排序并生成定制化评论，然后通过 OpenClaw 驱动用户本地已登录的浏览器，依次访问每个帖子并提交建议的评论。触发词包括："推广我的产品"、"自动发帖到 Reddit/Twitter"、"全自动营销"、"定时推流"、"AI-CMO"、"社媒推广"、"找推广位"。
license: MIT
---

# AI-CMO × OpenClaw — 社媒全自动推流 Skill

这个 skill 把 AI-CMO 的推广分析结果变成**由用户本地浏览器真实发出的评论**。AI-CMO（云端）负责挑选"在哪里推"和"推什么内容"；OpenClaw（本地浏览器）用用户已经登录好的社媒账号完成真正的发帖动作。

> **Base URL：** `https://www.aicmo.site/api/v1/open`
> **鉴权：** 所有请求必须带 `x-api-key: <AICMO_API_KEY>` 请求头。

---

## 快速上手（用户操作） —— 只需 3 步

1. **拿 API Key** —— 到 https://www.aicmo.site 注册 → 设置 → API 密钥 → 创建密钥。把 Key 粘给 OpenClaw（直接发到对话里，或设为环境变量 `AICMO_API_KEY`）。
2. **让 agent 开始推广**，比如说：
   > *"用 aicmo-autopost 推广 https://my-product.com"*
3. **只做两件只有你能做的事**，当 agent 要求时：
   - 在它打开的浏览器窗口里，登录你想推广的社媒平台。
   - 审阅它给出的 Top-5 列表，回复 `是` 开始发帖。

就这么简单。分析、导航、发评论、节奏控制、结果汇总全由 agent 搞定。

---

## Agent 执行流程（必须按顺序完成）

当本 skill 被触发时，agent **必须**带用户走完以下阶段，不得跳过、不得静默合并。

### 阶段 1 — 确认 API Key

1. 检查环境变量 `AICMO_API_KEY`。
2. 如果为空或不存在，原文向用户展示：

   > 我需要一个 AI-CMO API Key 才能继续：
   > 1. 访问 https://www.aicmo.site 注册或登录
   > 2. 进入 **设置 → API 密钥 → 创建密钥**
   > 3. 充值少量积分（每次分析消耗 1 积分，失败会自动退回）
   > 4. 把 Key 粘贴给我，或在 OpenClaw 中设置环境变量 `AICMO_API_KEY`

3. 拿到 Key 后，运行 `scripts/check_quota.sh` 校验。若 `credits_remaining <= 0`，提示用户充值并停止。

### 阶段 2 — 收集产品信息

向用户询问以下信息（任选其一）：

- 产品 URL（推荐，例如 `https://your-product.com`）
- 产品名（例如 `"U2forU YouTube 下载器"`）

可选参数（用户不回答时使用默认值）：

- `language`：默认 `zh`，可选 `en` / `ja` / `ko` / `es` / `fr` / `de` / `pt` / `ru` / `ar`
- `max_results`：默认 `8`（范围 1–20）

### 阶段 3 — 浏览器登录握手（关键步骤，不可跳过）

OpenClaw 会使用**它所控制的浏览器窗口中当前已登录的账号**来发评论。因此在任何发帖动作之前，agent **必须**：

1. 通过 OpenClaw 的浏览器工具打开一个**可见**的浏览器窗口（非 headless，让用户能看到并交互）。
2. 向用户展示下面这份登录清单，并**等用户明确回复"已登录"**后再继续：

   > 请在我刚刚打开的浏览器窗口里，登录你想要推广的所有平台：
   >
   > - [ ] Reddit — https://www.reddit.com/login
   > - [ ] YouTube — https://accounts.google.com
   > - [ ] Twitter / X — https://x.com/login
   > - [ ] Quora — https://www.quora.com
   > - [ ] Product Hunt — https://www.producthunt.com/sign-in
   > - [ ] Hacker News — https://news.ycombinator.com/login
   >
   > 只登录你关心的平台即可。CAPTCHA / 2FA 请你自己完成。完成后回复**"已登录"**。

3. 在用户明确确认前**不要**继续。**绝不**代替用户输入密码（本 skill 不处理账号密码）。

### 阶段 4 — 拉取推广目标

使用第 2 阶段收集到的参数运行 `scripts/fetch_promotions.sh`。脚本会调用 `POST /analyze/csv`，将结果写入当前目录的 `promotions.csv`。**消耗 1 积分**。

解析 CSV（UTF-8 with BOM，逗号分隔）。保留 `Risk Level` 为 `low` 或 `medium` 的行，按 `Score` 降序排列，向用户展示简短摘要：

```
共找到 N 个推广位，按评分 Top 5：
 #1 [reddit]  "帖子标题…"  评分 87  风险 low   → https://…
 #2 [youtube] "…"          评分 82  风险 low   → https://…
 …
确认开始发帖？(是 / 编辑列表 / 取消)
```

让用户**批准、裁剪或修改**列表后再继续。

### 阶段 5 — 自动化发帖循环

对每一行已批准的记录，OpenClaw 的浏览器工具按以下步骤执行：

1. `navigate(url)` — 在已登录的浏览器中打开帖子。
2. `sleep(随机 5–15 秒)` — 模拟阅读。
3. 向下滚动，直到该平台的回复/评论输入框出现在视口中。
4. 点击回复/评论框（各平台定位提示见 `references/platform-selectors.md`）。
5. 输入 `Suggested Comment` 列的内容。**要做拟人化改写**：
   - 替换 1–2 个同义词；
   - 轻微调整标点和大小写；
   这样多次运行不会产出完全相同的文本。
6. 点击提交。
7. 等待 `随机 30–120 秒` 再处理下一条（强制，反垃圾必要项）。
8. 将结果（`posted` / `skipped` / `failed` + 错误信息）记录到 `run-report.json`。

循环结束后向用户汇总：

```
✅ 已发布：4
⚠️  已跳过（找不到评论框）：1
❌ 失败（被限流）：0
详情见 run-report.json
```

### 安全红线（agent 必须强制执行）

- 单次运行**最多发 10 条评论**，不论 CSV 有多少行。
- **同一 URL 一周内不得重复发帖**（有 `run-report.json` 则检查历史）。
- **绝不自动绕过 CAPTCHA** —— 出现时暂停，让用户手动处理。
- **绝不读取或外传用户的 Cookie / Session Token。** 浏览器上下文归 OpenClaw 管，本 skill 只做 UI 操作。
- **遵守平台规则。** 如果某个子版块侧边栏禁止自我推广，跳过并记录原因。

---

## 本 skill 提供的脚本

| 脚本 | 作用 |
|---|---|
| `scripts/check_quota.sh` | 调 `GET /quota`，打印剩余积分或返回非零退出码 |
| `scripts/fetch_promotions.sh` | 调 `POST /analyze/csv`，输出 `promotions.csv` |

两者都从环境变量读取 `AICMO_API_KEY`，使用方式见各脚本文件顶部注释。

## 参考资料（按需加载）

- `references/api.md` — 完整 REST API 参考（所有接口、字段、错误码）
- `references/platform-selectors.md` — 各平台回复输入框与提交按钮的 DOM 提示

## 常见问题

**分析会扣积分吗？** 会，每次 `/analyze` 或 `/analyze/csv` 消耗 1 积分。通过 `/history/{id}/csv` 导出历史结果免费。

**分析失败怎么办？** 服务端会自动退回该次积分。

**可以定时运行吗？** 可以 —— 在 OpenClaw 的调度器里配置即可。建议频率：每 1–2 天一次；社媒内容时效性衰减很快。
