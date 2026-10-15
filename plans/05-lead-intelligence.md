# 05 · 商机情报引擎

> 目标：根据企业产品，定时在外网搜索采购需求、招标、RFQ、潜在买家，经过 AI 评分、去重和人工复核后，交付「可跟进的商机」。这是产品的核心价值和长期壁垒。
> 结束状态：试点客户每天能收到经过复核的商机，每条商机有来源链接、匹配理由和建议动作。

---

## 1. 范围

**包含**：数据源连接器框架、监控计划、任务调度、抓取加固、AI 意图识别与评分、去重、企业信息补全、人工复核队列、「商机」Tab、对应助手工具。
**不包含**：开发信与跟进（计划 06）、计费限额（计划 07）。

---

## 2. 核心概念

| 概念 | 说明 |
|---|---|
| 监控计划（Watch） | 一组产品 + 目标市场 + 关键词 + 数据源 + 频率 |
| 信号（Signal） | 从数据源抓到的一条原始记录（招标公告、RFQ、论坛求购帖、新闻、企业名录条目） |
| 商机（Lead） | 经过评分、去重、补全后，值得跟进的机会；一个商机可关联多个信号 |
| 买家（Buyer） | 商机背后的采购组织，跨商机复用 |

---

## 3. 数据模型

| 表 | 关键字段 |
|---|---|
| `watches` | id, company_id, name, product_ids[], markets[], keywords_en[], negative_keywords[], source_keys[], frequency, is_active, last_run_at |
| `watch_runs` | id, watch_id, status, started_at, finished_at, stats(JSON), error |
| `signals` | id, company_id, watch_run_id, source_key, url, url_hash, title, snippet, raw(JSON), published_at, fetched_at |
| `buyers` | id, name, domain, country, industry, size_hint, public_contacts(JSON), sources[] |
| `leads` | id, company_id, buyer_id, type(`tender` / `rfq` / `buyer_intent` / `prospect` / `site_inquiry`), title, summary_cn, products_matched[], score, score_detail(JSON), deadline, status, review_status(`pending` / `approved` / `rejected`), reviewer_id, created_at |
| `lead_signals` | lead_id, signal_id |
| `lead_feedback` | lead_id, user_id, verdict(`useful` / `irrelevant` / `duplicate` / `fake`), note |
| `source_configs` | source_key, enabled, rate_limit, terms_note, requires_api_key |

---

## 4. 数据源（连接器）

每个连接器实现统一接口：`search(query, market, since) -> list[RawSignal]`，并声明速率限制和合规说明。

### 4.1 首批数据源（按优先级）

| 数据源 | 类型 | 方式 | 说明 |
|---|---|---|---|
| 搜索引擎 | 采购意图 | 官方搜索 API（如 Bing / Google Programmable Search / SerpAPI 类服务） | 用「产品词 + RFQ / tender / looking for supplier / distributor wanted」等意图词组合查询 |
| 公开招标平台 | 招标 | 官方 API 或 RSS 优先，其次页面抓取 | 例如欧盟 TED、联合国全球采购市场、世界银行采购公告、各国政府采购网；按目标市场选择 |
| B2B 求购信息 | RFQ | 公开页面 | 只抓取公开、条款允许的求购页面 |
| 行业新闻 | 买家动态 | RSS / 搜索 | 扩产、新项目、新工厂等可能产生采购的事件 |
| 展会参展商名录 | 潜在买家 | 公开名录 | 用于主动开发 |
| 官网询盘 | 询盘 | 计划 04 回流 | 优先级最高 |

### 4.2 合规规则（强制）

- 优先使用官方 API、RSS、开放数据；页面抓取前检查 `robots.txt`
- 不抓取需要登录的内容，不绕过验证码；**不抓取 LinkedIn**
- 每个数据源设置速率限制，并在 `source_configs.terms_note` 中记录条款依据
- 联系人只采集企业公开的联系方式（官网公布的邮箱、电话），保留来源链接
- 提供数据删除通道（计划 07）

### 4.3 抓取加固

- 所有请求经过 `safe_fetch`（SSRF 防护）
- `browser.py` 中 Playwright 访问前同样校验目标地址；禁止访问 `file://`、`data:` 等协议；拦截页面中发往内网地址的子请求
- 浏览器运行在独立的 `worker` 容器，非 root，无 API 数据库凭据之外的权限

---

## 5. 处理流水线

```
Watch 到期
  → 查询规划：LLM 根据产品与市场生成查询组合（英文 + 目标市场语言）
  → 各连接器并发抓取 → signals（按 url_hash 去重）
  → 意图分类：是否为真实采购需求 / 招标 / 潜在买家 / 无关
  → 匹配评分（0–100）
  → 买家识别与去重（域名、名称相似度）
  → 企业信息补全：通过 safe_fetch 访问买家官网，抽取国家、行业、规模、公开联系方式
  → 生成中文摘要、匹配理由、建议切入点
  → 进入人工复核队列（试点期全部复核；之后高分自动通过，低置信度进入复核）
  → 推送给企业
```

