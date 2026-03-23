# AI-CMO 实施计划 — 社媒推广智能分析平台

> **项目代号**：AI-CMO
> **核心定位**：用户输入网址/产品名 → AI Agent 自动全网搜索高讨论量帖子 → 智能推荐最佳推广位 + 运营策略
> **技术栈**：FastAPI + React 19 + TypeScript + PostgreSQL + AgentGo + Qwen 3.5 Max

---

## 一、架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React 19 + Vite 7)            │
│  ChatGPT 式交互界面 · 黑白主题切换 · SSE 实时流式输出            │
│  骨架屏即时反馈 · 渐进渲染 · 交错入场动画                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ SSE / REST
┌──────────────────────────▼──────────────────────────────────────┐
│                     Backend (FastAPI)                           │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Auth API │  │ Chat API  │  │ Pay API  │  │ Analysis API │  │
│  └──────────┘  └─────┬─────┘  └──────────┘  └──────┬───────┘  │
│                      │                              │          │
│              ┌───────▼──────────────────────────────▼───────┐  │
│              │      🧠 AI Agent Workflow Engine (⚡优化版)    │  │
│              │                                              │  │
│              │  ┌─ Phase A ──────────────────────────────┐  │  │
│              │  │ Node1+2 合并: 产品画像+搜索策略(单次LLM) │  │  │
│              │  │ + URL预爬取(asyncio.gather并行)         │  │  │
│              │  └────────────────────────────────────────┘  │  │
│              │     ↓                                        │  │
│              │  ┌─ Phase B ──────────────────────────────┐  │  │
│              │  │ Node3: 分布式爬取(Sem=8, L1→L2流式管道) │  │  │
│              │  │ High优先级先返回 → Medium/Low后台追加    │  │  │
│              │  └────────────────────────────────────────┘  │  │
│              │     ↓                                        │  │
│              │  ┌─ Phase C ──────────────────────────────┐  │  │
│              │  │ Node4: 分批并行评分(3-4批LLM同时发)     │  │  │
│              │  │ Node5+6: 交错并行(深度分析B1完成即触发   │  │  │
│              │  │          策略生成, 不等B2)               │  │  │
│              │  │ DB写入: asyncio.create_task后台异步      │  │  │
│              │  └────────────────────────────────────────┘  │  │
│              └──────────────────────────────────────────────┘  │
│                      │                                         │
│              ┌───────▼───────┐                                 │
│              │  PostgreSQL   │                                 │
│              └───────────────┘                                 │
└────────────────────────────────────────────────────────────────┘
                           │
              ┌────────────▼────────────────┐
              │   AgentGo 分布式云浏览器     │
              │  (Scrape API + 连接池复用)   │
              │  (Sem=8并发 + TTL缓存去重)   │
              └─────────────────────────────┘
