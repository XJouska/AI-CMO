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

## 计划 02 · 账号、企业与企业档案

| 验收项 | 状态 | 证据 |
|---|---|---|
| 注册 → 创建企业 → 输入工厂网址 → 得到可确认的档案草稿 | 通过（假数据） | `e2e/accounts.e2e.ts`「从网址建档」；`tests/test_extraction.py::test_extract_from_url_end_to_end` |
| 确认后档案完整度正确显示，缺失项可点击跳转补充 | 通过 | `tests/test_profile_products_assets.py` 完整度用例；`me.spec.tsx`「缺失项可点击跳转」 |
| 产品增删改、图片上传正常，非法文件类型被拒绝 | 通过 | `test_product_crud`、`test_upload_rejects_disguised_or_broken_files`（伪造扩展名、SVG、损坏文件） |
| 越权测试全部通过 | 通过 | `tests/test_route_guard.py`：33 个路由全部登记，自动验证未登录 / 非成员 / 跨企业 |
| 登录限流生效 | 通过 | `test_account_locks_after_consecutive_failures`、`test_login_rate_limited_per_ip`（freezegun） |
| 页面覆盖默认、加载、空态、错误状态，并完成 402×874 截图检查 | 通过 | `e2e/__screenshots__/accounts.e2e.ts/*`（402×874 与 1280×800） |

**人工确认项**

- [ ] 用一家真实工厂的网址在配置了真实 LLM 的环境中走通建档，并在 10 分钟内得到档案草稿（需要 `LLM_API_KEY`）
- [ ] 抓取真实网站时的合规确认（robots.txt 与条款，计划 05 统一实现）

## 计划 03 · AI 获客助手

| 验收项 | 状态 | 证据 |
|---|---|---|
| 「我们是做不锈钢阀门的，官网是 xxx.com」→ 抽取工具 → 档案变更卡片 → 确认后档案更新 | 通过（假数据） | `e2e/assistant.e2e.ts` 第一条；`tests/test_assistant.py::test_extract_from_url_tool_*` |
| 生成中可停止；停止后消息状态为 `cancelled`，可重新生成 | 通过 | `test_cancel_marks_message_cancelled_and_stops_stream`；`assistant.spec.tsx`、`assistant.e2e.ts`「生成中可停止」 |
| 断网后保持输出中并出现轻提示；恢复后可重试 | 通过 | `assistant.spec.tsx`「弱网」「网络断开」；`assistant.e2e.ts`「弱网」 |
| 有副作用的工具未经确认不会执行 | 通过 | `test_side_effect_tool_requires_confirmation`、`test_prompt_injection_in_tool_data_cannot_trigger_side_effects` |
| 通过提示词让助手读取其他企业数据失败 | 通过 | `test_llm_cannot_target_other_company`（多余参数被拒、跨企业 ID 不可见）；全部工具参数禁止多余字段 |
| 所有状态在 402×874 下截图检查，输入框与 TabBar 贴底铺满 | 通过 | `e2e/__screenshots__/assistant.e2e.ts/*`（欢迎、生成中、完成、卡片、历史） |
| SSE 协议前后端一致 | 通过 | `contracts/sse-assistant.json` 同时被 `test_assistant.py` 与 `turn.test.ts`、`assistant.spec.tsx` 使用 |

**说明与人工确认项**

- 首版的「流式」是在 LLM 返回完整回答后分段推送（`block.delta`），首字延迟取决于 LLM 响应时间。真正的逐 token 流式需要在函数调用模式下解析流式工具调用，计划 07 性能优化时评估。
- [ ] 配置真实 LLM 后，人工检查工具选择是否准确、回答是否遵守「不编造」规则
