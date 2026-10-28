#!/usr/bin/env node
// 生产构建后裁剪设计包静态资源：dist 中只保留构建产物实际引用的图片。
//
// 设计包 public/ 目录（图标、插画、示例图）整体复制进 dist，其中 images/ 与 loading/ 主要是设计稿示例图（约 13MB）。
// 这些示例图只在组件「未传内容」时作为占位显示；应用所有组件都传入了真实内容（E2E 的 expectNoFallback 保证），
// 端到端测试中也没有任何页面请求 images/ 或 loading/（E2E_ASSET_LOG 记录为空）。
// 保留规则：
// 1. icons/、figma-assets/：运行时按节点 ID / 名称 / 变体拼接路径，整体保留
// 2. KEEP 清单：应用确实会显示的少量图片
// 其余 images/、loading/ 删除。若以后用到示例图，请加入 KEEP 并在 E2E 中覆盖。
// 用法：node scripts/prune-dist-assets.mjs [distDir]
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.resolve(process.argv[2] ?? path.join(here, '..', 'apps', 'web', 'dist'))
const ASSET_DIRS = ['images', 'loading']
const KEEP = new Set(['images/profile-avatar-default.png', 'loading/blue-1.png', 'loading/blue-2.png'])

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

const files = await walk(dist)

let removed = 0
let removedBytes = 0
for (const file of files) {
  const rel = path.relative(dist, file).split(path.sep).join('/')
  if (!ASSET_DIRS.some((d) => rel.startsWith(`${d}/`))) continue
  if (KEEP.has(rel)) continue
  removedBytes += (await stat(file)).size
  await rm(file)
  removed += 1
}
console.log(`prune-dist-assets: 删除 ${removed} 个未引用的设计包资源（${(removedBytes / 1024 / 1024).toFixed(1)} MB）`)
