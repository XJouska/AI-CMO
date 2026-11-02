# AI-CMO v2 运维手册

> 适用于 `deploy/` 下的 docker compose 部署（项目名 `aicmo-v2`）。所有命令在仓库根目录执行。

## 1. 组成

| 服务 | 说明 | 对外 |
|---|---|---|
| `caddy` | 入口：自动 HTTPS（应用域名、平台子域名、客户自定义域名） | 80 / 443（仅生产覆盖文件） |
| `web` | Nginx 托管前端，`/api/` 反代到 api | 否（开发模式 `127.0.0.1:9020`） |
| `api` | FastAPI；启动时自动执行 `alembic upgrade head` | 否 |
| `worker` | 任务执行器 + 定时调度（商机监控、提醒、周报、通知投递、告警检查、数据清理）+ 浏览器 | 否 |
| `sites` | 客户官网静态托管（按 Host 选择发布目录） | 否（开发模式 `127.0.0.1:9021`） |
| `db` | PostgreSQL 15，只在内部网络 | 否 |

所有应用容器非 root、只读根文件系统（worker 除外）、`no-new-privileges`、去除全部 capabilities。

## 2. 首次上线

1. **DNS**
   - `APP_DOMAIN`（例如 `app.aicmo.site`）A 记录指向服务器
   - `*.SITES_BASE_DOMAIN`（例如 `*.sites.aicmo.site`）A 记录指向服务器
   - 客户自定义域名：客户添加 CNAME 指向 `<subdomain>.SITES_BASE_DOMAIN`，并在应用中完成 TXT 验证
2. **密钥**（写入 `.env`，权限 600，不入库）
   - `SECRET_KEY`：`python -c "import secrets; print(secrets.token_urlsafe(48))"`
   - `MAIL_ENCRYPTION_KEY`：`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`；**另行离线保存**，丢失后已绑定的发信邮箱需要重新绑定
   - `POSTGRES_PASSWORD`、`METRICS_TOKEN`：随机长字符串
   - 备份密钥：`openssl rand -base64 48 > /root/.aicmo-backup.key && chmod 600 /root/.aicmo-backup.key`，**另行离线保存**
3. **其他必填**：`APP_DOMAIN`、`SITES_BASE_DOMAIN`、`SITES_SCHEME=https`、`PUBLIC_BASE_URL=https://APP_DOMAIN`、`ACME_EMAIL`、`LLM_API_KEY`
4. **启动**
   ```bash
   docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml --env-file .env -p aicmo-v2 up -d --build
   docker compose -p aicmo-v2 ps          # 全部 healthy / running
   curl -fsS https://$APP_DOMAIN/health   # {"status":"ok","database":"ok"}
   ```
5. **创建运营账号**：先在应用中注册，再在数据库中标记为 staff：
   ```bash
   docker exec -it aicmo-v2-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE users SET is_staff = true WHERE email = '\''ops@yourcompany.com'\''"'
   ```
6. **定时任务（宿主机 cron）**
   ```cron
   # 每日 03:00 备份
   0 3 * * * cd /home/ai-cmo && BACKUP_DIR=/var/backups/aicmo-v2 BACKUP_KEY_FILE=/root/.aicmo-backup.key deploy/backup.sh >> /var/log/aicmo-backup.log 2>&1
   # 每周日 04:00 恢复演练（恢复到临时库并校验，不影响线上）
   0 4 * * 0 cd /home/ai-cmo && BACKUP_KEY_FILE=/root/.aicmo-backup.key deploy/restore.sh "$(ls -t /var/backups/aicmo-v2/aicmo-*.tar.enc | head -1)" >> /var/log/aicmo-restore-drill.log 2>&1
   ```

## 3. 发布新版本

```bash
git pull
node scripts/check-all.mjs                     # 本地 / CI 全部检查通过后再发布
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml --env-file .env -p aicmo-v2 build
BACKUP_KEY_FILE=/root/.aicmo-backup.key deploy/backup.sh   # 发布前备份
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml --env-file .env -p aicmo-v2 up -d
```

- api 启动时执行数据库迁移；迁移失败 api 不会变为 healthy，web / worker 不会切换到新版本
- 迁移均可回退（CI 中执行 `upgrade head → downgrade base → upgrade head`）

## 4. 回滚

1. 代码回滚：`git checkout <上一个发布的提交>`，重新 `build` + `up -d`
2. 如果新版本包含数据库迁移且需要回退：
   ```bash
   docker compose -p aicmo-v2 exec api alembic downgrade <上一个版本号>   # 例如 0006_outreach
   ```
   然后再执行第 1 步。迁移文件见 `backend/alembic/versions/`，版本号写在文件名中。
3. 数据损坏时按第 5 节从备份恢复。

## 5. 备份与恢复

