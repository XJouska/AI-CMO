# AI 舆情监测平台 · 完整开发复现文档

> **项目代号**：AI-Sentinel（原 AI-CMO，已转型为舆情监测产品）
> **核心定位**：用户输入 关键词 / 产品名称 / 网址 / 描述 → AI Agent 自动在各大社交平台（Reddit、YouTube、Twitter/X、Quora、HackerNews、ProductHunt、Google）搜索相关讨论 → 输出 **舆情报告**（情感分布、声量、热点话题、关键观点、危机预警、建议回应）
> **技术栈**：FastAPI + React 19 + TypeScript + PostgreSQL 15 + Playwright + OpenAI/Qwen 兼容接口
> **部署**：Docker Compose（一键启动 db / backend / frontend）
>
> 本文档是**唯一权威**复现指南，任何 AI 模型只需按本文档实施即可得到一个可运行、可部署的舆情监测产品。

---

## 0. 阅读指引

本文档分四大部分：

| 章节 | 用途 |
|------|------|
| §1 产品定义 | 业务目标、核心用户故事、与营销类产品的差异 |
| §2 系统架构 | 模块划分、数据流、并行优化 |
| §3 实施手册 | 从空仓库到可运行的完整步骤 |
| §4 核心代码骨架 | 关键文件的真实可运行片段 |
| §5 部署运维 | Docker、Nginx、HTTPS、日志、计费 |
| §6 验证清单 | 复现完成后如何自检 |

---

## 1. 产品定义（务必先读）

### 1.1 业务目标

为品牌、产品、个人、行业关键词在**全球主流社交媒体**上提供**实时舆情监测**：

- **声量监测**：某关键词在 Reddit / YouTube / Twitter / HN / Quora 上的讨论密度
- **情感分析**：每条相关内容的情感倾向（正面 / 中性 / 负面）和强度
- **热点追踪**：当前 24 小时 / 7 天 / 30 天内最热的相关讨论
- **关键观点提取**：用户在抱怨什么？在称赞什么？提到了哪些竞品？
- **危机预警**：识别"高传播 + 强负面"内容，标注为**红色风险**
- **建议回应**：对值得回应的帖子，给出"以一个真实用户口吻 + 客观中立"的建议回复（非硬广）

### 1.2 与"营销推广"产品的根本差异

| 维度 | 营销推广（旧版） | 舆情监测（本版） |
|------|----------------|----------------|
| 目标 | 找到能推广产品的位置 | 找到正在讨论该主体的内容 |
| 评分核心 | promotion_potential（推广潜力） | sentiment_intensity（情感强度）+ virality（传播力） |
| 输出形式 | 营销话术、周计划、KPI | 舆情报告：情感分布饼图、热点关键词、风险等级、关键观点摘要 |
| 风险定义 | "我去发广告会被封吗" | "这条负面会扩散吗，需要回应吗" |
| 数据消费方 | 增长 / 内容运营 | 公关 / 品牌 / 客户成功 / 创始人 |

> **写代码、写 prompt、写文案时务必牢记上面这张对比表。**

### 1.3 用户故事（MVP）

1. **品牌方监测**：用户输入 `Notion`，系统返回过去 1 年里所有平台上关于 Notion 的讨论，按情感分布、热度、风险给出全景报告。
2. **关键词监测**：用户输入 `AI 写作工具`，系统返回该领域当前的讨论热点、用户痛点、被频繁提及的产品。
3. **网址监测**：用户输入自家产品网站，系统先抓取页面识别出主体，然后开始监测。
4. **危机回应**：用户在结果列表中看到一条"高传播 + 强负面"贴子，点开看建议回应文案，可一键复制后人工到原平台回应。

---

## 2. 系统架构

### 2.1 总体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                Frontend (React 19 + Vite + TypeScript)           │
│   监测仪表盘 · SSE 实时流式 · 情感分布图 · 风险高亮 · i18n        │
└──────────────────────────┬───────────────────────────────────────┘
                           │ SSE(EventSource via fetch ReadableStream) / REST
┌──────────────────────────▼───────────────────────────────────────┐
│                       Backend (FastAPI)                          │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────────────────┐   │
│  │ Auth API│ │Monitor API│ │ Pay API │ │ History / Admin API  │   │
│  └─────────┘ └─────┬────┘ └─────────┘ └──────────────────────┘   │
│                    │                                              │
│         ┌──────────▼──────────────────────────────────────┐       │
│         │       AI Agent Workflow Engine（核心）          │       │
│         │                                                 │       │
│         │  Phase A : 主体识别 + 搜索策略（合并单次 LLM）    │       │
│         │            └─ URL 抓取与 LLM 并行                │       │
│         │  Phase B : 分布式爬取（Sem=5，L1 流式管道）       │       │
│         │            └─ 阻塞平台自动 Google site: 兜底     │       │
│         │  Phase C : 舆情评分（分批并行 LLM）              │       │
│         │  Phase D : 深度分析（情感+观点+风险，2批并行）    │       │
│         │  Phase E : 总报告（情感分布、热点、危机、建议回应）│       │
│         └─────────────────────────────────────────────────┘       │
│                    │                                              │
│         ┌──────────▼─────────┐                                    │
│         │     PostgreSQL     │                                    │
│         └────────────────────┘                                    │
└────────────────────────────────────────────────────────────────────┘
                           │
              ┌────────────▼─────────────────────┐
              │   Local Playwright (持久化 Profile)│
              │   + httpx 兜底（HTTP/HTML 解析）   │
              │   TTLCache(maxsize=500, ttl=3600) │
              └──────────────────────────────────┘