```

---

## 二、AI Agent 工作流设计（核心亮点）

### 🧠 六节点智能工作流

这是整个系统的灵魂。每个节点都是一次独立的 Qwen 3.5 Max 调用，节点间通过结构化 JSON 传递上下文。

#### **Node 1：意图识别 & 产品画像构建**
- **输入**：用户原始输入（URL 或产品名称）
- **处理**：
  - 如果是 URL → 调用 AgentGo Scrape API 抓取页面内容（markdown 格式）
  - 如果是产品名称 → 直接进入 LLM 分析
- **LLM 任务**：分析提取以下结构化信息
  ```json
  {
    "product_name": "产品名称",
    "product_type": "SaaS工具 / 电商产品 / 内容创作 / App / ...",
    "target_audience": ["目标人群1", "目标人群2"],
    "core_value_proposition": "核心价值主张",
    "keywords": ["关键词1", "关键词2", "关键词3"],
    "competitor_hints": ["可能的竞品1", "竞品2"],
    "language": "en / zh / ...",
    "industry_tags": ["行业标签"]
  }
  ```
- **流式输出给用户**：`"🔍 正在分析您的产品...已识别为 [类型]，目标用户群体为..."`

#### **Node 2：多平台搜索策略生成**
- **输入**：Node 1 的产品画像
- **LLM 任务**：生成跨平台搜索关键词矩阵
  ```json
  {
    "search_tasks": [
      {
        "platform": "reddit",
        "search_urls": [
          "https://www.reddit.com/search/?q=best+AI+tools+2026&sort=hot",
          "https://www.reddit.com/search/?q=alternative+to+[竞品]&sort=new"
        ],
        "priority": "high"
      },
      {
        "platform": "youtube",
        "search_urls": [
          "https://www.youtube.com/results?search_query=best+[类型]+tools+2026&sp=CAI",
          "https://www.youtube.com/results?search_query=[关键词]+review"
        ],
        "priority": "high"
      },
      {
        "platform": "twitter",
        "search_urls": ["https://x.com/search?q=[关键词]&f=live"],
        "priority": "medium"
      },
      {
        "platform": "quora",
        "search_urls": ["https://www.quora.com/search?q=[问题关键词]"],
        "priority": "medium"
      },
      {
        "platform": "producthunt",
        "search_urls": ["https://www.producthunt.com/search?q=[产品类型]"],
        "priority": "medium"
      },
      {
        "platform": "hackernews",
        "search_urls": ["https://hn.algolia.com/?q=[关键词]"],
        "priority": "low"
      },
      {
        "platform": "v2ex",
        "search_urls": ["https://www.google.com/search?q=site:v2ex.com+[关键词]"],
        "priority": "low"
      },
      {
        "platform": "zhihu",
        "search_urls": ["https://www.zhihu.com/search?type=content&q=[关键词]"],
        "priority": "low"
      }
    ]
  }
  ```
- **策略逻辑**：根据产品类型自动调整平台权重（如 SaaS→Reddit/HN/PH 优先；消费品→YouTube/Twitter 优先）
- **流式输出**：`"📡 已生成搜索策略，即将在 Reddit / YouTube / Twitter / Quora 等 N 个平台发起搜索..."`

#### **Node 3：AgentGo 分布式并发爬取**
- **不是 LLM 节点**，而是纯工程节点
- **执行方式**：使用 `asyncio.gather()` 并发调用 AgentGo
- **两层爬取策略**：
  1. **第一层 — 搜索结果页爬取**：用 Scrape API 抓取搜索结果页，提取帖子/视频列表
  2. **第二层 — 详情页爬取**：对 Top 候选内容（按讨论量/时间排序取前20）再次用 AgentGo 抓取详情页获取完整数据
- **提取的关键数据**：
  ```json
  {
    "title": "帖子标题",
    "url": "原始链接",
    "platform": "reddit",
    "author": "作者",
    "publish_date": "发布日期",
    "engagement": {
      "upvotes": 1234,
      "comments": 567,
      "views": 89000,
      "shares": 23
    },
    "content_snippet": "内容摘要（前500字）",
    "top_comments": ["热门评论1", "热门评论2", "热门评论3"],
    "sentiment": "positive/negative/neutral",
    "relevance_keywords_found": ["匹配到的关键词"]
  }
  ```
- **流式输出**：`"🌐 正在搜索 Reddit...已找到 15 条相关讨论 ✓"` → `"🌐 正在搜索 YouTube...已找到 8 条相关视频 ✓"` → ...
- **错误容忍**：单个平台失败不影响整体流程，记录错误并跳过

#### **Node 4：内容质量评估 & 智能排序**
- **输入**：Node 3 的全部爬取结果（可能 50-100 条）
- **LLM 任务**：对每条内容进行多维度评分
  ```json
  {
    "scoring_dimensions": {
      "engagement_score": "互动量得分 (0-100)：综合点赞、评论、观看量",
      "recency_score": "时效性得分 (0-100)：越新越高",
      "relevance_score": "相关性得分 (0-100)：与产品的匹配度",
      "promotion_potential": "推广潜力 (0-100)：该帖子适合推广的程度",
      "audience_match": "受众匹配 (0-100)：帖子受众与产品目标用户的重合度"
    },
    "composite_score": "加权综合得分",
    "ranking_reason": "排名理由（一句话）"
  }
  ```
- **排序算法**：`综合得分 = 互动量×0.2 + 时效性×0.15 + 相关性×0.25 + 推广潜力×0.25 + 受众匹配×0.15`
- **输出**：排序后的 Top 20 候选列表
- **流式输出**：`"🧮 正在分析 67 条搜索结果的推广价值..."`

#### **Node 5：推广价值深度分析（Top 10 精析）**
- **输入**：Node 4 排序后的 Top 10
- **LLM 任务**：对每条内容生成深度分析
  ```json
  {
    "recommendation": {
      "rank": 1,
      "url": "https://...",
      "platform": "reddit",
      "title": "帖子标题",
      "why_recommend": "推荐理由（3-5句详细分析）",
      "estimated_exposure": "预估曝光量范围",
      "best_timing": "最佳推广时间窗口",
      "risk_level": "low/medium/high",
      "risk_note": "风险提示（如社区规则、可能被删等）",
      "engagement_stats": { ... }
    }
  }
  ```
- **流式输出**：`"💎 已锁定 Top 10 高价值推广位，正在生成详细分析..."`

#### **Node 6：运营策略生成 & 个性化话术**
- **输入**：Node 1 的产品画像 + Node 5 的 Top 推荐
- **LLM 任务**：为每个推荐位生成可直接使用的推广内容
  ```json
  {
    "for_each_recommendation": {
      "suggested_comment": "建议的评论/回复话术（自然、不广告感）",
      "comment_strategy": "评论策略说明（如何自然引入产品）",
      "do_and_dont": {
        "do": ["提供真实价值", "先回答问题再推荐", "..."],
        "dont": ["不要硬广", "不要 spam", "..."]
      }
    },
    "overall_strategy": {
      "priority_actions": "优先执行的3个动作",
      "weekly_plan": "建议的每周推广节奏",
      "content_calendar": "推荐的内容发布日历",
      "kpi_targets": "建议的KPI指标",
      "budget_suggestion": "如需付费推广的预算建议"
    }
  }
  ```
- **流式输出**：逐条输出推荐结果 + 话术 + 策略

---

## 三、具体实施步骤

### Phase 0：项目初始化（预计 30 分钟）

#### Step 0.1：创建项目骨架
```
ai-cmo/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                 # FastAPI 入口
│   │   ├── config.py               # Pydantic Settings
│   │   ├── database.py             # SQLAlchemy 模型 & 连接
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py             # 认证路由
│   │   │   ├── chat.py             # 聊天/分析路由（SSE）
│   │   │   ├── credits.py          # 支付/积分路由
│   │   │   └── history.py          # 历史记录路由
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── agentgo.py          # AgentGo 爬取服务
│   │   │   ├── llm.py              # Qwen LLM 统一调用层
│   │   │   ├── workflow.py         # 6节点工作流引擎
│   │   │   ├── search_strategy.py  # 搜索策略构建
│   │   │   └── credit_service.py   # 积分管理
│   │   ├── prompts/
│   │   │   ├── node1_product_analysis.py
│   │   │   ├── node2_search_strategy.py
│   │   │   ├── node4_scoring.py
│   │   │   ├── node5_deep_analysis.py
│   │   │   └── node6_strategy.py
│   │   ├── middleware/
│   │   │   └── auth_middleware.py
│   │   └── utils/
│   │       ├── sse.py              # SSE 流式推送工具
│   │       └── parsers.py          # 数据解析工具
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ChatInterface.tsx    # 主聊天界面
│   │   │   ├── ChatMessage.tsx      # 消息气泡组件
│   │   │   ├── ChatInput.tsx        # 输入框组件
│   │   │   ├── RecommendCard.tsx    # 推荐结果卡片
│   │   │   ├── StrategyPanel.tsx    # 运营策略面板
│   │   │   ├── ThemeToggle.tsx      # 黑白主题切换
│   │   │   ├── Sidebar.tsx          # 侧边栏（历史记录）
│   │   │   ├── PricingModal.tsx     # 会员/定价弹窗
│   │   │   ├── LoginModal.tsx       # 登录/注册弹窗
│   │   │   └── LoadingSteps.tsx     # 分析步骤进度条
│   │   ├── styles/
│   │   │   ├── globals.css          # 全局样式 + CSS Variables
│   │   │   ├── theme-dark.css       # 暗色主题
│   │   │   ├── theme-light.css      # 亮色主题
│   │   │   └── chat.css             # 聊天界面样式
│   │   ├── i18n/
│   │   │   ├── en.json
│   │   │   └── zh.json
│   │   ├── api.ts                   # axios 实例
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── Dockerfile
├── docker-compose.prod.yml
├── .env
└── deploy.sh
```

#### Step 0.2：配置环境变量
在 `.env` 中新增以下变量（保留已有的 AgentGo 配置）：
```env
# 已有
AGENTGO_API_KEY=api_1c2231077849083245d3d48297fcbb67

# 新增 - 数据库
DATABASE_URL=postgresql://ai_cmo:password@localhost:5433/ai_cmo

# 新增 - Auth
SECRET_KEY=<生成随机密钥>

# 新增 - Qwen LLM
QWEN_API_KEY=sk-358582aeb2934f0fae3d2a89ac088c4e
QWEN_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-max-latest

# 新增 - 支付
LEMONSQUEEZY_API_KEY=
LEMONSQUEEZY_STORE_ID=
LEMONSQUEEZY_WEBHOOK_SECRET=
ALIPAY_APP_ID=
ALIPAY_PRIVATE_KEY_PATH=
ALIPAY_PUBLIC_KEY_PATH=

