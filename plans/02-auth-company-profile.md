# 02 · 账号、企业与企业档案

> 目标：用户可以注册登录，创建自己的企业（租户），并通过「上传资料 + 现有网址 + AI 整理」完成企业档案。企业档案是后续官网生成和商机匹配的唯一数据源。
> 结束状态：一家工厂可以在 10 分钟内完成建档，档案完整度可见。

---

## 1. 范围

**包含**：账号体系、多租户、成员角色、企业档案数据模型、资料上传、AI 抽取档案、档案编辑界面、「我的」Tab。
**不包含**：支付（计划 07）、助手对话（计划 03，但本计划提供可被助手调用的服务函数）。

---

## 2. 数据模型

| 表 | 关键字段 | 说明 |
|---|---|---|
| `users` | id, email, phone, password_hash, name, is_active, is_staff, created_at | `is_staff` 表示我方运营人员 |
| `sessions` | id, user_id, token_hash, expires_at, user_agent, ip | 只存 token 哈希 |
| `companies` | id, name_cn, name_en, plan, status, created_at | 租户 |
| `company_members` | company_id, user_id, role(`owner` / `member` / `operator`) | `operator` 为我方代运营人员被授权管理该企业 |
| `company_profiles` | company_id, founded_year, employees, factory_area, annual_capacity, export_markets[], certifications[], main_customers_public[], usp, about_en, contacts(JSON), completeness | 1:1 |
| `products` | id, company_id, name_en, name_cn, category, hs_codes[], specs(JSON), moq, lead_time, applications[], keywords_en[], images[] | 产品是商机匹配核心 |
| `assets` | id, company_id, kind(`image` / `pdf` / `certificate` / `catalog`), storage_key, mime, size, sha256 | 上传文件 |
| `profile_extractions` | id, company_id, source(`url` / `file` / `chat`), status, result(JSON), error | AI 抽取任务记录，便于审计和重试 |

所有业务表必须有 `company_id`，并通过统一的 `get_company_scope()` 依赖获取当前企业。

---

## 3. 后端任务

### 3.1 账号与会话

1. 邮箱 + 密码注册登录（密码使用 `argon2` 或 `bcrypt`）；手机号验证码登录预留接口（计划 07 接入短信服务）。
2. 会话 token：随机 32 字节，数据库只存 SHA-256；有效期 7 天；支持登出和「登出所有设备」。
3. 登录接口限流（按 IP + 账号），连续失败锁定 15 分钟。
4. 依赖注入：`current_user`、`current_company`（从请求头 `X-Company-Id` 读取并校验成员关系）、`require_role(...)`、`require_staff`。

### 3.2 企业与成员

1. 注册后引导创建企业；一个用户可属于多个企业（代运营人员需要）。
2. 邀请成员：生成一次性邀请链接（带过期时间）。
3. 接口：`POST /companies`、`GET /companies`、`GET/PATCH /companies/{id}`、`POST /companies/{id}/invites`、`POST /invites/{token}/accept`。

### 3.3 资料上传

1. 存储：本地卷（首版）+ 抽象接口，后续可切换到对象存储。
2. 校验：按文件头判断真实类型，只允许 jpg / png / webp / pdf；单文件 20MB 上限；文件名不参与存储路径（使用随机 key）。
3. 图片去除 EXIF；PDF 只做文本提取，不执行任何嵌入内容。
4. 下载走带签名、带过期时间的链接，并校验企业归属。

### 3.4 AI 建档

1. `extract_from_url(url)`：通过 `safe_fetch` 抓取企业现有网站（首页 + 最多 10 个同域页面），LLM 抽取结构化档案。
2. `extract_from_files(asset_ids)`：从产品目录 PDF、证书中抽取产品与资质。
3. `extract_from_text(text)`：从用户口述（例如在助手里说的一段话）中抽取。
4. 抽取结果不直接覆盖档案，而是生成「待确认的变更」，用户确认后合并；每个字段记录来源。
5. 档案完整度计算：按官网生成和商机匹配所需字段加权，输出缺失项列表（用于引导）。
6. 抽取在 worker 中异步执行，前端轮询或通过 SSE 获取进度。

---

## 4. 前端任务

### 4.1 登录与注册

- 页面：`NavBar` + `FormFields` / `FormSingleLine` + 主按钮 `Button type="Primary" size="L"`
- 交互遵循 `form-validation-timing`：信息不完整时按钮置灰；格式错误和服务端错误只走 `Toast`，不插入行内红字
- 注册后进入「创建企业」页（单字段：企业中文名，可选英文名）

### 4.2 建档引导（首次进入）

三选一入口，使用 `ActionSheet` 或 `List` 呈现：

1. **有现有网站** → 输入网址 → 进入 AI 抽取进度
2. **上传资料** → 选择产品目录 / 图片 / 证书 → AI 抽取
3. **和助手聊** → 跳转助手 Tab，助手按问题逐项收集（计划 03 实现对话部分）

抽取进度页：使用 `Markdown variant="Progress"` 展示步骤；完成后进入「确认变更」页。

### 4.3 确认变更页

- 按分组展示 AI 抽取结果：公司信息、产品、资质、联系方式
- 每一项可勾选「采纳 / 忽略」（`RadioCheckBox`），可点击编辑
- 底部固定 `Button` 「确认合并」

### 4.4 「我的」Tab

| 分组（`ListSectionTitle`） | 项（`SettingsItems`） |
|---|---|
| 企业 | 企业档案（显示完整度百分比）、产品管理、资质与资料、成员 |
| 获客 | 商机监控设置（计划 05 接入）、开发信签名（计划 06 接入） |
| 账户 | 套餐与用量（计划 07）、切换企业、退出登录 |

- 企业档案编辑页：分区列表 → 点击进入单区编辑表单
- 产品管理：`List` 展示产品，右上角新增；产品编辑支持多张图片和英文关键词
- 退出登录使用 `Dialog` 二次确认

### 4.5 状态覆盖

- 无企业：引导创建
- 档案为空：`EmptyPage` + 「开始建档」按钮
- 抽取失败：保留已上传资料，`Toast` 说明原因并提供重试
- 网络异常：`EmptyPage type="networkError"`

---

## 5. 安全要点

- 所有接口的企业归属测试：用户 A 无法读取 / 修改企业 B 的档案、产品、资料（每个接口一条测试）
- 抓取企业网站必须经过 `safe_fetch`；用户输入的网址也可能指向内网
- AI 抽取的文本在前端按纯文本渲染
- 上传文件不可通过可猜测的路径直接访问

---

## 6. 验收标准

- [ ] 注册 → 创建企业 → 输入真实工厂网址 → 10 分钟内得到可确认的档案草稿
- [ ] 确认后档案完整度正确显示，缺失项可点击跳转补充
- [ ] 产品增删改、图片上传正常，非法文件类型被拒绝
- [ ] 越权测试全部通过
- [ ] 登录限流生效
- [ ] 所有页面覆盖默认、加载、空态、错误状态，并完成 402×874 截图检查
