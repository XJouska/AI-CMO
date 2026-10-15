# 04 · 品牌官网生成与托管

> 目标：基于企业档案，几分钟内生成一个专业的英文 B2B 官网，可编辑、可发布、可绑定自有域名；官网上的询盘自动回流为商机。这是案例中「采购方看到网站觉得专业」的那一环。
> 结束状态：一家真实工厂的官网可以在公网访问，并能收到询盘。

---

## 1. 范围

**包含**：官网模板、AI 内容生成、静态站点构建、托管与域名、HTTPS、SEO 基础、询盘表单、官网健康检查、「官网」Tab、对应助手工具。
**不包含**：可视化拖拽编辑器、电商功能、多语言（首版只做英文，预留多语言结构）。

---

## 2. 设计原则

- **客户官网与本应用是两套设计**：官网面向海外采购商，桌面优先、响应式，使用 `site-templates/` 中的 B2B 模板；本应用的编辑界面使用 yb-ui。
- **可信度优先**：工厂实拍、产能数据、资质证书、出口国家、合作案例、联系方式必须显眼；AI 不得编造证书、客户名称或数据——缺失时留空并提示用户补充。
- **模板化交付**：首版提供 3 套行业模板（工业设备、建材五金、消费制造），分区固定，内容可编辑，降低交付成本。

---

## 3. 数据模型

| 表 | 关键字段 |
|---|---|
| `sites` | id, company_id, template_key, status(`draft` / `published` / `suspended`), subdomain, custom_domain, domain_verified, published_version_id |
| `site_versions` | id, site_id, content(JSON), created_by, created_at, note |
| `site_sections` | 存在于 `content` 中：hero、about、products、factory、certificates、markets、cases、faq、contact |
| `site_inquiries` | id, site_id, company_id, name, email, company_name, country, message, product_ref, ip_hash, user_agent, spam_score, lead_id, created_at |
| `site_health_reports` | id, site_id, score, issues(JSON), created_at |

---

## 4. 后端任务

### 4.1 内容生成

1. 输入：企业档案 + 产品 + 资料图片。
2. LLM 生成每个分区的英文文案（结构化 JSON，符合分区 schema）；产品页根据产品数据生成。
3. 生成 SEO 元信息：标题、描述、关键词、结构化数据（`Organization`、`Product` 的 JSON-LD）。
4. 事实约束：生成内容中的数字、证书、客户名只能来自档案字段；生成后做一次校验，发现档案中不存在的事实则标记为「需确认」。
5. 每次生成保存为新的 `site_version`，支持回滚。

### 4.2 静态站点构建

1. Jinja2 渲染，**开启自动转义**；用户输入的富文本只允许白名单标签（`p`、`ul`、`li`、`strong`、`em`、`a[href=http(s)]`），使用 `bleach` 或 `nh3` 清洗。
2. 输出到 `sites-output/{site_id}/{version_id}/`，发布时原子切换软链接或 Nginx 映射。
3. 图片自动生成多尺寸 WebP。
4. 生成 `sitemap.xml`、`robots.txt`。
5. 构建在 worker 中执行，不调用 shell 命令。

### 4.3 托管与域名

1. 默认子域名：`{slug}.{平台域名}`（需在部署时配置泛域名证书）。
2. 自定义域名：用户添加 CNAME 后，后端通过 DNS 查询校验归属（TXT 记录验证），校验通过后签发证书（Caddy 或 certbot 的自动签发方案，计划 07 定稿）。
3. `sites` 容器只托管静态文件，与应用 API 隔离。

### 4.4 询盘表单

1. 官网中的询盘表单提交到 `POST /public/sites/{site_id}/inquiries`。
2. 防护：按 IP 限流、蜜罐字段、可选人机校验（Cloudflare Turnstile 或同类服务）、字段长度限制、邮箱格式校验。
3. 存储时 IP 只保存哈希。
4. 新询盘自动创建一条 `source=site_inquiry` 的商机（计划 05 的 `leads` 表；本计划先建询盘表，计划 05 补关联）。
5. 新询盘通知企业成员（站内通知，计划 07 增加微信 / 邮件通知）。

### 4.5 官网健康检查

复用旧 `seo_service.py` 的规则思路，检查：标题、描述、H1、图片 alt、HTTPS、页面性能（PageSpeed API）、联系方式是否可见、证书与工厂图片是否缺失。输出评分和修复建议，每周自动执行一次。

### 4.6 助手工具

| 工具 | 是否需要确认 |
|---|---|
| `site.generate_draft` | 否 |
| `site.update_section(section, instruction)` | 否（生成新版本草稿） |
| `site.publish` | **是** |
| `site.health_check` | 否 |
| `site.list_inquiries` | 否 |

---

## 5. 前端任务（「官网」Tab）

### 5.1 页面结构

| 状态 | 界面 |
|---|---|
| 未生成 | `EmptyPage` + 「生成我的英文官网」按钮（档案完整度不足 60% 时先引导补档案） |
| 生成中 | `Markdown variant="Progress"` 展示分区生成进度 |
| 已有草稿 / 已发布 | 见下方 |

已有官网时：

```
NavBar（标题「官网」，右侧「预览」）
├── 状态卡片：发布状态 Tag、访问地址、健康评分、本周访问 / 询盘数
├── ListSectionTitle「页面内容」
│     └── List：首页横幅 / 关于我们 / 产品 / 工厂 / 资质 / 市场 / 案例 / 常见问题 / 联系
├── ListSectionTitle「询盘」
│     └── 最近 3 条询盘 + 查看全部
├── ListSectionTitle「设置」
│     └── 模板、域名、SEO 信息、版本历史
└── 底部固定按钮：「发布更新」（无改动时置灰）
```

### 5.2 分区编辑

- 每个分区进入独立编辑页：`FormFields` 编辑文案，图片使用资料库选择器（`BottomSheet`）
- 提供「让 AI 改写」入口：输入一句修改要求，生成新版本草稿
- 「需确认」的内容使用 `Tag` 标记，未处理前发布时 `Dialog` 提醒

### 5.3 预览

- 预览页使用 iframe 加载草稿版本（独立预览域名，带短期签名 token），可切换桌面 / 手机宽度
- iframe 设置 `sandbox` 属性，限制脚本和顶层跳转

### 5.4 发布与域名

- 发布：`Dialog` 确认 → `Loading` → 成功 `Toast` 并显示访问地址
- 绑定域名：分步引导（填写域名 → 显示 DNS 记录 → 检测状态），检测中显示 `Loading`

### 5.5 询盘列表

- `List` 展示：国家、公司、产品、时间、是否已转为商机
- 点击进入商机详情（计划 05 页面）

---

## 6. 验收标准

- [ ] 用真实工厂档案生成官网，内容无编造的证书和客户；需确认项被正确标记
- [ ] 发布后公网可访问，HTTPS 正常，移动端和桌面端显示正常
- [ ] 在官网提交询盘 → 应用内 1 分钟内看到通知和询盘记录
- [ ] 询盘接口限流、蜜罐生效；注入 `<script>` 的询盘内容在应用和官网中都按文本显示
- [ ] 版本回滚可用
- [ ] 健康检查给出可执行的修复建议
- [ ] 「官网」Tab 各状态完成截图检查
