# 品牌官网（计划 04）

## 流程

```
POST /site/generate（档案完整度 ≥ 60%）→ job site.generate
  → 档案直出：公司名、联系方式、证书、市场、工厂数据、产品列表
  → LLM 撰写：横幅、关于我们、产品简介、工厂介绍、FAQ、案例、SEO（不可信数据包在 <data> 中）
  → Pydantic 校验与截断 → 事实校验（数字 / 证书 / 客户名不在档案中 → flags「需确认」）
  → site_versions 新版本（草稿）
PUT /site/sections/{section} 或 POST .../rewrite（job site.rewrite）→ 新版本草稿
POST /site/publish（owner / operator，前端 Dialog 确认；助手工具 site_publish 需要确认卡片）→ job site.publish
  → Jinja2 渲染（autoescape + StrictUndefined）→ 图片转多尺寸 WebP → 写入 versions/{site}/{version}/
  → live/{host} 软链接原子切换 → 健康检查
```

## 安全

| 风险 | 处理 |
|---|---|
| XSS | 模板自动转义；富文本（关于我们、FAQ 回答）经 nh3 白名单（p / ul / ol / li / strong / em / br / a[http/https]）；JSON-LD 转义 `< > &`；官网 CSP `script-src 'none'` |
| 编造事实 | 证书、联系方式、市场只来自档案；LLM 不能新增产品；生成文本中的数字 / 证书 / 客户名不在档案中则标记「需确认」，发布前 Dialog 提醒 |
| 预览 | 签名链接（绑定站点与版本，30 分钟）；响应 `CSP: sandbox`；iframe `sandbox=""` |
| 询盘 | 公开接口：单 IP 每站 10 分钟 5 条、每天 20 条；蜜罐字段 `website`（命中时假装成功）；可选 Turnstile（服务端经 safe_fetch 校验）；字段长度与邮箱校验；IP 只存 HMAC 哈希；垃圾评分 ≥ 60 不通知 |
| 路径穿越 | 构建只写入版本目录内；域名经严格正则校验后才作为软链接名；托管 Nginx 只接受合法 Host |

## 托管（deploy）

- `sites` 容器（`deploy/nginx/sites.conf`）按 `Host` 读取 `/data/sites/live/$host`，与 api / worker 共享 `sites` 数据卷
- 询盘表单提交到同源路径 `/__inquiry/{site_id}`，由 sites 容器代理到 api（官网无需 JavaScript）
- 平台子域名：`{slug}-{随机}.{SITES_BASE_DOMAIN}`；需要泛域名 DNS 与泛域名证书（计划 07 定稿签发方案）
- 自定义域名：`PUT /site/domain` → 用户添加 CNAME 与 TXT（`_aicmo-verify.{domain}` = token）→ `POST /site/domain/verify`
- 部署自检：`bash scripts/smoke-sites.sh`

## 健康检查

规则（`app/modules/sites/health.py`）：标题 / 描述长度、关键词、首页 H1 唯一、图片 alt、HTTPS、联系方式、证书、
工厂图片、产品与产品图片、公司介绍。每条问题给出中文修复建议与跳转目标。发布后自动检查一次；
每周定时检查在计划 05 的调度器中接入。PageSpeed API 已预留配置项 `PAGESPEED_API_KEY`（未接入）。