# 新增 - 应用
CORS_ORIGINS=http://localhost:5173,http://localhost:9000
FREE_ANALYSIS_LIMIT=3
PREMIUM_TOP_N=10
FREE_TOP_N=3
```

#### Step 0.3：安装依赖

**后端 `requirements.txt`：**
```
fastapi==0.115.0
uvicorn[standard]==0.34.0
sqlalchemy==2.0.36
asyncpg==0.30.0
psycopg2-binary==2.9.10
pydantic-settings==2.7.0
httpx==0.28.0
openai==1.60.0          # 用于调用 Qwen 的 OpenAI 兼容接口
sse-starlette==2.2.1    # SSE 流式推送
python-multipart==0.0.20
python-jose==3.3.0
passlib==1.7.4
```

**前端 `package.json` 关键依赖：**
```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "axios": "^1.7.0",
    "lucide-react": "^0.460.0",
    "recharts": "^2.15.0",
    "i18next": "^24.0.0",
    "react-i18next": "^15.0.0",
    "i18next-browser-languagedetector": "^8.0.0",
    "react-markdown": "^9.0.0",
    "highlight.js": "^11.10.0"
  }
}
```

---

### Phase 1：后端基础设施（预计 2 小时）

#### Step 1.1：数据库模型设计

```python
# 核心模型（在 project-setup-skills 基础上扩展）

class User:
    # 继承已有字段：id, username, email, password_hash, is_active,
    # is_premium, is_admin, credit_balance, referral_code, referred_by, created_at
    pass

class Session:
    # 继承已有：id, user_id, token, created_at, expires_at
    pass

# 新增模型 ↓

class Conversation:
    """对话记录"""
    id: UUID
    user_id: int (FK → User)
    title: str                    # 自动生成的对话标题
    input_type: str               # "url" | "keyword"
    input_value: str              # 用户输入的原始内容
    product_profile: JSON         # Node1 生成的产品画像
    status: str                   # "analyzing" | "completed" | "failed"
    credits_consumed: int         # 消耗积分数
    created_at: datetime

class Recommendation:
    """推荐结果"""
    id: UUID
    conversation_id: UUID (FK → Conversation)
    rank: int
    platform: str                 # reddit / youtube / twitter / ...
    url: str
    title: str
    engagement_stats: JSON        # {upvotes, comments, views, ...}
    composite_score: float
    scoring_detail: JSON          # 各维度评分
    why_recommend: text
    estimated_exposure: str
    best_timing: str
    risk_level: str
    risk_note: str
    suggested_comment: text       # 推荐话术
    comment_strategy: text
    is_premium_only: bool         # rank > 3 的为会员专属
    created_at: datetime

class OverallStrategy:
    """运营策略"""
    id: UUID
    conversation_id: UUID (FK → Conversation)
    priority_actions: JSON
    weekly_plan: text
    content_calendar: text
    kpi_targets: text
    budget_suggestion: text
    created_at: datetime

# 支付相关模型直接复用 project-setup-skills 中的 PaymentOrder, CreditTransaction
```

#### Step 1.2：实现认证系统
- 直接按照 `reusable-auth-system` 的方案实现
- 注册/登录/获取用户信息/退出
- Referral 推荐机制

#### Step 1.3：实现积分 & 支付系统
- 直接按照 `reusable-payment-system` 的方案实现
- 积分消耗规则：每次分析消耗 1 积分
- 新用户注册赠送 3 次免费分析机会（3 积分）
- 会员 = 积分充值用户，购买后可查看 Top 10

---

### Phase 2：LLM 服务层（预计 1.5 小时）

#### Step 2.1：Qwen LLM 统一调用层 (`services/llm.py`)
```python
# 使用 OpenAI 兼容接口调用 Qwen
# 关键设计：
# - 统一的 async 调用接口
# - 支持流式输出（streaming）和一次性输出
# - 自动重试（3次，指数退避）
# - Token 用量追踪
# - 结构化 JSON 输出解析（使用 response_format）
# - 超时控制（单次调用 60s 上限）

class LLMService:
    async def chat(self, messages, stream=False, json_mode=False) -> str | AsyncGenerator
    async def chat_json(self, messages) -> dict  # 强制 JSON 输出
    async def chat_stream(self, messages) -> AsyncGenerator[str, None]  # 流式
```

#### Step 2.2：Prompt 工程（`prompts/` 目录）
- 每个节点一个独立的 prompt 文件
- 使用 system + user 的双层 prompt 结构
- 所有 prompt 都要求 JSON 结构化输出（除 Node 6 部分为自然语言）
- prompt 中嵌入 few-shot 示例提升输出稳定性

---

### Phase 3：AgentGo 爬取服务（预计 2 小时）

#### Step 3.1：AgentGo 服务封装 (`services/agentgo.py`)
```python
class AgentGoService:
    async def scrape_url(self, url: str) -> dict:
        """Scrape API 抓取单个 URL，返回 markdown + links"""

    async def scrape_batch(self, urls: list[str], concurrency: int = 5) -> list[dict]:
        """并发抓取多个 URL，使用 asyncio.Semaphore 控制并发"""

    async def search_and_scrape(self, search_tasks: list[dict]) -> list[dict]:
        """执行 Node2 生成的搜索任务列表"""
        # 1. 并发抓取所有搜索结果页
        # 2. 解析出候选帖子/视频列表
        # 3. 对 Top 候选进行详情页二次抓取
```

#### Step 3.2：平台特定解析器 (`utils/parsers.py`)
```python
# 每个平台一个解析函数，从爬取的 markdown/HTML 中提取结构化数据

def parse_reddit_search(markdown: str) -> list[PostInfo]
def parse_youtube_search(markdown: str) -> list[VideoInfo]
def parse_twitter_search(markdown: str) -> list[TweetInfo]
def parse_quora_search(markdown: str) -> list[AnswerInfo]
def parse_producthunt(markdown: str) -> list[ProductInfo]
def parse_hackernews(markdown: str) -> list[PostInfo]

