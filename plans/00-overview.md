# 00 · 总览：AI-CMO 外贸获客平台重构

> 本目录是项目重构的唯一权威计划。按 `01 → 07` 线性执行，每个计划结束时必须满足其「验收标准」才进入下一个。
> 旧项目（社媒舆情监测 / 营销推广）整体废弃，只按本文件的「保留清单」挑选少量底层代码迁移。

---

## 1. 产品定义

### 1.1 一句话定位

帮助不会做海外数字化营销的中国外贸工厂，用 AI 快速建立专业的英文品牌官网，并持续发现正在采购其产品的海外企业和招标机会，把它们变成可跟进的商机。

### 1.2 业务闭环

```
企业建档 → 生成品牌官网 → 设置商机监控 → AI 发现采购信号 → 评分与人工复核
   → 商机推送 → 生成开发信 / 跟进 → 状态回传 → 周报与效果复盘
                     ↑
        官网询盘表单 ─┘（官网本身也是线索入口）
```

### 1.3 用户角色

| 角色 | 说明 | 主要端 |
|---|---|---|
| 企业用户（工厂老板 / 外贸业务员） | 查看商机、跟进客户、管理官网 | 移动端 H5（主），桌面浏览器居中显示 |
| 运营人员（我方服务团队） | 帮客户建档、复核商机质量、调整监控 | 同一应用内的运营视图（按角色开放） |
| 管理员 | 租户、套餐、成本和系统配置 | 运营视图中的管理分区 |

商业模式是「前台代运营服务 + 后台 AI 自动化交付」，所以**人工复核**是一等公民功能，不是附加项。

### 1.4 明确不做（首版）

- 社媒舆情监测、情感分析、危机预警（旧功能，全部删除）
- 社媒自动发帖、自动评论（`skill/aicmo-autopost` 全部删除）
- GEO 可见度、竞品库、通用 AI 写作、终端活动流、开放 API Key
- 全自动群发邮件（只做草稿 + 人工确认发送）
- 抓取 LinkedIn 等明确禁止爬取的平台
- 微信小程序 / 原生 App（H5 先行）

---

## 2. 设计系统：yb-mobile-design

用户指定使用 `yb-mobile-design-GO.zip`（元宝移动端设计系统）重构全部 UI 与交互。

### 2.1 设计包里有什么

| 内容 | 位置（zip 内） | 用途 |
|---|---|---|
| 正式组件 React 实现 | `demo/src/generated/components.tsx`（约 160 个正式组件导出 + 大量图标） | 页面只组合这些组件 |
| 组件渲染实现 | `demo/src/library/**` | 由设计包维护，业务侧不修改 |
| 设计 Token | `demo/src/tokens.css`（186 个 CSS 变量，含 Light / Dark） | 自建组件只能用 Token |
| 设备壳与浮层宿主 | `HostCanvas`、`DeviceOverlays`（`ModalLayer` / `FeedbackLayer`） | 弹窗、Sheet、Toast 的挂载与层级 |
| 静态资源 | `demo/public/**`（图标 SVG、插画、Loading 动图） | 组件依赖的资源 |
| 字体 | `assets/fonts/`（PingFang SC、DIN Pro，约 39MB） | 见 2.3 授权风险 |
| 交互规范 | `references/interaction-patterns.md`、`conversation-content-domain.md`、`design-guidelines.md` | 交互逻辑的规范依据 |
| 示例页面 | `demo/src/screens/generated/agent.tsx`、`source-outreach.tsx` | 对话页、信源卡片的参考实现 |

### 2.2 本项目使用的核心组件（按业务映射）

| 业务需要 | 正式组件 |
|---|---|
| 顶部导航 | `NavBar`（`barType="Agent"` 用于助手页；普通页用 Fixed Color Bg） |
| 底部 Tab + 输入框 | `TabBar`（`selected="Tab 1 & Input"` 时内含 `AgentInput`） |
| 对话消息与结构化回答 | `Markdown`（prompt / Progress / H3 / Body / OL / UL / Quote / Table / followUp / Toolbar 等变体） |
| 商机卡片、结果卡片 | `Card`、`List`、`Tag`、`Status`、`BadgeNumber` |
| 筛选 | `Tab`、`Search` |
| 表单 | `FormFields`、`FormSingleLine`、`FormDoubleLine`、`Switch`、`RadioCheckBox`、`Button` |
| 设置与档案 | `SettingsItems`、`ListSectionTitle`、`ListTrailingContent`、`ListTrailingSwitch` |
| 浮层 | `BottomSheet`、`ActionSheet`、`Dialog`、`Mask` |
| 反馈 | `Toast`、`Snackbar`、`Notification`、`Tip`、`Loading`、`EmptyPage` |

### 2.3 必须先解决的三个设计系统风险（在计划 01 处理）

