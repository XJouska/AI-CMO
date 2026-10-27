# 验收记录

每个计划结束时更新。「自动」表示由 `node scripts/check-all.mjs` 中的测试覆盖；「人工」表示需要真实世界条件，
已实现功能并用假数据验证，**等待项目负责人确认**后才算完成。

## 计划 01 · 仓库清理与新骨架

| 验收项 | 状态 | 证据 |
|---|---|---|
| 旧代码已删除，`legacy-sentiment-v1` 标签存在 | 通过 | `git tag`；旧 `backend/`、`frontend/`、`skill*/` 已删除 |
| `docker compose up` 后 `/health` 正常，前端可访问 | 通过 | `aicmo-v2` 项目，`127.0.0.1:9020`；`e2e/smoke/deployed.smoke.ts` |
| 四个 Tab 可切换，显示「助手 / 商机 / 官网 / 我的」，无「元宝」字样 | 通过 | `src/app/shell.spec.tsx`、`e2e/shell.e2e.ts`、`check-web` 源码扫描 |
| 桌面画布居中，手机铺满 | 通过 | `e2e/shell.e2e.ts`（402×874 与 1280×800 两个项目）+ 截图基线 |
| `useToast()` 显示正式 Toast，3 秒后消失 | 通过 | `shell.spec.tsx`（假定时器）、`shell.e2e.ts` |
| SSRF 单元测试全部通过 | 通过 | `backend/tests/test_ssrf.py`，`app/core/security` 覆盖率 100% |
| `.env` 未入库，仓库内无明文密钥 | 通过 | `git ls-files .env` 为空；部署密钥在 `deploy/.env.v2`（被 `.gitignore` 排除，权限 600） |
| `VENDOR.md`、`ui-gaps.md`、`licensing.md` 已创建 | 通过 | `packages/yb-ui/VENDOR.md`、`docs/` |
| api 容器非 root；Playwright 只在 worker 镜像 | 通过 | `docker compose exec api id` → uid 10001；`deploy/api/Dockerfile` 不安装 playwright |
| 数据库端口不对外暴露 | 通过 | compose 中 db / api 无 `ports`；只有 web 绑定 `127.0.0.1:9020` |

**人工确认项**

- [ ] 设计系统（yb-mobile-design）与字体的商业使用授权（见 `docs/licensing.md`）
- [ ] 正式域名切换：目前 `aicmo.site` 仍指向旧版容器（9010/9011），新版只在 `127.0.0.1:9020` 运行