# 通用字段: title, url, author, date, engagement_metrics, content_snippet
```

#### Step 3.3：爬取容错 & 降级策略
- 每个平台爬取设置独立超时（30s）
- 单个平台失败不阻塞整体流程
- Scrape API 优先（简单快速），失败时降级到 Playwright WebSocket 模式
- 记录每次爬取的成功/失败日志用于优化

---

### Phase 4：工作流引擎（预计 3 小时）⭐ 核心

#### Step 4.1：工作流引擎实现 (`services/workflow.py`)
```python
class AnalysisWorkflow:
    """六节点工作流引擎，支持 SSE 流式输出"""

    async def run(self, user_input: str, user_id: int) -> AsyncGenerator[SSEEvent, None]:
        """
        主入口：执行完整工作流，通过 SSE 实时推送进度和结果

        SSE 事件类型：
        - "status"   : 当前步骤状态 {"step": 1, "message": "正在分析产品..."}
        - "thinking"  : Agent 思考过程（可选展示）
        - "result"   : 单条推荐结果 JSON
        - "strategy" : 运营策略内容
        - "error"    : 错误信息
        - "done"     : 分析完成
        """

        # Node 1: 产品画像
        yield SSEEvent("status", {"step": 1, "message": "🔍 正在分析您的产品..."})
        profile = await self._node1_product_analysis(user_input)
        yield SSEEvent("thinking", {"content": f"已识别产品类型: {profile['product_type']}"})

        # Node 2: 搜索策略
        yield SSEEvent("status", {"step": 2, "message": "📡 正在生成搜索策略..."})
        search_tasks = await self._node2_search_strategy(profile)
        yield SSEEvent("thinking", {"content": f"将搜索 {len(search_tasks)} 个平台"})

        # Node 3: 分布式爬取（实时推送每个平台的进度）
        yield SSEEvent("status", {"step": 3, "message": "🌐 正在全网搜索..."})
        raw_results = await self._node3_distributed_scrape(search_tasks, progress_callback)

        # Node 4: 质量评估排序
        yield SSEEvent("status", {"step": 4, "message": "🧮 正在评估内容价值..."})
        ranked_results = await self._node4_scoring(raw_results, profile)

        # Node 5: 深度分析
        yield SSEEvent("status", {"step": 5, "message": "💎 正在生成推荐分析..."})
        recommendations = await self._node5_deep_analysis(ranked_results[:10], profile)
        for rec in recommendations:
            yield SSEEvent("result", rec)

        # Node 6: 运营策略
        yield SSEEvent("status", {"step": 6, "message": "📋 正在制定运营策略..."})
        strategy = await self._node6_strategy(recommendations, profile)
        yield SSEEvent("strategy", strategy)

        yield SSEEvent("done", {"total_found": len(raw_results)})
```

#### Step 4.2：SSE 流式输出接口
```python
# api/chat.py
@router.post("/api/v1/chat/analyze")
async def analyze(request: AnalyzeRequest, user: User = Depends(get_current_user)):
    """
    SSE 流式接口：接收用户输入，返回实时分析流

    前端通过 EventSource 或 fetch + ReadableStream 消费
    """
    # 1. 检查积分余额
    # 2. 扣除积分
    # 3. 创建 Conversation 记录
    # 4. 启动工作流，流式返回结果
    return EventSourceResponse(workflow.run(request.input, user.id))
```

#### Step 4.3：会员内容控制逻辑
- 免费用户：只展示 Top 3 推荐 + 基础运营建议
- 付费用户：展示 Top 10 推荐 + 完整运营策略 + 话术定制
- 前端：Top 3 之后的内容用模糊遮罩 + "开通会员查看更多" CTA

---

### Phase 5：前端开发（预计 4 小时）

#### Step 5.1：全局样式 & 主题系统
- 严格遵循 `tech-stack-preferences` 中的设计系统
- CSS Variables 实现黑白双主题切换
- 暗色主题为默认（`--bg-deep: #0a0a0a`）
- 亮色主题：`--bg-deep: #ffffff`, `--bg-card: #f5f5f5`, `--text-primary: #111111`
- 主题切换按钮放在顶部导航栏右侧
- 使用 `localStorage` 持久化主题选择

#### Step 5.2：ChatGPT 式聊天界面 (`ChatInterface.tsx`)

**布局结构：**
```
┌──────────────────────────────────────────────────────┐
│  [Logo] AI-CMO                    [Theme] [Login]    │  ← Header
├────────────┬─────────────────────────────────────────┤
│            │                                         │
│  History   │     欢迎使用 AI-CMO                      │  ← 主聊天区
│  --------  │     输入您的产品网址或名称                 │
│  分析1     │     我们将为您找到最佳推广位               │
│  分析2     │                                         │
│  分析3     │     ┌──────────────────────────────┐    │
│            │     │ 输入网址或产品名称...    [发送] │    │  ← 输入框
│            │     └──────────────────────────────┘    │
├────────────┴─────────────────────────────────────────┤
│                                                      │  ← Footer (可选)
└──────────────────────────────────────────────────────┘
```

**交互流程：**
1. 用户输入 → 显示用户消息气泡
2. 系统开始分析 → 显示步骤进度条（6步动画）
3. 每个步骤完成 → 进度条更新 + 思考过程展示
4. 推荐结果逐条渲染 → 精美的推荐卡片
5. 运营策略 → 折叠面板展示

#### Step 5.3：推荐结果卡片 (`RecommendCard.tsx`)
```
┌─────────────────────────────────────────────┐
│  🥇 #1  Reddit · r/SaaS                     │
│  ─────────────────────────────────────────── │
│  "What's the best AI tool for marketing..."  │
│                                              │
│  👍 2.3k   💬 456   👁 89k   📅 2天前        │
│                                              │
│  📊 综合得分: 95/100                          │
│  ├─ 互动量: 92  相关性: 98  推广潜力: 96      │
│                                              │
│  💡 推荐理由：该帖子正在讨论 AI 营销工具...    │
│                                              │
│  ⏰ 最佳推广窗口：24小时内                     │
│  ⚠️ 风险等级：低                              │
│                                              │
│  📝 建议话术：                                │
│  "I've been using [产品名] for 3 months..."  │
│                                              │
│  [查看原帖 ↗]     [复制话术 📋]              │
└─────────────────────────────────────────────┘
```
- 免费用户看到 #4 开始显示锁定卡片（模糊 + 锁图标）

#### Step 5.4：分析进度动画 (`LoadingSteps.tsx`)
```
┌─────────────────────────────────────────┐
│  ✅ Step 1  分析产品信息                  │
│  ✅ Step 2  生成搜索策略                  │
│  🔄 Step 3  全网搜索中...                │
│     ├─ ✅ Reddit (15 results)            │
│     ├─ ✅ YouTube (8 results)            │
│     ├─ 🔄 Twitter...                    │
│     └─ ⏳ Quora                          │
│  ⏳ Step 4  评估内容价值                  │
│  ⏳ Step 5  深度分析推荐                  │
│  ⏳ Step 6  生成运营策略                  │
└─────────────────────────────────────────┘
```

#### Step 5.5：SSE 消费逻辑
```typescript
// 使用 fetch + ReadableStream 消费 SSE
// 根据事件类型分别更新 UI 状态
// 支持断线重连
```

#### Step 5.6：会员/定价弹窗 (`PricingModal.tsx`)
- 展示定价方案（积分包）
- 接入 LemonSqueezy（国际用户）和支付宝（国内用户）
- 展示会员专属功能对比表

#### Step 5.7：历史记录侧边栏 (`Sidebar.tsx`)
- 展示用户的历史分析记录
- 点击可回顾完整分析结果
- 支持删除历史记录

#### Step 5.8：i18n 国际化
- 按照 tech-stack-preferences 配置 i18next
- 默认根据浏览器语言自动切换中/英文
- 手动切换按钮放在 Header

---

### Phase 6：API 路由整合 & 联调（预计 1.5 小时）

#### Step 6.1：完整 API 路由列表

