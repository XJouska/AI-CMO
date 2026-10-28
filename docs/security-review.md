# 安全审查记录

- 审查日期：2026-10-28
- 范围：提交 `b859c43` 之后的全部新代码（`backend/`、`apps/web/`、`deploy/`、`site-templates/`），含计划 07 改动
- 方式：安全审查子代理完整审查（只读）+ 自动化测试复核 + 本机 aicmo-v2 部署验证

## 结论

两轮审查（第一轮覆盖部署与计划 07 新代码，第二轮补充覆盖全部后端模块与安全相关前端）均未发现高危问题。
共发现 6 个中危问题，均已修复并增加回归测试 / 部署验证。

## 发现与修复

### M1 · 客户官网 Host 可越过发布目录读取历史 / 草稿版本（中危，已修复）

- **位置**：`deploy/nginx/sites.conf`
- **问题**：`root /data/sites/live/$host`，Host 校验允许 `.`、`..`、连续点。`Host: ..` 会让根目录退回 `/data/sites`，若知道版本 UUID（例如来自过期的预览链接）可直接读取 `versions/` 下的草稿与已下线版本，绕过预览签名与过期限制。
- **修复**：
  - Host 必须匹配严格域名格式（每个标签 1–63 位字母数字 / 连字符、不得以连字符开头结尾、至少两个标签），否则直接断开（444）
  - 增加纵深防御：任何以 `/versions`、`/live`、`/.` 开头的路径一律 404
- **验证**：本机 sites 容器中，`Host: .` / `..` / `a..b` 均返回 400，`-a.example`、`x` 被断开；合法域名访问 `/versions/...` 返回 404；官网冒烟脚本（发布 → 访问 → 询盘）通过。

### M2 · `X-Forwarded-For` 可伪造，绕过公开接口的 IP 限流（中危，已修复）

- **位置**：`deploy/api/Dockerfile`（`--forwarded-allow-ips='*'`）、`deploy/nginx/web.conf` / `sites.conf`（`$proxy_add_x_forwarded_for` 保留客户端传入值）
- **问题**：攻击者每次请求伪造不同的 XFF，可绕过注册 / 登录、官网询盘、联系人删除请求的 IP 限流。
- **修复**：
  - uvicorn 只信任容器内网代理（`10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`）
  - Nginx 只信任内网上游的 XFF（`set_real_ip_from` 内网段 + `real_ip_recursive off`），向 api 转发时用单一可信地址覆盖 XFF
  - 生产入口 Caddy 用连接地址覆盖 `X-Forwarded-For` / `X-Real-IP`（`deploy/caddy/Caddyfile`）
  - `/metrics` 与内部接口 `/api/v1/public/internal/*` 在公网入口直接 404；生产环境 `/metrics` 未配置 `METRICS_TOKEN` 时拒绝访问（不依赖来源 IP）
- **验证**：本机部署中带伪造 `X-Forwarded-For: 127.0.0.1` 访问内部接口返回 404；`/metrics` 经公网入口 404，容器内携带令牌可正常抓取；`test_metrics_internal_access_and_unmatched_route` 覆盖生产环境无令牌拒绝。

### M3 · 注销企业后仍残留已构建的官网文件（中危，已修复）

- **位置**：`backend/app/modules/admin/compliance.py`（`delete_company_data`）
- **问题**：注销只移除 live 链接和上传文件，`/data/sites/versions/{site_id}` 下的 HTML 与图片仍保留在数据卷中。
- **修复**：新增 `render.purge_site()`，注销时下线并删除站点全部已构建版本；删除失败时抛出异常，事务回滚，注销不生效（可重试）。备份按 14 天保留期自动删除，注销数据在 14 天内从备份中消失（已写入运维手册与隐私政策）。
- **验证**：`test_delete_company_purges_published_site_files`（发布一个站点后注销，断言 live 链接与版本目录均不存在）。

### M4 · 助手与官网改写可绕过套餐和 AI 用量限制（中危，已修复）

- **位置**：`backend/app/modules/assistant/router.py`、`orchestrator.py`；`backend/app/modules/sites/service.py`（生成 / 改写）；助手工具 `site_generate_draft` / `site_update_section`
- **问题**：助手每轮直接调用 LLM 只记录用量、不检查额度；官网改写接口和助手中的官网工具不检查套餐。套餐到期或额度用尽的用户仍可持续消耗平台模型费用。
- **修复**：
  - 新增 `billing.require_ai()`（套餐有效 + 功能 + 本月 AI 用量余量），助手每个回合、官网生成 / 改写（服务层，接口与工具共用）、资料抽取、开发信生成全部经过
  - 助手增加每企业每分钟 20 个回合的速率限制
  - `lead_run_now` 工具同样检查商机功能与监控次数额度
- **验证**：`test_assistant_blocked_when_quota_exhausted_or_expired`、`test_assistant_rate_limited`、`test_site_rewrite_and_tools_respect_plan`。

### M5 · 有副作用的助手工具无需确认，可被外部内容诱导执行（中危，已修复）

- **位置**：`watch_update`、`lead_run_now`、`pipeline_update_stage`
- **问题**：这三个工具会直接修改监控、启动付费任务、变更跟进阶段，却不需要用户确认。攻击者可在官网询盘中写入指令，用户让助手查看询盘时模型可能被诱导调用。
- **修复**：
  - 工具注册时必须声明副作用类型：`read`（只读）/ `draft`（只生成待确认草稿）/ `write`（直接生效）；`write` 工具未设置确认时**注册即报错**
  - 上述三个工具改为需要确认，并提供明确的确认卡片内容（新增 / 移除哪些关键词、变更为哪个阶段，放弃 / 无效标红）