1. **TabBar 文案写死**：正式 `TabBar` 的四个 Tab 固定为「问元宝 / 派 / 发现 / 我们」，没有公开属性可改。需要在 `packages/yb-ui` 中做最小扩展（新增 `items` 属性），并登记为「本地扩展」。
2. **元宝品牌资产**：`yuanbao-brand.svg`、`IcLogo`、默认文案「元宝」等必须替换为本产品品牌，不能出现在交付界面。同时需要确认该内部设计系统用于商业产品的授权。
3. **字体授权**：设计包 README 明确说明字体文件不构成网页部署授权。开发环境可用随包字体；生产环境默认回退系统字体（`PingFang SC` 在 iOS / macOS 系统自带），除非取得授权。字体文件不提交到 git。

### 2.4 UI 硬规则（所有计划通用）

- 页面只组合 `@yb/generated/components` 的正式组件和合法属性值，**不手绘正式组件外观**。
- 正式组件无法满足时才算「缺口」，自建组件放在 `apps/web/src/components/local/`，只能使用 `tokens.css` 的变量，并在 `docs/ui-gaps.md` 登记原因。
- 交互遵循设计包规范：
  - 表单未完成时主按钮置灰禁用，错误只走 `Toast`，不插入行内红字（`form-validation-timing`）
  - 落地页空态 / 弱网用 `EmptyPage`，相对整屏垂直居中（`page-empty`、`page-weak-network`）
  - 对话生成中弱网保持输出中，延迟轻提示（`in-stream-weak-network`）
  - 贴边壳层（NavBar、TabBar、键盘）铺满画布，内容层单独留页面边距（`edge-chrome-vs-content-inset`）
  - 对话回答遵循「思考中 → 完成 → 错误重试」状态，建议操作在内容之后，回复级操作最后（`conversation-content-domain`）
- Light 主题为首发主交付，Dark 主题在计划 07 前补齐。

---

## 3. 目标架构

### 3.1 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19 + Vite + TypeScript，React Router，TanStack Query，原生 CSS + 设计 Token |
| 设计系统 | `packages/yb-ui`（从设计包 vendored，别名 `@yb`） |
| 后端 | FastAPI（Python 3.11+）+ SQLAlchemy 2 + Alembic 迁移 + Pydantic v2 |
| 数据库 | PostgreSQL 15 |
| 后台任务 | 独立 `worker` 进程：APScheduler 定时 + PostgreSQL 任务表（`FOR UPDATE SKIP LOCKED`），首版不引入 Redis |
| 抓取 | Playwright（持久化 Profile）+ httpx 兜底，统一经过 SSRF 防护 |
| LLM | OpenAI 兼容接口（可切换 Qwen / DeepSeek 等），结构化 JSON 输出 |
| 客户官网 | Jinja2 静态站点生成（开启自动转义），Nginx 托管 |
| 部署 | Docker Compose：`db` / `api` / `worker` / `web` / `sites` |

### 3.2 目标目录结构

```
ai-cmo/
├── apps/
│   └── web/                    # 新前端（移动端 H5）
├── packages/
│   └── yb-ui/                  # 设计系统（来自 zip 的 demo/src + demo/public）
├── backend/
│   ├── app/
│   │   ├── core/               # 配置、数据库、安全、SSRF 防护、日志
│   │   ├── modules/
│   │   │   ├── auth/           # 账号与会话
│   │   │   ├── companies/      # 企业（租户）与企业档案
│   │   │   ├── assistant/      # AI 获客助手（对话 + 工具调用）
│   │   │   ├── sites/          # 官网生成、编辑、发布、询盘
│   │   │   ├── sources/        # 商机数据源连接器
│   │   │   ├── leads/          # 商机、评分、去重、复核
│   │   │   ├── outreach/       # 开发信与跟进
│   │   │   ├── billing/        # 套餐与用量
│   │   │   └── admin/          # 运营与管理
│   │   ├── services/           # llm、browser 等基础服务
│   │   └── workers/            # 定时任务与任务执行器
│   ├── alembic/
│   └── tests/
├── site-templates/             # 客户官网模板（桌面 + 移动响应式，不使用 yb-ui）
├── deploy/                     # nginx、compose、证书脚本
├── docs/                       # 架构、API、UI 缺口登记、运维手册
└── plans/                      # 本计划目录
```

注意：**客户官网是面向海外采购商的桌面优先网站**，使用独立的 B2B 模板，不使用 yb-ui 移动端设计系统。yb-ui 只用于本产品自身的应用界面。

### 3.3 应用信息架构（移动端，四个 Tab）

| Tab | 名称 | 内容 | 计划 |
|---|---|---|---|
| Tab 1 | 助手 | AI 获客助手对话：建档、生成官网、设置监控、查询商机、写开发信、周报 | 03 |
| Tab 2 | 商机 | 商机列表、筛选、详情、跟进动作 | 05、06 |
| Tab 3 | 官网 | 官网预览、分区编辑、发布、询盘、健康检查 | 04 |
| Tab 4 | 我的 | 企业档案、监控设置、成员、套餐、设置；运营人员可见运营入口 | 02、07 |

---

## 4. 删除清单与保留清单

### 4.1 直接删除