```

### 2.2 五阶段流水线（与代码 100% 对应）

| 阶段 | 节点 | LLM 调用数 | 关键产物 | 主要文件 |
|-----|------|----------|---------|---------|
| A | 主体识别 + 搜索策略合并 | 1 | `profile`, `search_tasks` | `prompts/node1_product_analysis.py` |
| B | 分布式爬取 | 0 | 各平台原始帖子列表 | `services/browser_service.py` + `utils/parsers.py` |
| C | 舆情评分（分批） | 1~3（并行） | 每条 `composite_score` + 5 维度 | `prompts/node4_scoring.py` |
| D | 深度分析（Top N 拆 2 批） | 2（并行） | 情感、观点、风险等级 | `prompts/node5_deep_analysis.py` |
| E | 综合报告 | 2 | 情感分布、热点、危机、建议回应 | `prompts/node6_strategy.py` |

完整管道在 `backend/app/services/workflow.py::AnalysisWorkflow.run()` 内实现，通过 SSE（`sse_starlette.EventSourceResponse`）流式输出 8 类事件。

### 2.3 SSE 事件协议

| event | data 结构 | 触发时机 |
|-------|----------|---------|
| `status` | `{step: 1~6, message: str}` | 进入新阶段 |
| `detail` | `{message: str}` | 子步骤进度（要给到前端"AI 正在做什么"的实时感） |
| `thinking` | `{content: str}` | LLM 输出的关键中间结论（如已识别监测主体） |
| `product_info` | `{title, content, product_name, product_type, description, target_audience}` | URL 抓取完成后 |
| `platform_done` | `{platform: str, count: int}` | 单个平台爬取完成 |
| `result` | `Recommendation` 完整对象 | 每条监测结果（按 rank 顺序） |
| `strategy` | `OverallStrategy` 完整对象 | 综合舆情报告 |
| `done` | `{total_found, platforms_searched, recommendations_count, estimated_reach}` | 流程结束 |
| `error` | `{message}` | 出错（自动退积分） |

### 2.4 性能优化（务必落地）

- **Node1 + Node2 合并**：单次 LLM 调用同时输出 `profile` 与 `search_tasks`，省一轮 roundtrip
- **URL 抓取与 LLM 预判并行**：`asyncio.gather(scrape_task, llm_pre_analysis)`
- **httpx 连接池**：`max_keepalive=10, keepalive_expiry=30`，避免每次握手
- **Playwright 持久化 Profile**：`launch_persistent_context` 复用 cookies，应对 Cloudflare
- **空闲自动关闭浏览器**：3 秒无活跃 page 后自动 teardown
- **TTLCache**：URL 抓取结果缓存 1 小时
- **失败兜底**：被 Cloudflare 拦截 → 自动改走 `https://www.google.com/search?q=site:xxx.com+keyword`，配合 `parse_google_site_results`
- **任意平台失败不影响整体**：`asyncio.as_completed` 先到先处理

---

## 3. 实施手册（从零到可运行）

### 3.1 目录结构（必须严格按此创建）