- **验证**：`test_side_effect_tools_require_confirmation`（全部工具分类检查 + 未确认的 write 工具无法注册）、`test_injected_inquiry_cannot_change_watch_without_confirmation`（模型被诱导调用后只出现确认卡片，数据不变）。

### M6 · 并发发送可重复发信并突破限额（中危，已修复）

- **位置**：`backend/app/modules/outreach/router.py`（`send_draft`）
- **问题**：草稿状态检查、限额检查、SMTP 发送与状态更新不是原子操作，并发请求可重复发送同一封邮件并突破每日 / 套餐限额。
- **修复**：两阶段发送——先在加锁事务中（`SELECT … FOR UPDATE` 锁定草稿与发信邮箱）检查并把草稿置为 `sending`，同时写入发送记录与用量（立即计入限额），提交后再调用邮件服务器；发送失败时撤销占位。编辑与手动标记发送同样加锁并拒绝 `sending` 状态。
- **验证**：`test_concurrent_send_only_sends_once`（真实数据库两个并发事务，只发出一封，另一个得到 `draft_sent`，用量记为 1）、`test_send_failure_releases_reservation`（失败不占用额度，可重发）。

## 自动化守卫补强

审查指出 `test_route_guard.py` 缺少逐接口角色矩阵，已补充：

- `tests/tenancy_matrix.py` 为只允许部分角色的接口标注 `roles`（发布官网、域名、发信邮箱、导出、注销、企业微信、在线支付、企业设置、邀请）
- `test_role_restricted_routes_reject_members`：普通成员调用全部返回 403
- `test_role_restricted_routes_are_declared`：代码中 `require_role` / `_require_manager` / `path_scope(..., MANAGER_ROLES)` 的数量必须与矩阵标注一致，新增受限接口忘记标注时测试失败

## 检查清单（计划 07 第 8 节）

| 检查项 | 结果 | 依据 |
|---|---|---|
| 所有接口的认证、企业归属、角色校验（自动化覆盖 100%） | 通过 | `test_route_guard.py`：全部路由必须登记；未登录 401、非成员 403、跨企业资源 404、非 staff 403、受限角色 403 |
| SSRF：抓取、健康检查、买家补全、SMTP、Webhook | 通过 | `safe_fetch`（每一跳重新校验并固定 IP）；`check_smtp_host`（端口 465/587、固定 IP、TLS 按主机名校验）；企业微信 Webhook 只允许 `qyapi.weixin.qq.com` 且经 `safe_fetch`；浏览器子请求守卫；`test_ssrf.py`、`test_mailer.py`、`test_services.py` |
| XSS：应用、官网模板、询盘、LLM 输出、开发信预览 | 通过 | 前端无 `dangerouslySetInnerHTML`（`check-web` 规则）；Markdown 不解析 HTML、链接只允许 http/https；Jinja2 autoescape + nh3；退订页转义；通知只跳转站内相对路径 |
| SQL 注入 | 通过 | 全部使用 SQLAlchemy 表达式；无原生拼接 SQL |
| 无 shell 调用、无 pickle / 不安全 YAML | 通过 | 代码库检索无 `subprocess`、`os.system`、`pickle`、`yaml.load` |
| 密钥只在环境变量；仓库与镜像中无明文 | 通过 | `.env*` 已忽略；邮箱凭据与企业微信 Webhook 用 Fernet 加密存储（支持密钥轮换）；生产环境缺少 `MAIL_ENCRYPTION_KEY` 拒绝启动；日志脱敏 |
| 公开接口限流；登录防爆破 | 通过 | 登录 IP 限流 + 账号锁定；注册限流；询盘限流 + 蜜罐 + Turnstile 接口；联系人删除请求每 IP 每天 5 次 + 蜜罐；退订链接签名；支付回调验签 |
| 依赖漏洞扫描无高危 | 通过（报告性） | `check-all` 执行 `pip-audit` 与 `npm audit --omit=dev` |
| 安全响应头与 CSP | 通过 | 应用：严格 CSP、`frame-ancestors 'none'`、nosniff、Referrer-Policy；官网：`script-src 'none'`；生产 HSTS |
| 提示词注入：外部内容无法触发有副作用的工具 | 通过 | 外部内容作为 JSON 数据传入并转义尖括号；工具按副作用分类，直接生效的工具注册时强制要求用户确认（M5）；`test_prompt_injection_*`、`test_injected_inquiry_*` |
| 支付回调 | 通过 | 验签、金额以服务端订单为准、行锁 + 幂等、手工开通仅 staff；`test_online_payment_*` |
| 文件上传与下载 | 通过 | 文件头识别、大小限制、图片重编码去 EXIF、PDF 页数限制；下载签名绑定资源与企业并有过期时间 |
| 容器与网络 | 通过 | 全部容器非 root、去除 capabilities、`no-new-privileges`；数据库与 api 不暴露端口；生产只有 Caddy 暴露 80/443 |
| 审计日志不可被客户篡改 | 通过 | 无修改 / 删除审计日志的接口；注销企业时审计日志保留（企业关联置空） |

## 后续建议（未作为问题处理）

- 生产上线后对 `/api/v1/auth/register`、询盘接口增加基于 Caddy 的速率限制（第二道防线）
- 引入定期依赖升级（每月）并在 CI 中把高危漏洞设为阻断
- 备份同步到异地对象存储，并为对象存储启用版本保留期限
