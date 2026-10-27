# 授权事项（需项目负责人确认）

以下事项在商业上线前必须取得书面确认。确认前，代码按「未授权」处理。

## 1. yb-mobile-design 设计系统

- **内容**：组件代码（`packages/yb-ui/demo/src`）、图标与插画（`packages/yb-ui/demo/public`）、设计 Token。
- **现状**：来自内部设计包 `yb-mobile-design-GO.zip`，用于本商业产品的授权**尚未确认**。
- **已做处理**：
  - 不复制、不引用设计包品牌资产（`yuanbao-brand.svg`、`favicon.svg`）
  - 应用代码中禁止出现「元宝」/「yuanbao」字样（`npm run check:web` 检查）
- **待确认**：组件代码、图标、插画能否用于对外收费的产品；如不能，需要在上线前替换为自有实现。

## 2. 字体（PingFang SC、DIN Pro）

- **现状**：设计包 `assets/fonts/README.md` 明确说明：校验清单不构成字体授权，也不构成公开分发、网页部署或平台上传的许可。
- **已做处理**：
  - 字体文件不入库（`.gitignore` 排除 `packages/yb-ui/assets/fonts/*.otf`）
  - 开发环境使用本地字体（由 `scripts/vendor-yb-ui.mjs --with-fonts` 放置）
  - **生产构建不打包任何字体文件**，只声明系统字体回退链（见 [ui-gaps.md GAP-005](ui-gaps.md)）
- **待确认**：如需在所有平台上保持一致字形，需要单独采购网页字体授权。

## 3. 第三方依赖

- 前端运行时依赖（React、React Router、TanStack Query）均为 MIT 许可；构建与测试工具（Vite、Vitest、Testing Library、Playwright）为 MIT / Apache-2.0，只在开发环境使用。
- 后端运行时依赖：FastAPI、Starlette、Pydantic、SQLAlchemy、Alembic、httpx、uvicorn、openai SDK、cachetools（MIT / BSD）；psycopg 3（LGPL-3.0，作为未修改的动态链接库使用）；argon2-cffi（MIT）、Pillow（MIT-CMU）、pypdf（BSD-3）。
- worker 依赖 Playwright（Apache-2.0）与 Chromium（BSD 及其组件许可）。

## 4. 测试环境字体

截图回归测试需要中文字体渲染。测试机安装了系统包 `google-noto-sans-cjk-sc-fonts`（SIL Open Font License 1.1）。
它只用于本机浏览器渲染，不进入仓库，也不打入产品构建。