```
ai-sentinel/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py            # 注册/登录/Google OAuth/获取/退出
│   │   │   ├── chat.py            # /api/v1/chat/analyze (SSE 主入口)
│   │   │   ├── credits.py         # 积分充值/查询/LemonSqueezy webhook
│   │   │   ├── history.py         # 历史会话
│   │   │   ├── dashboard.py       # 仪表盘统计
│   │   │   ├── feedback.py        # 反馈
│   │   │   ├── geo.py             # GEO 可见度（保留扩展）
│   │   │   ├── seo.py             # SEO 健康（保留扩展）
│   │   │   ├── competitors.py     # 竞品库
│   │   │   ├── content.py         # AI 内容生成
│   │   │   ├── ai_chat.py         # 自由聊天
│   │   │   ├── terminal.py        # 实时活动流
│   │   │   ├── admin.py           # 管理员后台
│   │   │   └── open_api.py        # 开放 API（用户自有 sk-cmo-* key）
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── llm.py             # OpenAI 兼容客户端 + JSON 模式 + 缓存
│   │   │   ├── browser_service.py # Playwright + httpx 兜底
│   │   │   ├── workflow.py        # 五阶段管道（核心）
│   │   │   ├── content_writer.py  # AI 写作（评论 / 帖子 / 博客）
│   │   │   ├── geo_service.py     # GEO 可见度
│   │   │   ├── seo_service.py     # SEO 健康
│   │   │   └── scheduler.py       # APScheduler 定时任务
│   │   ├── prompts/
│   │   │   ├── __init__.py
│   │   │   ├── node1_product_analysis.py
│   │   │   ├── node4_scoring.py
│   │   │   ├── node5_deep_analysis.py
│   │   │   └── node6_strategy.py
│   │   ├── middleware/
│   │   │   ├── __init__.py
│   │   │   └── auth_middleware.py
│   │   └── utils/
│   │       ├── __init__.py
│   │       ├── sse.py             # SSEEvent 数据类
│   │       └── parsers.py         # 各平台解析器（Reddit/YouTube/Twitter/Quora/HN/PH/Google）
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ChatInterface.tsx
│   │   │   ├── ActionList.tsx       # 监测结果列表
│   │   │   ├── RecommendCard.tsx    # 单条监测卡片（带情感色）
│   │   │   ├── StrategyPanel.tsx    # 舆情报告面板
│   │   │   ├── LoadingSteps.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── LoginModal.tsx
│   │   │   ├── PricingModal.tsx
│   │   │   ├── ThemeToggle.tsx
│   │   │   ├── AIChatPanel.tsx
│   │   │   ├── ContentWriter.tsx
│   │   │   ├── ValueBanner.tsx
│   │   │   ├── ActivityFeed.tsx
│   │   │   ├── TerminalPanel.tsx
│   │   │   └── TerminalLog.tsx
│   │   ├── pages/
│   │   │   ├── LandingPage.tsx
│   │   │   ├── AnalyzePage.tsx       # 监测主页
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── CompetitorsPage.tsx
│   │   │   ├── GEOPage.tsx
│   │   │   ├── SEOPage.tsx
│   │   │   ├── SettingsPage.tsx
│   │   │   ├── PricingPage.tsx
│   │   │   ├── AdminPage.tsx
│   │   │   └── APIDocsPage.tsx
│   │   ├── stores/
│   │   │   ├── authStore.ts        # zustand
│   │   │   ├── analysisStore.ts    # 持久化到 localStorage
│   │   │   ├── historyStore.ts
│   │   │   └── dashboardStore.ts
│   │   ├── layouts/MainLayout.tsx
│   │   ├── styles/globals.css      # CSS Variables 双主题
│   │   ├── i18n/{en.json, zh.json, index.ts}
│   │   ├── types/index.ts
│   │   ├── api.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig*.json
│   ├── nginx.conf
│   └── Dockerfile
├── docker-compose.yml
├── deploy.sh
├── .env
└── .gitignore
```

### 3.2 环境变量（.env）

```env
# ====================================================================
# DATABASE
# ====================================================================
DATABASE_URL=postgresql://ai_cmo:ai_cmo_pass@localhost:5432/ai_cmo

# ====================================================================
# AUTH
# ====================================================================
SECRET_KEY=replace_with_random_64bytes
GOOGLE_CLIENT_ID=                     # Google OAuth 可选

# ====================================================================
# LLM（OpenAI 兼容接口，可换 Qwen / DeepSeek / Moonshot 等）
# ====================================================================
QWEN_API_KEY=sk-...                   # 实际是任何 OpenAI 兼容 key
QWEN_API_BASE=https://api.openai.com/v1
QWEN_MODEL=gpt-4o-mini                # 或 qwen-max-latest / deepseek-chat

# ====================================================================
# Local Playwright Browser
# ====================================================================
BROWSER_PROFILE_DIR=/app/browser-profiles/default
BROWSER_HEADLESS=true
BROWSER_PROXY=                        # 留空走直连，可填 http://host:port

# ====================================================================
# 支付（可选）
# ====================================================================
LEMONSQUEEZY_API_KEY=
LEMONSQUEEZY_WEBHOOK_SECRET=
ALIPAY_APP_ID=
ALIPAY_PRIVATE_KEY_PATH=
ALIPAY_PUBLIC_KEY_PATH=

# ====================================================================
# 应用
# ====================================================================
CORS_ORIGINS=http://localhost:5173,http://localhost:9010
LOG_LEVEL=INFO
FREE_ANALYSIS_LIMIT=1
PREMIUM_TOP_N=10
FREE_TOP_N=3

# ====================================================================
# Frontend
# ====================================================================
VITE_API_URL=http://localhost:9001
VITE_GOOGLE_CLIENT_ID=
```

### 3.3 后端依赖（requirements.txt）

```text
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
sqlalchemy>=2.0.0
asyncpg>=0.29.0
psycopg2-binary>=2.9.0
pydantic-settings>=2.0.0
pydantic[email]>=2.0.0
httpx>=0.27.0
openai>=1.50.0
sse-starlette>=2.0.0
python-multipart>=0.0.9
python-dotenv>=1.0.0
cachetools>=5.0.0
playwright==1.51.0
apscheduler>=3.10.0
google-auth>=2.0.0
requests>=2.28.0
```

### 3.4 前端依赖（package.json 摘要）

```json
{
  "dependencies": {
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-router-dom": "^7.13.1",
    "zustand": "^5.0.12",
    "axios": "^1.13.6",
    "i18next": "^25.8.20",
    "react-i18next": "^16.5.8",
    "i18next-browser-languagedetector": "^8.2.1",
    "lucide-react": "^0.577.0",
    "recharts": "^3.8.0",
    "react-markdown": "^10.1.0"
  },
  "devDependencies": {
    "vite": "^8.0.1",
    "typescript": "~5.9.3",
    "@vitejs/plugin-react": "^6.0.1"
  }
}
```

### 3.5 数据库表（PostgreSQL，由 SQLAlchemy `Base.metadata.create_all` 自动创建）