- `frontend/` 整个目录（旧 UI）
- 旧后端中与新业务无关的模块：`geo`、`seo`（思路迁入官网健康检查后删除）、`competitors`、`content`、`ai_chat`、`terminal`、`open_api`、`dashboard`、`feedback`、`history`、`chat`（舆情工作流）、`credits`（旧积分体系）、旧 `prompts/`、`utils/parsers.py`
- `skill/`、`skill_cn/`、`skill_cn.zip`
- `DEVELOPMENT-GUIDE.md`（舆情版文档）、`setup-ssl.sh`、`deploy.sh`（由 `deploy/` 取代）
- 已在工作区标记删除的旧文档和资产（`AGENTGO-API.md` 等）

### 4.2 审查后迁移（不原样照搬）

| 旧文件 | 迁移到 | 处理 |
|---|---|---|
| `backend/app/services/browser_service.py` | `backend/app/services/browser.py` | 保留 Playwright 持久化、httpx 兜底、缓存；**新增 SSRF 防护** |
| `backend/app/services/llm.py` | `backend/app/services/llm.py` | 保留连接池、重试、JSON 模式；增加用量统计 |
| `backend/app/services/seo_service.py` | `backend/app/modules/sites/health.py` | 只保留检测规则思路，用于官网健康检查 |
| 旧 `database.py` 的用户 / 会话逻辑 | `modules/auth` | 参考后重写，改用 Alembic |

### 4.3 删除前的保护动作

1. 先把当前工作区未提交的改动提交为一个快照提交。
2. 打标签 `legacy-sentiment-v1`，旧代码随时可从 git 历史找回。
3. `yb-mobile-design-GO.zip` 和字体文件加入 `.gitignore`，不提交到仓库。

---

## 5. 安全基线（所有计划强制）

| 风险 | 规则 |
|---|---|
| SQL 注入 | 只用 SQLAlchemy ORM 或参数绑定，禁止字符串拼接 SQL |
| 命令执行 | 不调用 shell；必须调用外部程序时使用参数列表且不拼接用户输入 |
| 越权 | 所有业务数据带 `company_id`；每个接口做身份校验 + 归属校验；运营 / 管理权限单独校验 |
| XSS | 前端不使用 `dangerouslySetInnerHTML`；LLM 与用户内容按纯文本渲染；官网模板开启 Jinja2 自动转义；富文本经白名单清洗 |
| SSRF | 所有服务端出网请求经过统一的 `safe_fetch`：解析 DNS 后拒绝回环、私有、链路本地、保留地址，额外拒绝 `9.*`、`10.*`、`11.*`、`21.*`、`30.*`；跳转后重新校验；只允许 http / https 和 80 / 443 端口。默认不允许访问内部域名，如需开放必须由项目负责人确认后加白名单 |
| 反序列化 | 只用 `json` / Pydantic 解析；禁止 `pickle`、`yaml.load`（如需 YAML 用 `safe_load`） |
| 密钥 | 一律通过环境变量；仓库只保留 `.env.example`；`docker-compose.yml` 中的数据库密码改为环境变量 |
| 公开接口 | 官网询盘接口加限流 + 人机校验 + 字段长度限制 |
| 数据合规 | 抓取遵守 robots.txt 和平台条款；联系人信息只采集公开的企业联系方式，保留来源链接，支持删除请求 |

---

## 6. 计划清单与依赖

| 编号 | 计划 | 核心产出 | 依赖 |
|---|---|---|---|
| 01 | [仓库清理与新骨架](01-foundation.md) | 新目录结构、yb-ui 接入、应用壳、后端骨架、部署骨架 | 无 |
| 02 | [账号、企业与企业档案](02-auth-company-profile.md) | 登录注册、租户隔离、企业档案 AI 建档 | 01 |
| 03 | [AI 获客助手](03-assistant.md) | 对话主界面、SSE 流式、工具调用框架 | 02 |
| 04 | [品牌官网生成与托管](04-site-builder.md) | 模板、AI 生成、编辑、发布、询盘回流 | 02、03 |
| 05 | [商机情报引擎](05-lead-intelligence.md) | 数据源、定时监控、评分去重、商机界面 | 02、03 |
| 06 | [触达与跟进](06-outreach-pipeline.md) | 开发信、跟进状态、提醒、周报 | 05 |
| 07 | [运营后台、计费与上线](07-ops-billing-launch.md) | 人工复核、套餐、通知、可观测性、安全审查、生产部署 | 01–06 |

### 6.1 里程碑

- **M1（01–03 完成）**：可以登录、建档，并在助手中对话。
- **M2（04 完成）**：可以为一家真实工厂生成并发布英文官网。
- **M3（05–06 完成）**：可以为试点客户每天交付经过复核的商机，并记录跟进结果。
- **M4（07 完成）**：可以收费、可以运维，满足两家付费试点客户的正式交付。

---

## 7. 每个计划的通用完成定义

- 后端：Alembic 迁移可从空库执行；`pytest` 通过；新增接口都有归属校验测试。
- 前端：`npm run typecheck`、`npm run build` 通过；关键页面在 402×874 和桌面宽度下截图检查。
- 交互：每个页面覆盖默认、加载、空态、错误四种状态。
- 文档：`docs/` 中更新对应模块说明；UI 缺口登记到 `docs/ui-gaps.md`。
- 安全：本计划新增的出网请求、公开接口、用户内容渲染都按第 5 节自查。