- 备份内容：数据库（`pg_dump` 自定义格式）+ 上传文件卷 + 官网产物卷，AES-256（PBKDF2 20 万次）加密，保留 14 天
- **恢复演练**（不影响线上）：`BACKUP_KEY_FILE=... deploy/restore.sh <备份文件>`，输出迁移版本、核心表行数、文件数
- **正式恢复**：
  ```bash
  docker compose -p aicmo-v2 stop api worker
  RESTORE_MODE=production BACKUP_KEY_FILE=... deploy/restore.sh <备份文件>   # 需要输入 RESTORE 确认
  docker compose -p aicmo-v2 start api worker
  ```
- 建议把备份目录同步到异地（对象存储），密钥与备份分开保存

## 6. 证书

- 应用域名、客户自定义域名：Caddy 自动申请（HTTP-01）。自定义域名采用 on-demand TLS，签发前调用 `GET /api/v1/public/internal/tls-ask?domain=…`，只有**已验证且已发布**的域名会签发，防止被滥用申请证书
- 平台子域名 `*.SITES_BASE_DOMAIN`：on-demand 方式按子域名逐个签发（同样经过 ask 校验）。子域名数量大时建议改用泛域名证书（需要 Caddy DNS 插件，例如 `caddy-dns/cloudflare`，在 Caddyfile 中为 `*.{$SITES_BASE_DOMAIN}` 配置 `tls { dns cloudflare {env.CF_API_TOKEN} }`）
- 证书到期：Caddy 自动续期；`docker compose -p aicmo-v2 logs caddy | grep -i error` 查看续期失败

## 7. 监控与告警

- **健康检查**：`GET /health`（数据库连通）
- **指标**：`GET /metrics`（Prometheus 文本格式）。需 `Authorization: Bearer $METRICS_TOKEN`；未配置令牌时只允许内网来源。主要指标：
  - `aicmo_http_requests_total` / `aicmo_http_request_seconds`：按路由模板统计的请求数与耗时
  - `aicmo_jobs_backlog`、`aicmo_jobs_oldest_wait_seconds`、`aicmo_jobs_failed_24h`：任务队列
  - `aicmo_worker_heartbeat_age_seconds`：worker 存活（> 300 即告警）
  - `aicmo_source_failure_ratio_24h`：数据源失败率
  - `aicmo_llm_tokens_24h`、`aicmo_estimated_cost_yuan_24h`：LLM 用量与估算成本
- **告警日志**：worker 每 5 分钟检查一次，告警以 `level=ERROR` 且消息以 `ALERT` 开头写入日志（任务积压 > 10 分钟、worker 心跳缺失 > 5 分钟、数据源 6 小时失败率 > 50%）。日志采集系统按此规则告警
- **错误追踪**：配置 `SENTRY_DSN` 并在镜像中安装 `sentry-sdk` 后启用（不发送个人信息）
- **日志**：JSON 格式，带 `request_id`；令牌、密码、邮箱、手机号自动脱敏

## 8. 常见故障

| 现象 | 排查 |
|---|---|
| 页面打不开 | `docker compose -p aicmo-v2 ps`；`curl localhost/health`；`docker compose -p aicmo-v2 logs --tail=200 caddy web api` |
| api 不 healthy | 多为迁移失败或数据库连不上：`docker compose -p aicmo-v2 logs api`，修复后 `up -d api` |
| 商机不更新 | `/metrics` 中 `aicmo_worker_heartbeat_age_seconds`；`logs worker`；运营工作台「数据源监控」看成功率 / 封禁；检查套餐是否到期（运营工作台客户详情） |
| 助手 / 生成无响应 | `LLM_API_KEY` 是否有效；`/metrics` 中 LLM 成本是否异常；api 日志 `llm_failed` |
| 发信失败 | 发信邮箱页显示的错误码：`mail_auth_failed`（授权码错误）、`mail_blocked_host`（服务器地址 / 端口不合法）、`mail_connect_failed`（网络）；检查 SPF / DMARC 提示 |
| 通知没收到邮件 | 是否配置 `SYSTEM_SMTP_*`（未配置时邮件渠道跳过）；用户是否在「通知设置」关闭；`notification_deliveries` 表中的 `error` |
| 客户自定义域名没有证书 | 域名是否已在应用中验证并发布；`curl "http://api:8000/api/v1/public/internal/tls-ask?domain=…"`（容器内）是否 200；`logs caddy` |
| 磁盘增长快 | 浏览器缓存卷 `browser_profile`、官网历史版本 `sites`；worker 每日清理过期会话 / 任务 / 请求记录（保留期限见 `backend/app/modules/admin/retention.py`） |

## 9. 合规操作

- **客户导出数据**：客户在「我的 → 数据与隐私」自助导出；运营可代客操作（会记录审计日志「运营代操作」）
- **客户注销**：所有者在「数据与隐私」中输入企业名确认；业务数据级联删除，审计日志保留
- **联系人删除请求**：公开页面 `/data-request` 提交，运营在「运营工作台 → 联系人删除请求」核实后执行；会从所有企业的买家联系方式、未发送的开发信中移除，并加入各企业屏蔽名单
- **审计日志**：运营工作台「审计日志」，包含权限变更、数据导出、代客操作、发布官网、发送邮件、套餐开通、支付、删除等