| 表名 | 主要字段 | 用途 |
|------|---------|-----|
| `users` | id, username, email, password_hash, is_premium, is_admin, credit_balance, response_language, brand_voice, primary_url, referral_code, referred_by, created_at | 账号与个人偏好 |
| `sessions` | id, user_id, token, expires_at | Session token（7 天） |
| `conversations` | id(UUID), user_id, title, input_type(`url`/`keyword`), input_value, product_profile(JSON), status(`analyzing`/`completed`/`failed`/`cancelled`), credits_consumed | 一次监测任务 |
| `recommendations` | id, conversation_id, rank, platform, url, title, engagement_stats(JSON), composite_score, scoring_detail(JSON), why_recommend, sentiment, sentiment_confidence, risk_level, risk_note, suggested_response, response_strategy, is_premium_only | 单条监测结果（含情感判定） |
| `overall_strategies` | id, conversation_id, sentiment_distribution(JSON), hot_topics(JSON), pain_points(JSON), competitor_mentions(JSON), platform_breakdown(JSON), crisis_alerts(JSON), priority_actions(JSON), kpi_targets(text) | 综合舆情报告 |
| `payment_orders` | id, user_id, order_number, amount, credit_amount, status | LemonSqueezy/Alipay 订单 |
| `credit_transactions` | id, user_id, type(`recharge`/`consume`/`refund`), amount, balance_after, description | 积分流水 |
| `user_api_keys` | id, user_id, key_hash, key_prefix(`sk-cmo-...`), name, is_active | 开放 API 密钥 |
| `product_profiles` | id, user_id, name, url, description, brand_voice, target_audience, is_primary | 监测主体库（自动收集） |
| `competitors` | id, user_id, name, url, description | 竞品库 |
| `seo_health_snapshots` | … | SEO 扩展 |
| `geo_visibility` | … | GEO 扩展 |
| `recommendation_feedbacks` | id, recommendation_id, user_id, is_useful, comment | 用户反馈 |
| `activity_feeds` | id, user_id, event_type, title, detail | 活动流 |
| `chat_messages` | id, user_id, conversation_id, role, content | 自由聊天历史 |

> **注意**：相比旧版"营销"表，本版字段从 `suggested_comment / comment_strategy / promotion_potential` 改为 `suggested_response / response_strategy / sentiment / sentiment_confidence`，并新增 `crisis_alerts / sentiment_distribution`。

---

## 4. 核心代码骨架

### 4.1 `backend/app/services/llm.py`（OpenAI 兼容 + 连接池 + JSON 模式 + 缓存）

```python
import json, asyncio, logging
from typing import AsyncGenerator, Optional
import httpx
from openai import AsyncOpenAI
from cachetools import TTLCache
from app.config import settings

logger = logging.getLogger(__name__)

class LLMService:
    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=settings.qwen_api_key,
            base_url=settings.qwen_api_base,
            http_client=httpx.AsyncClient(
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10, keepalive_expiry=30),
                timeout=httpx.Timeout(90.0, connect=5.0),
            ),
        )
        self._cache = TTLCache(maxsize=100, ttl=3600)

    async def chat(self, messages, stream=False, json_mode=False, max_tokens=4096) -> str:
        kwargs = {"model": settings.qwen_model, "messages": messages,
                  "temperature": 0.3, "max_tokens": max_tokens}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        for attempt in range(3):
            try:
                resp = await self.client.chat.completions.create(**kwargs)
                return resp.choices[0].message.content
            except Exception as e:
                logger.warning(f"LLM attempt {attempt+1} failed: {e}")
                if attempt == 2: raise
                await asyncio.sleep(attempt + 1)

    async def chat_json(self, messages, cache_key=None, max_tokens=4096) -> dict:
        if cache_key and cache_key in self._cache:
            return self._cache[cache_key]
        content = await self.chat(messages, json_mode=True, max_tokens=max_tokens)
        try:
            result = json.loads(content)
        except json.JSONDecodeError:
            import re
            m = re.search(r'```(?:json)?\s*([\s\S]*?)```', content)
            result = json.loads(m.group(1).strip()) if m else {"error": "parse_failed", "raw": content[:1000]}
        if cache_key: self._cache[cache_key] = result
        return result

_llm = None
def get_llm_service() -> LLMService:
    global _llm
    if _llm is None: _llm = LLMService()
    return _llm
```

### 4.2 `backend/app/services/browser_service.py`（Playwright 持久化 + httpx 兜底）

要点：
1. `launch_persistent_context` 用同一个 user_data_dir，复用 cookie / cache，绕过 Cloudflare
2. `_page_sem = Semaphore(12)` 控制并发 page 数
3. `goto(url, wait_until="networkidle", timeout=25s)`，失败降级 `domcontentloaded`
4. 提取 `document.body.innerText` 作为 markdown，提取所有 `a[href].slice(0,100)` 作为 links
5. **空闲自动关闭**：`_active_pages` 归零后 3 秒内未再开 page → `_teardown_inner()` 释放资源
6. **httpx 兜底**：Playwright 失败或 markdown 长度 < 50 → `_httpx_fallback`，正则解析 `<title>`、`<meta>`、所有 `<a>`
7. **结果缓存**：`TTLCache(maxsize=500, ttl=3600)`，key = MD5(url)

### 4.3 `backend/app/services/workflow.py`（五阶段管道）

骨架：

