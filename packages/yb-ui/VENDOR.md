# packages/yb-ui 来源记录

本目录是 yb-mobile-design 设计系统的 vendored 副本，**不要直接修改 `demo/` 和 `assets/` 下的文件**。
需要调整时，在 `extensions/` 中实现并登记到 [docs/ui-gaps.md](../../docs/ui-gaps.md)。

## 当前快照

| 项 | 值 |
|---|---|
| 来源文件 | `yb-mobile-design-GO.zip`（不入库） |
| zip SHA-256 | 见 `vendor-lock.json` 的 `zipSha256` |
| Figma 文件 | `iUyH8VSdURxlGrhp646zYJ` |
| 快照日期 | 2026-09-13 |
| 快照指纹 | 见 `figma-snapshot-manifest.json` / `vendor-lock.json` 的 `library.snapshotFingerprint` |
| 复制日期 | 2026-10-15 |

完整文件清单和每个文件的 SHA-256 记录在 `vendor-lock.json`。

## 复制清单

保持设计包原有相对目录结构，这样 vendored 文件无需修改即可工作（例如 `fonts.css` 中的 `../../assets/fonts/`）。

| 来源（zip 内 `yb-mobile-design/`） | 目标 |
|---|---|
| `demo/src/generated/` | `demo/src/generated/` |
| `demo/src/library/` | `demo/src/library/` |
| `demo/src/components/` | `demo/src/components/` |
| `demo/src/{tokens,fonts,index}.css` | `demo/src/` |
| `demo/public/{icons,figma-assets,images,loading}` | `demo/public/` |
| `demo/data/figma-snapshot-manifest.json` | `figma-snapshot-manifest.json` |
| `assets/fonts/{manifest.json,README.md}` | `assets/fonts/` |
| `assets/fonts/*.otf`（仅 `--with-fonts`） | `assets/fonts/`（被 `.gitignore` 排除） |

**不复制**：Figma Code Connect（`figma/*.figma.ts`）、设计包脚本、规范文档（`references/`）、评测、示例页面（`screens/`）、
`yuanbao-brand.svg`、`favicon.svg`、iPad 资源。

> 与计划 01 的差异：计划写的是复制 `screens/DemoShell.tsx` 作为设备壳参考。实际应用壳直接使用正式 `HostCanvas`，
> 不需要 DemoShell，所以没有复制。

## 应用中的引用方式

`apps/web` 配置了以下别名：

| 别名 | 指向 |
|---|---|
| `@yb/*` | `packages/yb-ui/demo/src/*` |
| `@yb-ext/*` | `packages/yb-ui/extensions/*` |

Vite 的 `publicDir` 指向 `packages/yb-ui/demo/public`，组件中以 `/icons/...` 等根路径引用的资源因此可以直接加载。

## 更新流程

```bash
node scripts/vendor-yb-ui.mjs /path/to/yb-mobile-design.zip --with-fonts
git diff --stat packages/yb-ui/vendor-lock.json   # 查看哪些文件变化
npm run typecheck && npm run check:web
```

更新后需要逐项复核 `extensions/` 中的本地扩展是否仍然适配（特别是 `BrandTabBar` 依赖的 TabBar 类名）。
