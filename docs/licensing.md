# 授权事项（需项目负责人确认）

以下事项在商业上线前必须取得书面确认。确认前，代码按「未授权」处理。

## 1. 界面设计

- **现状（2026-10-28 起）**：前端界面全部为自有实现。仓库中**不再包含**任何设计包代码、图标、插画、图片或字体（原 `packages/yb-ui` 已删除）。
- 设计变量（`apps/web/src/ui/tokens.css`）只参考了一套移动端设计规范的通用视觉思路（中性灰阶、文字层级、圆角与阴影阶梯），变量名、数值与强调色由本项目自定。
- 组件（`apps/web/src/ui/`）、布局与页面为自有代码；图标使用开源图标库 lucide（ISC 许可）。
- `npm run check:web` 会拦截：「元宝」/「yuanbao」字样、对设计包组件 / 类名 / 画布的引用、生产包中的设计包资源目录。

## 2. 字体

- 生产构建不打包任何字体文件，只声明系统字体回退链（`--font-sans`）。
- 如需在所有平台上保持一致字形，需要单独采购网页字体授权。

## 3. 第三方依赖

- 前端运行时依赖（React、React Router、TanStack Query）均为 MIT 许可，图标库 lucide-react 为 ISC 许可；构建与测试工具（Vite、Vitest、Testing Library、Playwright）为 MIT / Apache-2.0，只在开发环境使用。
- 后端运行时依赖：FastAPI、Starlette、Pydantic、SQLAlchemy、Alembic、httpx、uvicorn、openai SDK、cachetools（MIT / BSD）；psycopg 3（LGPL-3.0，作为未修改的动态链接库使用）；argon2-cffi（MIT）、Pillow（MIT-CMU）、pypdf（BSD-3）。
- worker 依赖 Playwright（Apache-2.0）与 Chromium（BSD 及其组件许可）。

## 4. 测试环境字体

截图回归测试需要中文字体渲染。测试机安装了系统包 `google-noto-sans-cjk-sc-fonts`（SIL Open Font License 1.1）。
它只用于本机浏览器渲染，不进入仓库，也不打入产品构建。
