# 账号、企业与企业档案（计划 02）

## 权限模型

| 层级 | 依赖 | 失败返回 |
|---|---|---|
| 登录 | `current_user`：`Authorization: Bearer <token>`，会话未撤销、未过期（7 天），账号启用 | 401 `unauthorized` |
| 企业 | `current_company`：请求头 `X-Company-Id`，必须是该企业成员且企业为 active | 400 `company_required` / 403 |
| 角色 | `require_role(...)`；管理企业设置、邀请：`owner` / `operator`；移除成员：`owner` | 403 |
| 平台运营 | `require_staff`（`users.is_staff`） | 403 |
| 资源归属 | 资源 ID 不属于当前企业时返回 404（不暴露是否存在） | 404 |

所有路由都必须在 `backend/tests/tenancy_matrix.py` 登记访问级别；`tests/test_route_guard.py` 会自动验证
未登录、非成员、跨企业访问三类越权，并在新增路由未登记时失败。

## 会话与限流

- token：32 字节随机串，数据库只存 SHA-256；登出撤销当前会话，「登出所有设备」撤销全部。
- 登录：单 IP 15 分钟内最多 20 次（`LOGIN_IP_LIMIT`）；单账号连续失败 5 次锁定 15 分钟；账号不存在与密码错误返回相同错误。
- 注册：单 IP 每小时 10 次（`REGISTER_IP_LIMIT_PER_HOUR`）。
- 手机号验证码登录：接口 `POST /auth/sms/send` 已预留，返回 503 `sms_not_configured`（计划 07 接入）。

## 上传

- 按文件头判断真实类型，只接受 JPG / PNG / WebP / PDF，单文件 20MB（`MAX_UPLOAD_BYTES`）。
- 图片用 Pillow 重新编码（去除 EXIF、验证可解码、限制像素防解压炸弹）；PDF 只提取文本（最多 60 页）。
- 存储 key 为 `{company_id}/{随机 32 位 hex}`，文件名只用于界面显示。
- 下载使用 `GET /api/v1/assets/{id}/download-url` 获取 10 分钟有效、HMAC 签名（绑定资料 ID 与企业 ID）的链接；
  响应带 `X-Content-Type-Options: nosniff` 和 `Content-Security-Policy: sandbox`。

## AI 建档

```
POST /extractions {source: url|file|chat}
  → profile_extractions(pending) + jobs(profile.extract)
worker: 抓取（safe_fetch，同域最多 10 页）/ 读取 PDF 文本 / 口述文本
  → LLM（不可信内容包在 <data> 中）→ Pydantic 校验与截断
  → result.changes（待确认的变更，不直接写入档案）
POST /extractions/{id}/apply {accept: [...], overrides: {...}}
  → 合并到档案并记录字段来源 field_sources[field] = {source, extraction_id, at}
```

- 失败：网址被 SSRF 拒绝 / 内容为空 → 直接失败并给出原因；LLM 失败 → 按任务表指数退避重试 3 次后失败。
- 单企业同时进行的整理任务最多 3 个。

## 完整度

按官网生成和商机匹配所需字段加权，总分 100（`app/modules/companies/profile.py` 的 `COMPLETENESS_ITEMS`）。
`GET /profile` 返回 `missing`（含 `section`，前端据此跳转到对应编辑页）。

## 任务表

`app/core/jobs.py`：`enqueue` → worker `claim_next`（`FOR UPDATE SKIP LOCKED`）→ `run_job`。
`RetryableJobError` 按 10s / 20s / 40s… 退避重试；超过 10 分钟仍为 running 的任务视为 worker 崩溃并回收。