```python
class AnalysisWorkflow:
    def __init__(self):
        self.llm = get_llm_service()
        self.browser = get_browser_service()

    async def run(self, user_input, user_id, response_language="en",
                  brand_voice="", conv_id="") -> AsyncGenerator[SSEEvent, None]:
        # 注入用户偏好语言
        self._lang_instruction = f"\n\nIMPORTANT: write all output in {LANG_NAMES[response_language]}, but search URL keywords stay in English."

        # === A. 主体识别 + 搜索策略 ===
        yield SSEEvent("status", {"step": 1, "message": "🔍 正在识别监测主体..."})
        profile, search_tasks, title, content = await self._optimized_node1_node2(user_input)
        if title or content:
            yield SSEEvent("product_info", {"title": title, "content": content[:500],
                                            "product_name": profile.get("product_name", user_input),
                                            "product_type": profile.get("product_type", ""),
                                            "description": profile.get("core_value_proposition", ""),
                                            "target_audience": profile.get("target_audience", [])})
        yield SSEEvent("thinking", {"content": f"✅ 监测主体: {profile.get('product_name')}"})

        # === B. 分布式爬取 ===
        yield SSEEvent("status", {"step": 2, "message": f"📡 已生成搜索策略，覆盖 {len(search_tasks)} 个平台"})
        yield SSEEvent("status", {"step": 3, "message": "🌐 正在跨平台抓取讨论..."})
        all_results = []
        async for ev in self._optimized_node3(search_tasks):
            if ev.event == "scrape_results":
                all_results.extend(ev.data)
            else:
                yield ev
        if not all_results:
            yield SSEEvent("error", {"message": f"未找到关于 \"{profile.get('product_name')}\" 的讨论。请尝试更知名的关键词。"})
            yield SSEEvent("done", {"total_found": 0})
            return

        # === C/D/E. 评分 + 深度分析 + 综合报告 ===
        yield SSEEvent("status", {"step": 4, "message": f"🧮 正在评估 {len(all_results)} 条内容的舆情维度..."})
        recommendations, strategy, extras = await self._optimized_node4_5_6(all_results, profile)
        for i, r in enumerate(recommendations):
            r["rank"] = i + 1
            r["is_premium_only"] = i >= 3
            yield SSEEvent("result", r)
        for i, r in enumerate(extras[:20]):
            r["rank"] = len(recommendations) + i + 1
            r["is_premium_only"] = True
            r["is_extra"] = True
            yield SSEEvent("result", r)

        yield SSEEvent("status", {"step": 6, "message": "📋 综合舆情报告已生成"})
        yield SSEEvent("strategy", strategy)

        # 估算"等价覆盖"（旧版叫 ad_value，本版叫 estimated_reach）
        reach = sum((r.get("engagement_stats") or {}).get("views", 0) for r in recommendations)
        yield SSEEvent("done", {
            "total_found": len(all_results),
            "platforms_searched": len(set(r["platform"] for r in all_results)),
            "recommendations_count": len(recommendations),
            "estimated_reach": reach,
        })
```

### 4.4 提示词（核心：决定产品调性）

#### Node1+2：主体识别 + 搜索策略

System prompt 必须包含：

```
You are an expert public-opinion (sentiment-monitoring) analyst.
Given a keyword / product / brand / URL, output:
1. profile  : a normalized "monitoring subject" descriptor
2. search_tasks: a multi-platform query plan to surface real discussions
   (NOT promotion opportunities — we are LISTENING, not advertising)

CRITICAL RULES:
- ALL search URLs MUST use ENGLISH keywords; non-English keywords return zero on Reddit/YT/HN.
- Always include time filters (Reddit &t=year, YouTube &sp=EgIIBQ%3D%3D, HN &dateRange=pastYear).
- Cover both POSITIVE and NEGATIVE angles in queries:
    e.g. "Notion review", "Notion alternative", "Notion problems", "Notion vs Obsidian"
  This is essential for unbiased opinion sampling.
- Generate 2-3 URLs per platform.
- For brand monitoring: prioritize Reddit + Twitter + Quora.
- For tech/dev tools: add HackerNews + ProductHunt.
- For consumer products: add YouTube.

Output JSON: { "profile": {...}, "search_tasks": [...] }
```

profile 形如：

```json
{
  "product_name": "Notion",
  "product_type": "SaaS / Productivity",
  "target_audience": ["Knowledge workers", "Students"],
  "core_value_proposition": "All-in-one workspace",
  "keywords": ["notion", "notion ai", "notion alternative"],
  "competitor_hints": ["Obsidian", "Roam Research", "Anytype"],
  "language": "en",
  "industry_tags": ["productivity", "note-taking"]
}
```

#### Node4：舆情评分（5 维度）

每条内容 0~100 分，加权得 `composite_score`：

```
- volume_score        : 互动量（点赞、评论、观看）        权重 0.20
- recency_score       : 时效性                            权重 0.15
- relevance_score     : 与监测主体的相关度                权重 0.30  ← 高权重
- sentiment_intensity : 情感强度（极端正/极端负 → 高分）  权重 0.20
- influence_score     : 作者/平台影响力                   权重 0.15
```

System prompt 关键句：

