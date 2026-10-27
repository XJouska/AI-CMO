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

## 计划 04 · 品牌官网生成与托管

| 验收项 | 状态 | 证据 |
|---|---|---|
| 生成内容无编造的证书和客户；需确认项被正确标记 | 通过（假数据） | `test_fabricated_facts_are_flagged`、`test_fact_check_unit`、`test_llm_output_is_validated_and_clamped` |
| 发布后可访问，移动端和桌面端显示正常 | 通过（本机） | `test_publish_writes_static_site_and_switches_atomically`；`scripts/smoke-sites.sh`（aicmo-v2 sites 容器） |
| 官网提交询盘 → 应用内看到通知和询盘记录 | 通过 | `e2e/site.e2e.ts`；`test_inquiry_flow_creates_record_and_notification`；smoke 脚本经 Nginx 提交 |
| 询盘接口限流、蜜罐生效；`<script>` 询盘内容在应用和官网中都按文本显示 | 通过 | `test_inquiry_rate_limit`、`test_inquiry_honeypot_pretends_success`、`site.spec.tsx`、`site.e2e.ts` |
| 版本回滚可用 | 通过 | `test_section_edit_creates_new_version_and_restore`、`site.e2e.ts`「版本回滚」 |
| 健康检查给出可执行的修复建议 | 通过 | `test_health_rules`、`test_health_check_endpoint` |
| 「官网」Tab 各状态完成截图检查 | 通过 | `e2e/__screenshots__/site.e2e.ts/*` |

**人工确认项**

- [ ] 用一家真实工厂档案（配置真实 LLM）生成官网，人工审阅英文文案质量与事实准确性
- [ ] 公网发布：泛域名 DNS（`*.SITES_BASE_DOMAIN`）、泛域名证书、宿主 Nginx 把官网域名流量转发到 `127.0.0.1:9021`（计划 07）
- [ ] 自定义域名的证书自动签发方案（Caddy on-demand TLS 或 certbot，计划 07 定稿）
- [ ] 是否启用 Cloudflare Turnstile（需要申请 sitekey / secret）

## 计划 05 · 商机情报

| 验收项 | 状态 | 证据 |
|---|---|---|
| 每条商机有可访问的来源链接、中文摘要、匹配理由 | 通过（假数据） | `test_run_creates_scored_pending_leads`；`leads.spec.tsx`「商机详情」；`e2e/leads.e2e.ts` 详情截图 |
| 同一采购需求在多个来源出现时合并为一条商机 | 通过 | `test_same_requirement`、`test_signals_deduplicated_across_runs_and_sources`、`test_buyer_dedupe_and_enrichment` |
| 官网询盘自动成为 `site_inquiry` 类型商机 | 通过 | `test_site_inquiry_becomes_approved_lead` |
| 运营复核队列可用，被驳回的商机用户不可见 | 通过 | `test_review_queue_controls_visibility`；`e2e/leads.e2e.ts`（复核前「正在为你寻找商机」，通过 1 条、驳回其余后列表只有 1 条） |
| SSRF：监控结果、买家网址、浏览器子请求指向内网时被拒绝 | 通过 | `test_run_creates_scored_pending_leads`（`blocked` 计数）、`test_buyer_enrichment_refuses_internal_domains`、`test_robots_txt`、`test_search_api_connectors_use_safe_fetch`、`test_browser_guard_route_blocks_internal_subrequests`（`app/services/browser_guard.py` 纳入 100% 覆盖率门槛） |
| 单企业单次运行的成本上限生效 | 通过 | `test_plan_queries_and_budget`、`test_cost_budget_limits_run` |
| 多个 worker / 调度器同时运行不重复领取 | 通过 | `test_extraction.py` SKIP LOCKED 并发用例、`test_scheduler_enqueues_due_watches_once`、`test_enable_then_manual_run_does_not_double_schedule` |
| 外部内容中的提示词注入不会触发工具 | 通过 | `test_prompt_injection_in_signal_is_wrapped`；商机工具全部只读（`test_lead_tools`、`test_lead_tools_scoped_to_company`） |
| 评测集指标不得下降 | 通过（合成样本） | `evals/leads.py --check evals/baseline.json`（检查脚本每次执行）：意图准确率 1.0、Top20 有效率 1.0、重复率 0、虚假率 0 |
| 「商机」Tab 各状态截图检查 | 通过 | `e2e/__screenshots__/leads.e2e.ts/*`（未开启监控、等待首批、列表、详情；402×874 与 1280×800） |
| 全部新路由登记越权矩阵 | 通过 | `tests/tenancy_matrix.py`、`test_route_guard.py` |

**说明**

- 商机卡片左侧图标按类型取自正式图标库；分类 Tab 在 402 宽度下使用二字标签（全部 / 招标 / 求购 / 买家 / 询盘），避免折行。
- 启用监控后立即手动运行，会顺延下一次定时运行，调度器不会马上再跑一次。

**人工确认项**

- [ ] 为一家试点工厂创建监控，24 小时内产出 ≥ 20 条经复核的商机（需要真实搜索 API Key：`SEARCH_API_PROVIDER` / `SEARCH_API_KEY`，以及真实 LLM）
- [ ] 评测集换成真实标注样本（目前为 10 条合成样本），确认指标目标值
- [ ] 逐个确认数据源的使用条款并记录到 `source_configs`（TED RSS 默认启用；其余需要 API Key 的数据源默认关闭）
