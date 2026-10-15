# 01 · 仓库清理与新骨架

> 目标：删除旧舆情产品，建立新的前后端骨架，并把 yb-mobile-design 设计系统接入为可用的组件包。
> 结束状态：打开应用能看到四个 Tab 的空壳页面，全部使用正式组件；后端有健康检查和数据库迁移；Docker Compose 能一键启动。

---

## 1. 范围

**包含**：仓库清理、目录重建、设计系统接入、前端应用壳、后端骨架、SSRF 防护基础件、部署骨架、CI 检查。
**不包含**：任何业务功能（账号、助手、官网、商机）。

---

## 2. 任务

### 2.1 仓库保护与清理

1. 提交当前工作区快照：`chore: snapshot before rebuild`。
2. 打标签 `legacy-sentiment-v1`。
3. 按 [00-overview 第 4.1 节](00-overview.md) 删除旧目录和文件。
4. 迁移保留文件：
   - `backend/app/services/browser_service.py` → `backend/app/services/browser.py`（暂不改逻辑，计划 05 中加固）
   - `backend/app/services/llm.py` → `backend/app/services/llm.py`
5. 更新 `.gitignore`：新增 `*.zip`、`packages/yb-ui/assets/fonts/*.otf`、`apps/web/dist/`、`sites-output/`。
6. 新增 `.env.example`，列出所有环境变量但不含真实值；确认 `.env` 不在 git 中。

### 2.2 设计系统接入：`packages/yb-ui`

1. 编写 `scripts/vendor-yb-ui.mjs`：从 zip 解压后复制以下内容到 `packages/yb-ui/`：
   - `demo/src/{generated,library,tokens.css,fonts.css,index.css}`
   - `demo/src/screens/{DemoShell.tsx,screens.css}`（仅作为设备壳参考，正式应用不依赖 DemoShell）
   - `demo/public/{icons,figma-assets,images,loading}` → `packages/yb-ui/public/`
   - `assets/fonts/manifest.json`（字体文件本身按 2.3 处理）
   - 不复制：`figma/*.figma.ts`、Code Connect、`scripts/`、`references/`、`evals/`、示例 screens
2. 在 `packages/yb-ui/VENDOR.md` 记录：来源 zip 文件名、快照日期、`figma-snapshot-manifest.json` 中的指纹、复制清单。以后设计包更新时重跑脚本并对比差异。
3. **本地扩展（最小改动，集中登记）**：在 `packages/yb-ui/extensions/` 下实现，不直接改 vendored 文件：
   - `BrandTabBar`：复用 `TabBar` 的 CSS 类和 `AgentInput`，增加 `items: {id, label, icon}[]` 属性，用于「助手 / 商机 / 官网 / 我的」
   - `BrandNavBar`：替换 NavBar 中写死的品牌名称和元宝图标
   - 所有扩展登记到 `docs/ui-gaps.md`，说明原因：正式组件没有对应公开属性
4. 品牌替换：新增本产品 Logo（SVG），在应用中禁止引用 `yuanbao-brand.svg`；加一条 CI 检查：`apps/web/src` 中出现 `元宝` / `yuanbao` 字样则失败。
5. 字体处理：
   - 开发环境：`fonts.css` 指向本地 `assets/fonts/`（文件不入库，由 vendor 脚本放置）
   - 生产环境：构建时使用 `fonts.prod.css`，只声明 `font-family` 回退链 `"PingFang SC", -apple-system, "Microsoft YaHei", system-ui, sans-serif`，不打包字体文件
   - 在 `docs/licensing.md` 中记录：设计系统和字体的商业使用授权需项目负责人确认

### 2.3 前端应用：`apps/web`

1. Vite + React 19 + TypeScript 初始化；`vite.config.ts` 配置别名：
   - `@yb` → `packages/yb-ui/src`
   - `@` → `apps/web/src`
   - `publicDir` 指向 `packages/yb-ui/public`，应用自有资源放在 `apps/web/public-extra` 并在构建时合并
2. 依赖：`react-router-dom`、`@tanstack/react-query`；不引入 UI 库、Tailwind、图标库（图标统一用 `@yb/library/Icon`）。
3. 入口包裹：`RenderPolicyProvider policy="deliverable-strict"`，缺渲染器的组件直接失败而不是静默降级。
4. 应用壳 `AppShell`：
   - 移动端（宽度 ≤ 480px）：铺满视口
   - 桌面端：402×874 设备画布居中显示，外部背景使用 `--yb-color-basic-bg-secondary`
   - 内部使用 `HostCanvas canvasRole="primary"`，保证 `ModalLayer` / `FeedbackLayer` 正常挂载
   - 处理安全区（`env(safe-area-inset-*)`）
5. 路由骨架：

   | 路由 | 页面 | 本计划内容 |
   |---|---|---|
   | `/login` | 登录 | 空壳 |
   | `/assistant` | 助手（Tab 1） | `NavBar barType="Agent"` + 欢迎语占位 |
   | `/leads` | 商机（Tab 2） | `EmptyPage type="noContent"` |
   | `/site` | 官网（Tab 3） | `EmptyPage type="placeholder"` |
   | `/me` | 我的（Tab 4） | `SettingsItems` 列表占位 |