```
You are a sentiment / public-opinion analyst.
Score each item on 5 dimensions (0-100).
sentiment_intensity should be HIGH when the post is strongly emotional
(highly positive OR highly negative), LOW when neutral/factual.
We want to surface the most *opinion-rich* items, not the most promotable ones.
Also tag each item with sentiment ∈ {"positive","neutral","negative"}.
```

#### Node5：深度分析（情感 + 观点 + 风险）

每个 Top 条目输出：

```json
{
  "rank": 1,
  "url": "原始 URL（必须照搬，不得编造）",
  "platform": "reddit",
  "title": "原始标题",
  "engagement_stats": {"upvotes": 0, "comments": 0, "views": 0},
  "sentiment": "positive | neutral | negative",
  "sentiment_confidence": 0.92,
  "key_opinions": ["3-5 个核心观点 bullet"],
  "why_recommend": "3-5 句解释为什么这条值得关注（声量大？情绪强烈？危机信号？）",
  "estimated_reach": "10k-50k 浏览级别的预估传播覆盖",
  "best_timing": "建议回应时机（24h 内 / 72h 内 / 一周内 / 无需回应）",
  "risk_level": "low | medium | high",
  "risk_note": "若 high：高传播 + 强负面 = 危机；若 medium：…；若 low：可观察"
}
```

System prompt 必须强调：

```
You are NOT a marketer. You are a sentiment analyst.
- DO NOT fabricate URLs, platforms, titles, or engagement numbers — copy them verbatim.
- "why_recommend" should explain why this item is opinion-relevant
  (e.g. "highly upvoted complaint about pricing changes",
        "viral praise post that competitors are quoting",
        "trending question with 200+ answers — pain point detected").
- risk_level=high ONLY when virality + strong negative sentiment combined.
```

#### Node6：综合舆情报告（核心产物）

输出严格结构：

```json
{
  "response_scripts": [
    {
      "rank": 1,
      "platform": "reddit",
      "should_respond": true,
      "suggested_response": "（中立、客观、像真实用户的回复，120-300 字符）",
      "response_strategy": "为什么这样回（解释切入角度）",
      "do":   ["承认问题客观存在", "提供事实/数据", "保持中立语气"],
      "dont": ["不要否认负面反馈", "不要用营销话术", "不要提及自家产品名 + URL"]
    }
  ],
  "overall_report": {
    "sentiment_distribution": {"positive": 38, "neutral": 42, "negative": 20},
    "hot_topics": ["topic1", "topic2", ...8 个],
    "user_pain_points": ["痛点 1", "痛点 2", "痛点 3"],
    "user_praise_points": ["称赞 1", "称赞 2"],
    "competitor_mentions": [{"name": "竞品 A", "context": "被推荐为 Notion 的替代品"}],
    "platform_breakdown": {
      "reddit": "Reddit 上的讨论以…为主",
      "youtube": "...",
      "twitter": "..."
    },
    "crisis_alerts": [
      {"severity": "high", "url": "...", "summary": "高传播负面，建议 24h 内回应"}
    ],
    "priority_actions": [
      "本周建议主动回应的 3 条 Reddit 帖",
      "需要密切观察的 1 条潜在病毒式传播",
      "竞品在某子版讨论中正在被推荐，可考虑发布对比内容"
    ],
    "weekly_monitoring_plan": "建议每周 X 次复扫，重点关注 …",
    "kpi_targets": "建议跟踪指标：负面比例 < 25%；新热点话题响应时间 < 48h；…"
  }
}
```

### 4.5 平台解析器（`utils/parsers.py`）

每个平台一个解析函数（必须实现）：

| 函数 | 输入 | 输出字段 |
|------|------|---------|
| `parse_reddit(text, links)` | innerText + links | `title, url, upvotes, comments, time_ago, content_snippet` |
| `parse_youtube(text, links)` | … | `title, url=youtube.com/watch?v=..., views, channel, time_ago` |
| `parse_twitter(text, links)` | … | `title (推文文本), url=x.com/.../status/..., likes, retweets, time_ago` |
| `parse_quora(text, links)` | … | `title, url, answers_count, views` |
| `parse_hackernews(text, links)` | … | `title, url, points, comments, time_ago` |
| `parse_producthunt(text, links)` | … | `title, url, upvotes, comments` |
| `parse_google_site_results(platform, scrape)` | Cloudflare 兜底 | 普适 `title, url, snippet` |
| `parse_generic(text, links)` | 兜底 | 抓所有外链 |

每个函数返回 `List[Dict]`，其中至少包含：

```json
{
  "title": "...",
  "url": "...",
  "platform": "reddit",
  "engagement_stats": {"upvotes": 123, "comments": 45, "views": 0},
  "content_snippet": "前 500 字摘要",
  "author": "",
  "time_ago": "3 days ago"
}
```

### 4.6 鉴权中间件（auth_middleware.py）

```python
from fastapi import Header, HTTPException

async def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing token")
    token = authorization.split(" ", 1)[1]
    db = get_database()
    user = db.verify_token(token)
    if not user: raise HTTPException(401, "Invalid token")
    return user
```

### 4.7 SSE 工具（`utils/sse.py`）

```python
from dataclasses import dataclass
from typing import Any

@dataclass
class SSEEvent:
    event: str
    data: Any
```

后端 chat.py 把它转成 sse-starlette 格式：