### 5.1 评分维度

| 维度 | 权重 | 说明 |
|---|---|---|
| 产品匹配度 | 0.35 | 需求与企业产品、HS 编码、规格的匹配 |
| 采购意图明确度 | 0.25 | 明确 RFQ / 招标 > 寻找供应商 > 行业动态 |
| 时效性 | 0.15 | 发布时间、截止日期 |
| 订单潜力 | 0.10 | 数量、项目规模、买家规模 |
| 可触达性 | 0.10 | 是否有公开联系方式或投标入口 |
| 可信度 | 0.05 | 来源权威性、信息完整度 |

评分结果保存 `score_detail`，并用 `lead_feedback` 和计划 06 的跟进结果持续校准提示词和权重。

### 5.2 调度

- `worker` 进程中 APScheduler 按 Watch 频率生成任务，写入任务表
- 执行器通过 `SELECT ... FOR UPDATE SKIP LOCKED` 领取任务，支持多实例
- 单企业单次运行设置上限（查询数、抓取页数、LLM 调用数），防止成本失控

---

## 6. 后端接口与助手工具

### 6.1 接口

- `GET/POST/PATCH /watches`、`POST /watches/{id}/run`
- `GET /leads`（筛选：状态、类型、市场、分数区间、时间）、`GET /leads/{id}`
- `POST /leads/{id}/feedback`
- 运营接口（需 staff）：`GET /ops/review-queue`、`POST /ops/leads/{id}/review`

### 6.2 助手工具

| 工具 | 说明 |
|---|---|
| `watch.create_from_profile` | 根据档案自动生成监控计划草稿（需确认） |
| `watch.update` | 修改关键词、市场、频率 |
| `lead.search` | 「看看德国的阀门招标」→ 查询已有商机 |
| `lead.explain` | 解释为什么推荐某条商机 |
| `lead.run_now` | 立即执行一次监控 |

助手中的商机以 `LeadCard` 卡片展示（见 7.3）。

---

## 7. 前端任务（「商机」Tab）

### 7.1 列表页

```
NavBar（标题「商机」，右侧筛选）
├── Tab：全部 / 招标 / 求购 / 潜在买家 / 官网询盘
├── 今日概览（新增数、待跟进数）
├── 商机列表（LeadCard）
└── TabBar selected="Tab 2"
```

- 下拉刷新、分页加载
- 筛选使用 `BottomSheet`：市场、分数、状态、截止日期
- 新商机显示 `BadgeDot`；TabBar 商机图标显示未读数

### 7.2 详情页

- 标题、类型 `Tag`、分数、截止日期
- 「为什么推荐」：匹配理由（`Markdown` OL）
- 需求原文摘要 + 来源链接（显示域名，外链确认后打开）
- 买家信息：名称、国家、行业、规模、公开联系方式
- 评分明细（各维度）
- 底部操作：「写开发信」（计划 06）、「标记状态」、「反馈」（有用 / 不相关 / 重复 / 虚假，`ActionSheet`）

### 7.3 `LeadCard`

正式组件组合：`Card` + `Tag`（类型）+ `Status`（跟进状态）+ 标题 + 国家 / 截止日期 + 分数。若正式组件无法满足分数展示，自建 `ScoreBadge` 并登记到 `docs/ui-gaps.md`。

### 7.4 监控设置（「我的」→ 商机监控设置）

- 监控计划列表，`ListTrailingSwitch` 启用 / 停用
- 编辑：产品多选、市场多选、关键词（AI 推荐 + 手动增删）、排除词、频率
- 显示最近运行时间和结果统计

### 7.5 状态覆盖

- 未设置监控：`EmptyPage` + 「一键根据档案创建监控」
- 监控中但暂无商机：`EmptyPage` 说明预计首批商机时间
- 加载失败：`EmptyPage type="networkError"`

---

## 8. 质量评估

1. 建立评测集：为 2 个试点行业各人工标注 200 条信号（是否为有效商机、匹配度）。
2. 指标：意图分类准确率、Top 20 商机有效率、重复率、虚假率。
3. 每次修改提示词或评分规则后跑评测集，指标不得下降。
4. 目标（试点期）：Top 20 有效率 ≥ 60%，重复率 ≤ 5%。

---

## 9. 验收标准

- [ ] 为一家试点工厂创建监控，24 小时内产出 ≥ 20 条经复核的商机
- [ ] 每条商机有可访问的来源链接、中文摘要、匹配理由
- [ ] 同一采购需求在多个来源出现时合并为一条商机
- [ ] 官网询盘自动成为 `site_inquiry` 类型商机
- [ ] 运营复核队列可用，被驳回的商机用户不可见
- [ ] SSRF 测试：监控关键词或买家网址指向内网时被拒绝
- [ ] 单企业单次运行的成本上限生效
- [ ] 评测集指标达到目标