6. 公共层：
   - `src/api/client.ts`：基于 `fetch` 的请求封装，统一处理 401、错误码到 `Toast` 文案的映射
   - `src/api/sse.ts`：基于 `fetch + ReadableStream` 的 SSE 解析器（需要携带 Authorization 头）
   - `src/feedback/`：全局 `useToast()`，内部使用 `FeedbackLayer kind="toast"` + 正式 `Toast`，同一时间只显示一条
   - `src/i18n/`：首版只做中文界面，但所有文案集中在 `zh.ts`，为后续英文版预留
7. 主题：读取系统偏好，`data-theme` 写在 `HostCanvas` 上；首发验收 Light。

### 2.4 后端骨架：`backend`

1. 目录按 [00-overview 第 3.2 节](00-overview.md) 创建，`modules/*` 先放空的 `router.py`。
2. `core/config.py`：Pydantic Settings，所有密钥从环境变量读取，缺失必填项时启动失败。
3. `core/db.py`：SQLAlchemy 2 同步引擎（首版），会话依赖注入；初始化 Alembic，第一个迁移只建 `schema_version` 外的基础表（无业务表）。
4. `core/security/ssrf.py`（**本计划必须完成并测试**）：
   - `validate_url(url) -> ParsedUrl`：只允许 http / https，只允许端口 80 / 443，拒绝 IP 字面量中的私有地址
   - DNS 解析所有 A / AAAA 记录，任一命中以下范围即拒绝：回环、私有（`10/8`、`172.16/12`、`192.168/16`）、链路本地（`169.254/16`，含云厂商元数据地址）、CGNAT（`100.64/10`）、组播、保留地址、IPv6 ULA / 链路本地，以及额外的 `9.0.0.0/8`、`11.0.0.0/8`、`21.0.0.0/8`、`30.0.0.0/8`
   - `safe_fetch()`：基于 httpx，禁用自动跳转，手动跟随最多 5 次，每一跳重新校验；连接时固定使用已校验的 IP，防止 DNS 重绑定
   - 单元测试覆盖上述全部范围、十进制 / 八进制 / IPv6 映射写法、跳转到内网
5. `core/logging.py`：结构化日志（JSON），请求 ID 中间件；日志中脱敏 token、邮箱、手机号。
6. 通用错误响应格式：`{ "error": { "code": "...", "message": "..." } }`。
7. `GET /health`、`GET /api/v1/meta`（版本号）。
8. 测试基础：`pytest` + 测试数据库（Docker 或 `testcontainers`），工厂函数目录 `tests/factories/`。

### 2.5 部署骨架：`deploy/`

1. `docker-compose.yml`：`db`、`api`、`worker`（本计划只启动空循环）、`web`（Nginx 托管 `apps/web/dist`）。
2. 数据库账号密码全部来自 `.env`，不再写死在 compose 文件中；数据库端口默认不对外暴露。
3. `deploy/nginx/web.conf`：SPA 回退、`/api/` 反向代理、SSE 关闭缓冲、安全响应头（`Content-Security-Policy`、`X-Content-Type-Options`、`Referrer-Policy`、`X-Frame-Options`）。
4. `api` 容器使用非 root 用户运行；Playwright 依赖放在 `worker` 镜像（`api` 镜像不装浏览器）。

### 2.6 CI 检查（本地脚本 + 可选 GitHub Actions）

- 前端：`typecheck`、`build`、品牌字样检查、禁止 `dangerouslySetInnerHTML` 检查
- 后端：`ruff`、`pytest`、`alembic upgrade head` 在空库上执行
- 依赖安全：`pip-audit`、`npm audit --omit=dev`（只报告）

---

## 3. 验收标准

- [ ] 旧代码已删除，`legacy-sentiment-v1` 标签存在
- [ ] `docker compose up` 后 `/health` 返回正常，前端可访问
- [ ] 四个 Tab 可切换，底部 TabBar 显示「助手 / 商机 / 官网 / 我的」，全应用无「元宝」字样
- [ ] 桌面浏览器中设备画布居中，手机浏览器中铺满
- [ ] 触发一次 `useToast()` 能看到正式 Toast，3 秒后消失
- [ ] SSRF 单元测试全部通过
- [ ] `.env` 未入库，仓库内无明文密钥
- [ ] `packages/yb-ui/VENDOR.md`、`docs/ui-gaps.md`、`docs/licensing.md` 已创建

## 4. 风险

| 风险 | 应对 |
|---|---|
| vendored 组件依赖设计包内部路径或 Node 脚本生成的文件 | vendor 脚本复制后立即 `typecheck`；缺什么补什么并记录在 VENDOR.md |
| `TabBar` 内部结构变化导致扩展失效 | 扩展只复用 CSS 类名，并为它写一个截图回归测试 |
| 设计包体积大（public 约 17MB） | 构建时只打包实际引用的图标；在 vendor 脚本中按使用清单裁剪（计划 07 执行） |
