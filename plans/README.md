# 重构计划目录

把 AI-CMO 从「社媒舆情监测」彻底重构为「外贸工厂 AI 获客平台」，UI 与交互全部基于 yb-mobile-design 设计系统。

按顺序执行，每个计划满足验收标准后再进入下一个。

| 顺序 | 文件 | 内容 | 里程碑 |
|---|---|---|---|
| 0 | [00-overview.md](00-overview.md) | 产品定义、设计系统规则、架构、删除清单、安全基线 | — |
| 1 | [01-foundation.md](01-foundation.md) | 仓库清理、yb-ui 接入、应用壳、后端骨架、SSRF 防护 | M1 |
| 2 | [02-auth-company-profile.md](02-auth-company-profile.md) | 账号、多租户、企业档案 AI 建档、「我的」Tab | M1 |
| 3 | [03-assistant.md](03-assistant.md) | AI 获客助手：对话、流式输出、工具调用、卡片 | M1 |
| 4 | [04-site-builder.md](04-site-builder.md) | 英文 B2B 官网生成、发布、域名、询盘回流、「官网」Tab | M2 |
| 5 | [05-lead-intelligence.md](05-lead-intelligence.md) | 数据源、定时监控、评分去重、人工复核、「商机」Tab | M3 |
| 6 | [06-outreach-pipeline.md](06-outreach-pipeline.md) | 开发信、跟进状态、提醒、周报、结果回流 | M3 |
| 7 | [07-ops-billing-launch.md](07-ops-billing-launch.md) | 运营工作台、计费、通知、合规、安全审查、生产部署 | M4 |

里程碑：

- **M1**：可登录、建档、和助手对话
- **M2**：可为真实工厂发布英文官网
- **M3**：可每天交付经复核的商机并记录跟进
- **M4**：可收费、可运维，支撑两家付费试点
