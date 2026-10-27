#!/usr/bin/env node
// 从 yb-mobile-design 设计包 zip 复制组件运行时到 packages/yb-ui。
// 用法：node scripts/vendor-yb-ui.mjs <path-to-yb-mobile-design.zip> [--with-fonts]
//
// - 保持设计包原有的相对目录结构（demo/src、demo/public、assets/fonts），
//   这样 vendored 文件无需任何修改即可工作（例如 fonts.css 里的 ../../assets/fonts）。
// - 字体文件只在 --with-fonts 时复制，并且已被 .gitignore 排除，不进仓库。
// - 不复制：Figma Code Connect、设计包脚本、规范文档、评测、示例页面、元宝品牌图、iPad 资源。
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(repoRoot, 'packages', 'yb-ui')

const SRC_ENTRIES = ['generated', 'library', 'components', 'tokens.css', 'fonts.css', 'index.css']
const PUBLIC_ENTRIES = ['icons', 'figma-assets', 'images', 'loading']
const EXCLUDED_PUBLIC = ['yuanbao-brand.svg', 'favicon.svg', 'ipad']

function fail(message) {
  console.error(message)
  process.exit(1)
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

async function listFiles(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) fail(`拒绝符号链接：${full}`)
    if (entry.isDirectory()) out.push(...(await listFiles(full)))
    else if (entry.isFile()) out.push(full)
  }
  return out.sort()
}

async function main() {
  const args = process.argv.slice(2)
  const zip = args.find((a) => !a.startsWith('--'))
  const withFonts = args.includes('--with-fonts')
  if (!zip) fail('用法：node scripts/vendor-yb-ui.mjs <yb-mobile-design.zip> [--with-fonts]')
  const zipPath = path.resolve(zip)
  await stat(zipPath)

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'yb-vendor-'))
  try {
    // 参数列表调用，不经过 shell。
    const unzip = spawnSync('unzip', ['-q', zipPath, '-d', tmp], { stdio: 'inherit', shell: false })
    if (unzip.status !== 0) fail('解压失败')

    const pkgRoot = path.join(tmp, 'yb-mobile-design')
    const demo = path.join(pkgRoot, 'demo')
    const manifest = JSON.parse(await readFile(path.join(demo, 'data', 'figma-snapshot-manifest.json'), 'utf8'))

    for (const dir of ['demo', 'assets']) await rm(path.join(target, dir), { recursive: true, force: true })
    await mkdir(path.join(target, 'demo', 'src'), { recursive: true })
    await mkdir(path.join(target, 'demo', 'public'), { recursive: true })
    await mkdir(path.join(target, 'assets', 'fonts'), { recursive: true })

    for (const entry of SRC_ENTRIES) {
      await cp(path.join(demo, 'src', entry), path.join(target, 'demo', 'src', entry), { recursive: true })
    }
    for (const entry of PUBLIC_ENTRIES) {
      await cp(path.join(demo, 'public', entry), path.join(target, 'demo', 'public', entry), { recursive: true })
    }
    await cp(path.join(demo, 'data', 'figma-snapshot-manifest.json'), path.join(target, 'figma-snapshot-manifest.json'))

    const fontRoot = path.join(pkgRoot, 'assets', 'fonts')
    await cp(path.join(fontRoot, 'manifest.json'), path.join(target, 'assets', 'fonts', 'manifest.json'))
    await cp(path.join(fontRoot, 'README.md'), path.join(target, 'assets', 'fonts', 'README.md'))
    const fontManifest = JSON.parse(await readFile(path.join(fontRoot, 'manifest.json'), 'utf8'))
    if (withFonts) {
      for (const font of fontManifest.fonts) {
        if (!/^[A-Za-z0-9_-]+\.(otf|ttf)$/.test(font.file)) fail(`非法字体文件名：${font.file}`)
        const src = path.join(fontRoot, font.file)
        if ((await sha256(src)) !== font.sha256) fail(`字体校验失败：${font.file}`)
        await cp(src, path.join(target, 'assets', 'fonts', font.file))
      }
    }

    const files = await listFiles(path.join(target, 'demo'))
    const hashes = {}
    for (const file of files) hashes[path.relative(target, file).split(path.sep).join('/')] = await sha256(file)
    const lock = {
      source: path.basename(zipPath),
      zipSha256: await sha256(zipPath),
      vendoredAt: new Date().toISOString().slice(0, 10),
      library: {
        fileKey: manifest.fileKey,
        snapshotDate: manifest.snapshotDate,
        snapshotFingerprint: manifest.snapshotFingerprint,
        assetCount: manifest.assetCount,
      },
      copied: { src: SRC_ENTRIES, public: PUBLIC_ENTRIES },
      excludedPublic: EXCLUDED_PUBLIC,
      fontsCopied: withFonts,
      fileCount: files.length,
      files: hashes,
    }
    await writeFile(path.join(target, 'vendor-lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
    console.log(`已复制 ${files.length} 个文件到 ${path.relative(repoRoot, target)}（字体：${withFonts ? '已复制，不入库' : '未复制'}）`)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

main().catch((error) => fail(error.stack ?? String(error)))