| 方法 | 路由 | 说明 | 鉴权 |
|------|------|------|------|
| POST | `/api/v1/auth/register` | 注册 | 无 |
| POST | `/api/v1/auth/login` | 登录 | 无 |
| GET | `/api/v1/auth/me` | 当前用户信息 | ✅ |
| GET | `/api/v1/auth/logout` | 退出 | ✅ |
| POST | `/api/v1/chat/analyze` | 发起分析（SSE） | ✅ |
| GET | `/api/v1/chat/history` | 历史记录列表 | ✅ |
| GET | `/api/v1/chat/history/{id}` | 历史记录详情 | ✅ |
| DELETE | `/api/v1/chat/history/{id}` | 删除历史记录 | ✅ |
| GET | `/api/v1/credits/balance` | 积分余额 | ✅ |
| GET | `/api/v1/credits/transactions` | 交易记录 | ✅ |
| POST | `/api/v1/credits/checkout` | 创建支付订单 | ✅ |
| POST | `/api/v1/credits/webhook` | LemonSqueezy 回调 | 无 |
| POST | `/api/v1/credits/alipay/notify` | 支付宝回调 | 无 |
| GET | `/api/v1/credits/packages` | 定价信息 | 无 |

#### Step 6.2：前后端联调
- 配置 CORS
- 测试 SSE 流式输出
- 测试完整分析流程

---

### Phase 7：Docker 化 & 部署（预计 1 小时）

#### Step 7.1：Docker Compose 配置
```yaml
services:
  db:
    image: postgres:15
    ports: ["5433:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]

  backend:
    build: ./backend
    ports: ["9001:9001"]
    depends_on: [db]
    env_file: .env

  frontend:
    build: ./frontend
    ports: ["9000:80"]
    depends_on: [backend]
```

#### Step 7.2：部署脚本
- 复用 `tech-stack-preferences` 中的 smart deploy 方案
- `./deploy.sh smart` 自动检测变更

---

## 四、差异化功能设计（锦上添花）

除了核心分析功能，以下附加功能将显著提升用户体验：

### 4.1 🎯 竞品对标分析
- 在 Node 1 中识别竞品后，额外搜索竞品的推广足迹
- 展示"你的竞品在这些帖子里已经被推荐了"
- 帮助用户找到竞品尚未覆盖的推广空白位

### 4.2 📊 推广效果预估仪表盘
- 基于历史数据和平台算法特征预估曝光量
- 用 recharts 渲染各平台预估 ROI 对比图
- 给出投入产出比建议

### 4.3 ⏰ 最佳发布时间建议
- 分析目标帖子的活跃时间段
- 结合平台特点给出最佳评论/发帖时间
- 时区感知（根据目标平台的主要用户群体）

### 4.4 📝 一键复制话术
- 每条推荐都附带一键复制的推广话术
- 话术风格可调（专业/友好/幽默）
- 根据平台规则自动调整（如 Reddit 不能硬广）

### 4.5 🔔 追踪提醒（未来版本）
- 对特定帖子设置追踪，当有新热帖出现时通知用户
- 每周推送新的推广机会摘要邮件

---

## 五、积分消耗 & 定价方案

| 操作 | 积分消耗 |
|------|---------|
| 单次分析（Top 3） | 1 积分 |
| 单次分析（Top 10，会员） | 1 积分 |
| 新用户注册赠送 | +3 积分 |
| 被推荐注册 | +2 积分（双方各得） |

| 积分包 | 价格（SGD） | 价格（CNY） | 积分 |
|--------|-----------|-----------|------|
| 入门包 | $5 | ¥25 | 25 |
| 标准包 | $15 | ¥68 | 80 |
| 专业包 | $30 | ¥128 | 180 |

---

## 六、执行优先级 & 时间线

| 阶段 | 内容 | 预估时间 | 优先级 |
|------|------|---------|-------|
| Phase 0 | 项目初始化、骨架搭建 | 30 min | P0 |
| Phase 1 | 数据库、认证、支付 | 2 h | P0 |
| Phase 2 | LLM 服务层 | 1.5 h | P0 |
| Phase 3 | AgentGo 爬取服务 | 2 h | P0 |
| Phase 4 | 工作流引擎（核心） | 3 h | P0 |
| Phase 5 | 前端界面 | 4 h | P0 |
| Phase 6 | 联调测试 | 1.5 h | P0 |
| Phase 7 | Docker 部署 | 1 h | P1 |
| 锦上添花 | 竞品分析、仪表盘等 | 2-3 h | P2 |

**总预估开发时间：15-18 小时**

---

## 七、⚡ 性能优化 — 全链路极速方案

> **优化目标**：将完整分析流程从串行 ~60s 压缩到 ~18-25s，用户体感 <10s 即可看到第一条结果

### 7.0 优化前后对比总览

```
❌ 优化前（纯串行）：总耗时 ~55-70s
═══════════════════════════════════════════════════════════════════════
Node1(3s) → Node2(3s) → Node3-L1(15s) → Node3-L2(15s) → Node4(5s) → Node5(8s) → Node6(8s)
═══════════════════════════════════════════════════════════════════════

✅ 优化后（极限并行）：总耗时 ~18-25s，首条结果 ~12s
═══════════════════════════════════════════════════════════════════════
Node1(3s) ──→ Node2+预爬取(并行3s) ──→ Node3全量爬取(10s) ──→ Node4+5+6(并行8s)
    │              │                         ↑
    │              └─ URL预爬取与LLM并行 ──────┘
    └─ 输入预判断(0s, 正则)
═══════════════════════════════════════════════════════════════════════
```

---

### 7.1 Node 1 & Node 2 合并：管道并行（省 3s）

**原方案**：Node1 完成 → Node2 开始（串行 6s）
**优化方案**：Node1 和 URL 预爬取并行 + Node1 输出直接 pipe 到 Node2

```python
async def _optimized_node1_node2(self, user_input: str):
    """Node1 + Node2 管道并行"""

    # ── 阶段 A：输入预判断（0ms，纯正则，不走 LLM）──
    is_url = bool(re.match(r'https?://', user_input.strip()))

    if is_url:
        # ── 阶段 B：URL 爬取与产品画像 LLM 调用并行 ──
        scrape_task = asyncio.create_task(self.agentgo.scrape_url(user_input))
        # 先用 URL 域名信息做一次轻量级 LLM 预判（产品类型），不等爬取结果
        pre_profile_task = asyncio.create_task(
            self.llm.chat_json(build_url_pre_analysis_prompt(user_input))
        )
        # 并行等待
        scraped_content, pre_profile = await asyncio.gather(
            scrape_task, pre_profile_task
        )
        # 用爬取内容补全产品画像（增量更新，不重做）
        profile = await self.llm.chat_json(
            build_profile_refinement_prompt(pre_profile, scraped_content)
        )
    else:
        # 关键词输入：单次 LLM 调用即可
        profile = await self.llm.chat_json(
            build_keyword_analysis_prompt(user_input)
        )

    # ── 阶段 C：Node2 搜索策略（与产品画像同一个 LLM 调用合并）──
    # 关键优化：将 Node2 的搜索策略生成 合并到 Node1 的 prompt 中
    # 一次 LLM 调用同时输出产品画像 + 搜索策略，省掉一次完整的 LLM roundtrip
    # prompt 要求输出：
    # { "profile": {...}, "search_tasks": [...] }
    return profile, search_tasks
```