## 10. 当前生产部署

> **2026-10-28 19:04 已回滚到旧版。** 新版界面要重做成网页形态（不再用手机 App 外壳）。目前线上的 `www.aicmo.site` 是旧版：
> 宿主 Nginx 指向 9010 / 9011，旧容器由 `/home/ai-cmo-legacy/docker-compose.yml` 管理（`docker compose up -d --no-deps frontend backend`）。
> 新版容器 `aicmo-v2-*` 仍在运行，只监听 127.0.0.1，公网访问不到。新版 Nginx 配置保存在 `/var/backups/aicmo-legacy/nginx-ai-cmo.conf.v2`，
> 重新切到新版时：`cp /var/backups/aicmo-legacy/nginx-ai-cmo.conf.v2 /www/server/panel/vhost/nginx/ai-cmo.conf && nginx -t && nginx -s reload`，
> 再停掉旧前后端容器。下面是切换到新版时的记录。
>
> **临时预览入口（2026-11-02）**：`http://43.160.243.154/`（直接用服务器 IP，HTTP）反代到新版 web 容器，供确认新版界面。
> 配置在 `ai-cmo.conf` 末尾「新版预览（临时）」一段；正式切换后删除该段。改动前的配置备份为 `/var/backups/aicmo-legacy/nginx-ai-cmo.conf.before-preview`。

本服务器的 80 / 443 由宝塔面板管理的宿主 Nginx 占用（同机还托管 vidsnap、wordscene 等站点），因此**没有启用** `docker-compose.prod.yml` 中的 Caddy，而是由宿主 Nginx 反代到新版容器：

| 项 | 值 |
|---|---|
| 应用 | `https://www.aicmo.site` → `127.0.0.1:9020`（aicmo-v2 web）；`aicmo.site` 与 HTTP 均 308 跳转到 `https://www.aicmo.site` |
| 客户官网 | `*.sites.aicmo.site`（HTTP）→ `127.0.0.1:9021`（aicmo-v2 sites）。**DNSPod 尚未添加 `*.sites` 泛解析**，客户官网暂不能公网访问（见下方待办） |
| 宿主 Nginx 配置 | `/www/server/panel/vhost/nginx/ai-cmo.conf`（旧版备份：`/var/backups/aicmo-legacy/nginx-ai-cmo.conf.bak`）；修改后 `nginx -t && nginx -s reload` |
| 证书 | `/etc/letsencrypt/live/aicmo.site`（certbot standalone 自动续期，覆盖 aicmo.site / www.aicmo.site） |
| 环境文件 | `deploy/.env.v2`（权限 600，不入库）；启动：`docker compose -f deploy/docker-compose.yml --env-file deploy/.env.v2 -p aicmo-v2 up -d --build` |
| 模型 | OpenAI 兼容接口（`LLM_API_BASE` / `LLM_MODEL` 来自旧版 `.env` 的 QWEN_* 配置） |
| 商机数据源 | 欧盟 TED 官方检索 API（免密钥）；未配置搜索 API |
| 运营账号 | `lixin.time@gmail.com`（staff），初始密码见服务器 `/root/aicmo-staff-account.txt`（权限 600），首次登录后修改 |
| 备份 | cron 每日 03:00 `deploy/backup.sh` → `/var/backups/aicmo-v2`；每周日 04:00 恢复演练；密钥 `/root/.aicmo-backup.key`（**请另行离线保存**） |
| 旧版 | 前后端容器 `ai-cmo-frontend-1`、`ai-cmo-backend-1` 已停止且不自动重启；旧数据库 `ai-cmo-db-1`（5434）保留运行；切换前的全量导出：`/var/backups/aicmo-legacy/legacy-db-*.sql.gz` |

**回滚到旧版**（紧急情况）：

```bash
cp /var/backups/aicmo-legacy/nginx-ai-cmo.conf.bak /www/server/panel/vhost/nginx/ai-cmo.conf
# 旧前端的静态文件在 /home/ai-cmo-legacy，必须用这里的 compose 重建，直接 docker start 会因挂载路径不存在而失败
cd /home/ai-cmo-legacy && docker compose up -d --no-deps frontend backend
nginx -t && nginx -s reload
```

**待办：开通客户官网公网访问**

1. DNSPod 为 `aicmo.site` 添加记录：主机记录 `*.sites`，类型 A，记录值 `43.160.243.154`
2. HTTPS（可选）：用 DNS 验证签发 `*.sites.aicmo.site` 泛域名证书（certbot + DNSPod 插件，需要 DNSPod API 密钥），然后把 `ai-cmo.conf` 中客户官网的 server 改为 443 并把 `.env.v2` 的 `SITES_SCHEME` 改为 `https`
3. 客户自定义域名：为每个已验证的域名签发证书后，在 `ai-cmo.conf` 中加入对应的 `server_name`