```python
async def event_generator():
    async for ev in workflow.run(...):
        yield {"event": ev.event, "data": json.dumps(ev.data, ensure_ascii=False)}
return EventSourceResponse(event_generator())
```

前端用 `fetch` + `ReadableStream` 解析（不用浏览器原生 EventSource，因为需要 Authorization 头）：

```typescript
const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const parts = buffer.split('\n\n');
  buffer = parts.pop() || '';
  for (const part of parts) {
    let event = '', data = '';
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data = line.slice(5).trim();
    }
    if (event && data) handle(event, JSON.parse(data));
  }
}
```

### 4.8 前端页面要点

#### LandingPage

- Hero：`AI 全网舆情监测中心 / 输入关键词、品牌或产品网址，30 秒拿到全平台舆情报告`
- 6 个功能卡：声量监测 / 情感分析 / 危机预警 / 竞品声量 / 热点追踪 / AI 助手
- 主题切换（明 / 暗）+ i18n 切换（中 / 英）
- 顶部 CTA → LoginModal

#### AnalyzePage（核心）

- 左侧 Sidebar：历史监测会话
- 中部 ChatInterface：
  - 输入框（接受关键词 / URL / 品牌）
  - 进度条（6 步）
  - 监测结果卡片列表（按 rank，前 3 条免费用户可见，后续模糊+CTA "升级"）
  - 综合舆情报告面板（情感分布饼图 + 热点词云 + 危机预警）

#### RecommendCard（必须重设计）

```
┌──────────────────────────────────────────────────┐
│ #1   Reddit · r/notion                  🟢 正面  │ ← 情感色块
│ ──────────────────────────────────────────────── │
│ "Just switched from Obsidian and..."             │
│  👍 2.3k  💬 456  📅 2d ago                      │
│                                                  │
│  ⚖️ 综合舆情得分 88/100                           │
│   声量 92 · 时效 80 · 相关 95 · 情绪 85 · 影响 80 │
│                                                  │
│  💬 关键观点：                                    │
│   - 用户称赞同步速度                              │
│   - 抱怨离线体验                                  │
│                                                  │
│  ⚠️ 风险等级：低（高传播但情绪温和）              │
│                                                  │
│  ⏰ 建议回应：24 小时内                            │
│  📝 建议回复（中立口吻）：                        │
│   "yeah the offline mode is still rough, ..."    │
│                                                  │
│  [查看原帖 ↗] [复制回复 📋] [👍 / 👎 反馈]        │
└──────────────────────────────────────────────────┘
```

颜色规则：
- positive → 绿色边框 `--success`
- neutral  → 灰色边框
- negative → 红色边框 `--danger`
- risk_level=high → 顶部加红色"危机"徽章

#### StrategyPanel（综合舆情报告）

- 顶部三件套：
  - **情感分布饼图**（recharts PieChart）
  - **热点话题词云**
  - **危机预警卡**（红色背景，列出 high severity 项）
- 下方 Accordion：
  - 用户痛点 / 称赞点
  - 竞品被提及情况
  - 各平台洞察
  - 周监测计划 / KPI

### 4.9 API 端点完整列表

| Method | Path | 鉴权 | 说明 |
|--------|------|-----|-----|
| POST | `/api/v1/auth/register` | 无 | 注册 |
| POST | `/api/v1/auth/login` | 无 | 邮箱+密码登录 |
| POST | `/api/v1/auth/google` | 无 | Google OAuth |
| GET | `/api/v1/auth/me` | ✅ | 当前用户信息 |
| POST | `/api/v1/auth/logout` | ✅ | 退出 |
| PUT | `/api/v1/auth/me` | ✅ | 更新偏好（语言/品牌调性/主 URL） |
| POST | `/api/v1/chat/analyze` | ✅ | **主入口，SSE 流** |
| POST | `/api/v1/chat/cancel/{conv_id}` | ✅ | 取消并退积分 |
| GET | `/api/v1/chat/history` | ✅ | 监测历史列表 |
| GET | `/api/v1/chat/history/{id}` | ✅ | 监测详情 |
| DELETE | `/api/v1/chat/history/{id}` | ✅ | 删除 |
| GET | `/api/v1/credits/balance` | ✅ | 积分余额 |
| GET | `/api/v1/credits/transactions` | ✅ | 流水 |
| GET | `/api/v1/credits/packages` | 无 | 套餐 |
| POST | `/api/v1/credits/checkout` | ✅ | 创建订单（LemonSqueezy 或支付宝） |
| POST | `/api/v1/credits/webhook` | 无 | LemonSqueezy 回调 |
| POST | `/api/v1/credits/alipay/notify` | 无 | 支付宝回调 |
| GET | `/api/v1/dashboard/stats` | ✅ | 仪表盘 |
| GET | `/api/v1/competitors` | ✅ | 竞品库 |
| POST | `/api/v1/competitors` | ✅ | 添加竞品 |
| POST | `/api/v1/competitors/discover` | ✅ | AI 自动发现竞品 |
| POST | `/api/v1/geo/scan` | ✅ | GEO 可见度扫描（保留扩展） |
| POST | `/api/v1/seo/check` | ✅ | SEO 健康检查（保留扩展） |
| POST | `/api/v1/content/generate` | ✅ | AI 生成回复/帖子/博客 |
| POST | `/api/v1/feedback` | ✅ | 监测结果反馈 |
| GET | `/api/v1/terminal/activity` | ✅ | 实时活动流 |
| GET | `/api/v1/admin/*` | ✅ admin | 后台 |
| POST | `/api/v1/open/analyze` | API Key | 开放 API（用户的 sk-cmo-*） |