**核心技巧**：
- **Node1 + Node2 Prompt 合并**：一次 LLM 调用同时输出产品画像和搜索策略，省掉一次完整 roundtrip（~3s）
- **URL 爬取与 LLM 预判并行**：`asyncio.gather` 同时发起爬取和域名预分析
- **增量补全而非重做**：先有预判结果，爬取完成后只做增量补全

---

### 7.2 Node 3 爬取：三级并发加速（省 15s）

**原方案**：L1 爬取(15s) → L2 爬取(15s)，串行 30s
**优化方案**：L1 全量并发 + L2 流式触发 + 优先级调度，压缩到 10-12s

```python
async def _optimized_node3(self, search_tasks: list, on_progress: Callable):
    """三级并发爬取引擎"""

    # ── 策略 1：按优先级分层并发 ──
    # high 优先级先发，不等 low 优先级
    high_tasks = [t for t in search_tasks if t["priority"] == "high"]
    medium_tasks = [t for t in search_tasks if t["priority"] == "medium"]
    low_tasks = [t for t in search_tasks if t["priority"] == "low"]

    all_results = []
    sem = asyncio.Semaphore(8)  # 提升到 8 并发（AgentGo Scrape API 轻量）

    async def scrape_with_sem(url, platform):
        async with sem:
            try:
                result = await asyncio.wait_for(
                    self.agentgo.scrape_url(url),
                    timeout=15  # 单个 URL 最多 15s
                )
                return parse_platform(platform, result)
            except (asyncio.TimeoutError, Exception) as e:
                logger.warning(f"Scrape failed: {url} - {e}")
                return []

    # ── 策略 2：L1 + L2 流式管道（不等 L1 全部完成）──
    l2_sem = asyncio.Semaphore(5)
    l2_tasks_pending = []

    async def scrape_l1_then_l2(url, platform):
        """L1 完成后立即触发 L2，不等其他 L1"""
        posts = await scrape_with_sem(url, platform)
        on_progress(platform, len(posts))  # SSE 实时推送进度

        # 立即对该平台的 Top 5 候选发起 L2 详情页爬取
        top_candidates = sorted(posts, key=lambda p: p.get("engagement_score", 0), reverse=True)[:5]
        l2_results = await asyncio.gather(*[
            scrape_detail_with_sem(p["url"], l2_sem) for p in top_candidates
        ], return_exceptions=True)

        # 合并 L1 摘要 + L2 详情
        for post, detail in zip(top_candidates, l2_results):
            if not isinstance(detail, Exception):
                post.update(detail)

        return posts

    # ── 策略 3：优先级分批，high 先返回 ──
    # High 优先级立即并发
    high_results = await asyncio.gather(*[
        scrape_l1_then_l2(url, t["platform"])
        for t in high_tasks for url in t["search_urls"]
    ], return_exceptions=True)
    all_results.extend(flatten_results(high_results))

    # Medium + Low 并发（不阻塞主流程，用 asyncio.create_task 后台跑）
    remaining_task = asyncio.create_task(asyncio.gather(*[
        scrape_l1_then_l2(url, t["platform"])
        for t in (medium_tasks + low_tasks) for url in t["search_urls"]
    ], return_exceptions=True))

    # 先用 high 结果继续下一步，remaining 完成后追加
    return all_results, remaining_task  # remaining_task 后续 await
```

**核心技巧**：
- **L1→L2 流式管道**：每个平台的 L1 完成后立即触发 L2，不等其他平台
- **优先级分批**：high 优先级结果先到就先进入 Node4，不等 medium/low
- **并发数提升**：Scrape API 是轻量 HTTP 调用，`Semaphore(8)` 安全
- **超时兜底**：单个 URL 15s 超时，不拖累整体

---

### 7.3 Node 4 + Node 5 合并：分批流式处理（省 8s）

**原方案**：Node4 评分全部(5s) → Node5 深度分析全部(8s)，串行 13s
**优化方案**：分批评分 + 评分完成立即深度分析 + 并行 LLM 调用

```python
async def _optimized_node4_node5(self, raw_results: list, profile: dict):
    """Node4 评分 + Node5 深度分析，流水线并行"""

    # ── 策略 1：分批评分，每批 15 条 ──
    # 减少单次 LLM 输入 token 数 → 降低延迟
    BATCH_SIZE = 15
    batches = [raw_results[i:i+BATCH_SIZE] for i in range(0, len(raw_results), BATCH_SIZE)]

    scored_results = []
    scoring_tasks = []

    # 所有评分批次并行发起
    for batch in batches:
        task = asyncio.create_task(
            self.llm.chat_json(build_scoring_prompt(batch, profile))
        )
        scoring_tasks.append(task)

    # ── 策略 2：用 asyncio.as_completed 先到先处理 ──
    top_n_heap = []  # 最小堆，维护全局 Top 10

    for coro in asyncio.as_completed(scoring_tasks):
        batch_scores = await coro
        for item in batch_scores:
            if len(top_n_heap) < 10:
                heapq.heappush(top_n_heap, (item["composite_score"], item))
            elif item["composite_score"] > top_n_heap[0][0]:
                heapq.heapreplace(top_n_heap, (item["composite_score"], item))

    top_10 = [item for _, item in sorted(top_n_heap, reverse=True)]

    # ── 策略 3：Top 10 深度分析并行 ──
    # 不是一次性把 10 条丢给 LLM，而是拆成 2 批 × 5 条并行
    deep_tasks = [
        asyncio.create_task(
            self.llm.chat_json(build_deep_analysis_prompt(top_10[0:5], profile))
        ),
        asyncio.create_task(
            self.llm.chat_json(build_deep_analysis_prompt(top_10[5:10], profile))
        )
    ]
    deep_results = await asyncio.gather(*deep_tasks)
    recommendations = deep_results[0] + deep_results[1]

    return recommendations
```

**核心技巧**：
- **评分批次并行**：3-4 批 LLM 调用同时发出，`as_completed` 先到先处理
- **堆排序实时维护 Top 10**：不等所有评分完成，边评分边排序
- **深度分析拆批并行**：2 个 LLM 调用同时处理 5 条，耗时减半

---

### 7.4 Node 5 + Node 6 并行：深度分析与策略生成同步进行（省 5s）

**原方案**：Node5 完成(8s) → Node6 开始(8s)，串行 16s
**优化方案**：Node5 前 5 条完成后立即触发 Node6，两者并行