---

## 5. 部署与运维

### 5.1 docker-compose.yml

```yaml
services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: ai_cmo
      POSTGRES_PASSWORD: ai_cmo_pass
      POSTGRES_DB: ai_cmo
    ports: ["5434:5432"]
    volumes: [ai_cmo_pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ai_cmo"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend
    ports: ["9011:9001"]
    depends_on:
      db: {condition: service_healthy}
    env_file: .env
    environment:
      DATABASE_URL: postgresql://ai_cmo:ai_cmo_pass@db:5432/ai_cmo
    volumes:
      - ./logs:/app/logs
      - browser_profiles:/app/browser-profiles
    restart: unless-stopped

  frontend:
    image: nginx:alpine
    ports: ["9010:80"]
    volumes:
      - ./frontend/dist:/usr/share/nginx/html:ro
      - ./frontend/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on: [backend]
    restart: unless-stopped

volumes:
  ai_cmo_pgdata:
  browser_profiles:
```

### 5.2 Backend Dockerfile（含 Playwright 系统依赖）

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates fonts-liberation libnss3 libatk-bridge2.0-0 \
    libdrm2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 libcups2 libxss1 libgtk-3-0 libxshmfence1 \
    libglu1-mesa dbus xvfb \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && playwright install chromium
COPY . .
RUN mkdir -p /app/browser-profiles/default
EXPOSE 9001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9001"]
```

### 5.3 Frontend Dockerfile + nginx.conf

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

`nginx.conf`:

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
    location /api/ {
        proxy_pass http://backend:9001;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;        # SSE 必须
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

### 5.4 一键部署脚本（deploy.sh）

```bash
#!/usr/bin/env bash
set -e
MODE=${1:-smart}     # smart | full | backend | frontend

if [ "$MODE" = "full" ] || [ "$MODE" = "smart" ]; then
  cd frontend && npm ci && npm run build && cd ..
fi

case "$MODE" in
  full)     docker compose down && docker compose up -d --build ;;
  backend)  docker compose up -d --build backend ;;
  frontend) docker compose up -d frontend ;;
  smart)    docker compose up -d --build ;;
esac
docker compose ps
```

### 5.5 日志

`backend/app/main.py::setup_logging()`：

- 北京时区
- 控制台 + 按日 rotate 文件 (`logs/ai-cmo.log`)，保留 1 份
- 静音 httpx / openai / uvicorn.access 噪音
- 日志格式：`%(asctime)s | %(levelname)-8s | %(name)-25s | %(message)s`

### 5.6 计费规则

| 操作 | 积分 |
|------|-----|
| 单次完整监测 | 1 积分 |
| 注册赠送 | 1 积分 |
| 推荐注册（双方） | 各 +1 积分 |
| 失败 / 取消 | 自动 refund |

| 套餐（SGD） | 积分 |
|-----------|-----|
| S\$1 | 5（按量） |
| S\$5 | 25（入门） |
| S\$10 | 50（标准） |
| S\$20 | 100（专业） |
| S\$45 | 250（旗舰） |

---

## 6. 复现完成自检清单

按顺序勾选：

- [ ] `docker compose up -d` 后所有容器健康
- [ ] `curl http://localhost:9011/health` 返回 `{"status":"ok"}`
- [ ] 注册新账号能拿到 1 个赠送积分
- [ ] 输入 `Notion` 后 60 秒内能看到第一个 SSE `result` 事件
- [ ] 监测结果含至少 3 个不同平台
- [ ] 每条卡片有 `sentiment` 字段（绿/灰/红）
- [ ] 综合报告里有 `sentiment_distribution`、`hot_topics`、`crisis_alerts`
- [ ] 关闭 LLM API Key 后再发起监测，会触发 `error` 并退积分
- [ ] 中英文切换正常，AI 输出语言跟随用户偏好
- [ ] 暗 / 亮主题切换持久化到 localStorage
- [ ] 历史会话能回看（不重新消耗积分）
- [ ] 取消进行中的会话能即时退积分
- [ ] LandingPage 的所有文案均围绕"舆情监测"，无残留"营销"用语

---

## 7. 关键设计哲学（不要忘）

1. **"舆情" ≠ "营销"**：所有 prompt、UI 文案、字段名都要从"找推广位"思路彻底切换到"听用户在说什么"。
2. **不编造数据**：LLM 必须从 Node3 抓取的真实数据中提取观点，URL/平台/标题/互动数严禁伪造。
3. **流式优先**：用户从输入到看到第一条结果不超过 15 秒，全流程 ≤ 25 秒。
4. **失败软降级**：被 Cloudflare 拦 → Google site: 兜底；Playwright 挂 → httpx 兜底；LLM 失败 → 重试 3 次指数退避；任意单点失败不影响其他平台。
5. **积分等量退还**：失败、取消、流式中断都自动 refund，绝不闷烧用户积分。
6. **危机识别优先级**：高传播 + 强负面 = 危机预警，必须显著标红。

复现完成 ✅