```python
async def _optimized_node5_node6(self, top_10: list, profile: dict):
    """Node5 深度分析 + Node6 策略生成，交错并行"""

    # 深度分析 batch 1（前5条）
    deep_batch1_task = asyncio.create_task(
        self.llm.chat_json(build_deep_analysis_prompt(top_10[0:5], profile))
    )
    # 深度分析 batch 2（后5条）
    deep_batch2_task = asyncio.create_task(
        self.llm.chat_json(build_deep_analysis_prompt(top_10[5:10], profile))
    )

    # 等 batch1 完成，立即用前 5 条结果启动 Node6 策略生成
    deep_batch1 = await deep_batch1_task

    # Node6 话术生成（前5条）与 batch2 深度分析 并行
    strategy_task = asyncio.create_task(
        self.llm.chat_json(build_strategy_prompt(deep_batch1, profile))
    )

    # 等待剩余任务
    deep_batch2, strategy_part1 = await asyncio.gather(
        deep_batch2_task, strategy_task
    )

    # Node6 补充：后5条话术 + 整体运营策略（增量生成）
    strategy_part2 = await self.llm.chat_json(
        build_strategy_supplement_prompt(deep_batch2, strategy_part1, profile)
    )

    recommendations = deep_batch1 + deep_batch2
    full_strategy = merge_strategies(strategy_part1, strategy_part2)

    return recommendations, full_strategy
```

**时间线对比**：
```
❌ 串行：
  Node5[████████ 8s] → Node6[████████ 8s]  = 16s

✅ 并行：
  Node5-B1[████ 4s] ──────────────────────→
                      Node6-P1[████ 4s] ──→
  Node5-B2[████ 4s] ──────────────────────→
                                    Node6-P2[███ 3s]  = 8s
```

---

### 7.5 完整优化后工作流时序图

```
时间轴(秒)  0    3    5    8    10   12   15   18   20   22   25
            │    │    │    │    │    │    │    │    │    │    │
            ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼    ▼

用户输入 ──→┐
            │
Node1+2     │[██████ 合并调用 3s]
(合并)      │    │
            │    ├─ URL预爬取(并行) ───┐
            │    │                     │
Node3       │    └──→[High优先级爬取 ████████████ 10s]──→┐
(分布式)    │         │    │    │    │                    │
            │         ├─ Reddit L1→L2 ✓(3s)              │
            │         ├─ YouTube L1→L2 ✓(4s)             │
            │         ├─ Twitter L1→L2 ✓(3s)             │
            │         └─ Med/Low(后台并行) ─────→追加     │
            │                                            │
Node4       │                              [评分B1 ██ 3s]│
(分批并行)  │                              [评分B2 ██ 3s]│──→ Top10
            │                              [评分B3 ██ 3s]│
            │                                            │
Node5+6     │                                    [深度B1 ████ 4s]──→ SSE推送前5条
(交错并行)  │                                    [深度B2 ████ 4s]
            │                                         [策略P1 ████ 4s]
            │                                                   [策略P2 ███ 3s]──→ 完成
            │                                            │
SSE输出     │  ✓产品分析  ✓搜索策略  ✓Reddit✓YT  ✓评分   ✓推荐1-5  ✓推荐6-10  ✓策略
            │    │         │         │    │      │       │         │          │
用户体感    │  "分析中.." "搜索N平台" "找到X条"  "评估中" 【首条结果!】 更多结果  完整策略
            │                                    ↑                           ↑
            │                               ~12s 首条结果              ~22s 全部完成
```

---

### 7.6 LLM 调用层极速优化

```python
class OptimizedLLMService:
    """极速 LLM 调用层"""

    def __init__(self):
        # ── 优化 1：连接池复用 ──
        self.client = AsyncOpenAI(
            api_key=settings.QWEN_API_KEY,
            base_url=settings.QWEN_API_BASE,
            http_client=httpx.AsyncClient(
                limits=httpx.Limits(
                    max_connections=20,        # 最大连接数
                    max_keepalive_connections=10,  # 保持连接复用
                    keepalive_expiry=30        # 30s 连接保活
                ),
                timeout=httpx.Timeout(60.0, connect=5.0)  # 连接超时 5s
            )
        )
        # ── 优化 2：响应缓存（相同产品类型的搜索策略可复用）──
        self._cache = TTLCache(maxsize=100, ttl=3600)  # 1小时缓存

    async def chat_json(self, messages: list, cache_key: str = None) -> dict:
        """JSON 模式调用，支持缓存"""
        if cache_key and cache_key in self._cache:
            return self._cache[cache_key]

        response = await self.client.chat.completions.create(
            model=settings.QWEN_MODEL,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=0.3,        # 低温度 → 更稳定的 JSON 输出
            max_tokens=4096,        # 限制输出长度，减少生成时间
        )
        result = json.loads(response.choices[0].message.content)

        if cache_key:
            self._cache[cache_key] = result
        return result

    async def chat_json_parallel(self, task_list: list[dict]) -> list[dict]:
        """
        并行 LLM 调用（核心加速方法）

        task_list: [{"messages": [...], "cache_key": "..."}, ...]
        返回: 按原顺序排列的结果列表
        """
        tasks = [
            asyncio.create_task(self.chat_json(t["messages"], t.get("cache_key")))
            for t in task_list
        ]
        return await asyncio.gather(*tasks, return_exceptions=True)
```

**LLM 层优化要点**：
| 优化项 | 手段 | 效果 |
|--------|------|------|
| 连接复用 | httpx 连接池 `max_keepalive=10` | 省去 TCP/TLS 握手 ~200ms/次 |
| 并行调用 | `asyncio.gather` 多个 LLM 请求 | N 次串行 → 1 次并行耗时 |
| 输出控制 | `max_tokens=4096` + `temperature=0.3` | 减少无效生成，加速输出 |
| 缓存命中 | 相似产品类型的搜索策略模板缓存 | 热门品类二次分析秒返回 |
| Prompt 精简 | 每个 prompt 控制在 2000 tokens 内 | 减少输入处理时间 |

---

### 7.7 AgentGo 爬取层极速优化

```python
class OptimizedAgentGoService:
    """极速爬取服务"""

    def __init__(self):
        # ── 优化 1：httpx 连接池（长连接复用）──
        self.client = httpx.AsyncClient(
            base_url="https://app.agentgo.live",
            headers={"x-api-key": settings.AGENTGO_API_KEY},
            limits=httpx.Limits(max_connections=15, max_keepalive_connections=10),
            timeout=httpx.Timeout(20.0, connect=3.0)
        )
        # ── 优化 2：爬取结果缓存（同一 URL 1小时内不重复爬取）──
        self._scrape_cache = TTLCache(maxsize=500, ttl=3600)

    async def scrape_url(self, url: str, formats=None) -> dict:
        """单 URL 爬取，带缓存"""
        cache_key = hashlib.md5(url.encode()).hexdigest()
        if cache_key in self._scrape_cache:
            return self._scrape_cache[cache_key]

        response = await self.client.post("/api/scrape", json={
            "url": url,
            "formats": formats or ["markdown"],  # 只要 markdown，不要截图（省带宽）
            "timeout": 15000
        })
        result = response.json()
        self._scrape_cache[cache_key] = result
        return result

    async def scrape_batch_fast(self, urls: list[str], concurrency: int = 8) -> list[dict]:
        """
        批量并发爬取，优化版

        关键：用 asyncio.as_completed 实现"先到先用"
        """
        sem = asyncio.Semaphore(concurrency)
        results = {}

        async def _scrape(url):
            async with sem:
                try:
                    return url, await asyncio.wait_for(self.scrape_url(url), timeout=15)
                except Exception as e:
                    return url, {"error": str(e)}

        tasks = [asyncio.create_task(_scrape(url)) for url in urls]

        # as_completed：哪个先完成就先返回，不等最慢的
        for coro in asyncio.as_completed(tasks):
            url, result = await coro
            results[url] = result
            yield url, result  # 流式返回，调用方可立即处理
```

**AgentGo 层优化要点**：
| 优化项 | 手段 | 效果 |
|--------|------|------|
| 格式精简 | 只请求 `markdown`，不要 `html`/`screenshot` | 响应体积减少 60%，传输加速 |
| 并发提升 | Semaphore(8)，Scrape API 轻量可承受 | 8 个 URL 同时爬取 |
| 缓存避重 | MD5 去重 + TTL 1h 缓存 | 热门页面零延迟 |
| 超时控制 | 单个 URL 15s 硬超时 | 不被慢页面拖累 |
| 先到先用 | `as_completed` + `yield` 流式返回 | 快的平台结果立即进入下游处理 |
| 连接复用 | httpx 长连接池 | 省去重复 TCP 握手 |

---

### 7.8 前端感知速度优化

除了后端真实提速，前端通过以下手段让用户**感觉更快**：

```typescript
// ── 优化 1：骨架屏即时反馈 ──
// 用户点击发送的瞬间（0ms），立即展示：
// - 6 步进度条骨架
// - 3 张推荐卡片骨架（脉冲动画）
// 让用户知道"系统在工作"

// ── 优化 2：SSE 事件驱动渐进渲染 ──
// 不是等所有结果再一次性渲染，而是每条 SSE 事件立即更新 UI
const handleSSEEvent = (event: SSEEvent) => {
  switch (event.type) {
    case "status":
      updateStepProgress(event.data.step);  // 即时更新进度条
      break;
    case "platform_done":
      appendPlatformResult(event.data);     // 实时展示平台搜索结果数
      break;
    case "result":
      appendRecommendCard(event.data);      // 逐条渲染推荐卡片（带入场动画）
      break;
    case "strategy":
      renderStrategy(event.data);           // 展示运营策略
      break;
  }
};

// ── 优化 3：推荐卡片交错入场动画 ──
// 每张卡片延迟 150ms 入场，制造"逐个揭晓"的仪式感
// 实际后端可能同时返回了 5 张，前端 stagger 展示
const CARD_STAGGER_DELAY = 150; // ms

// ── 优化 4：乐观预渲染 ──
// Node3 爬取阶段就开始渲染"候选列表"（低保真版本）
// Node5 完成后无缝升级为完整推荐卡片（加载详情+话术）

// ── 优化 5：首屏优先 ──
// 后端先推送 Top 3（免费用户可见部分），再推送 4-10
// 用户最快 ~12s 就能看到有价值的结果
```

| 前端优化项 | 效果 |
|-----------|------|
| 骨架屏即时反馈 | 0ms 响应感，消除"点击无反应"焦虑 |
| SSE 渐进渲染 | 每个步骤完成立即可见，不等最终结果 |
| 卡片交错动画 | 制造"AI 在一个个分析"的高级感 |
| 首屏 Top 3 优先 | ~12s 就有可用结果，体感极快 |

---

### 7.9 数据库写入异步化

```python
# ── 分析结果的数据库写入不阻塞 SSE 流 ──
# 使用 asyncio.create_task 后台写入

async def run(self, user_input: str, user_id: int):
    # ... 工作流执行 ...

    # 结果推送给用户后，后台异步写入数据库
    asyncio.create_task(self._save_results_to_db(
        conversation_id, profile, recommendations, strategy
    ))

    yield SSEEvent("done", {...})
    # 不等数据库写入完成，用户已经看到结果
```

---

### 7.10 完整优化方案总结

| 优化维度 | 具体手段 | 节省时间 |
|---------|---------|---------|
| **Node 合并** | Node1+2 Prompt 合并为单次 LLM 调用 | **~3s** |
| **URL 预爬取并行** | AgentGo 爬取与 LLM 分析 `asyncio.gather` | **~2s** |
| **爬取管道化** | L1→L2 不等全部完成，流式触发 | **~10s** |
| **优先级调度** | High 先返回先处理，不等 Low | **~3s** |
| **评分分批并行** | 3-4 批 LLM 同时评分 | **~4s** |
| **Node5+6 交错** | 深度分析前半段完成即启动策略生成 | **~5s** |
| **LLM 连接池** | httpx keepalive 复用连接 | **~1s** (累计) |
| **缓存命中** | 相似产品/相同 URL 直接返回 | **~0-15s** (视命中率) |
| **响应精简** | 只请求 markdown，max_tokens 限制 | **~1-2s** |
| **DB 异步写入** | 不阻塞 SSE 响应 | **~0.5s** |
| **前端感知** | 骨架屏+渐进渲染+交错动画 | 体感快 **5s+** |
| | **总计节省** | **~28-35s** |

**最终性能指标**：
- 🚀 **首条推荐结果**：~12s（用户看到第一张推荐卡片）
- 🚀 **Top 3 完成**：~15s（免费用户看到完整结果）
- 🚀 **全部完成**：~22s（会员看到 Top 10 + 完整策略）
- 🚀 **缓存命中时**：~8s（相似产品二次分析）

---

## 八、关键技术决策说明

| 决策 | 选择 | 理由 |
|------|------|------|
| LLM 调用方式 | OpenAI 兼容接口 | Qwen 支持 OpenAI 格式，统一调用方式，未来可无缝切换其他模型 |
| 实时推送 | SSE（Server-Sent Events） | 单向推送够用，比 WebSocket 简单，浏览器原生支持 |
| 爬取方式 | Scrape API 优先 + Playwright 降级 | Scrape API 简单高效，Playwright 处理复杂场景 |
| 搜索策略 | LLM 动态生成 | 比硬编码灵活，能根据不同产品类型自适应 |
| 并发控制 | asyncio.Semaphore(8) + 优先级调度 | 提升并发度，Scrape API 轻量可承受，优先级保证核心结果先到 |
| 并行策略 | Node 合并 + 交错并行 + 流式管道 | 6 节点串行→3 个并行阶段，总耗时压缩 60% |
| 前端状态管理 | React useState/useEffect | 按 tech-stack-preferences 要求，不用 Redux |
| 样式方案 | Vanilla CSS + CSS Variables | 按 tech-stack-preferences 要求，不用 Tailwind |
| 感知速度 | 骨架屏 + SSE 渐进渲染 + 交错入场 | 后端未完成时用户已有可交互内容，体感领先 5s+ |
