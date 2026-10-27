#!/usr/bin/env node
// 前端检查：类型检查、单元测试、构建、品牌字样、危险 API、生产包不含字体。
// 用法：npm run check:web   （加 --skip-build 跳过构建）
import { spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = path.join(repoRoot, 'apps', 'web')
const skipBuild = process.argv.includes('--skip-build')

// 应用自有代码；vendored 设计包不在检查范围内（它本身含有设计包品牌字样）。
const SOURCE_DIRS = [path.join(webRoot, 'src'), path.join(repoRoot, 'packages', 'yb-ui', 'extensions')]
const SOURCE_EXT = /\.(tsx?|css|html|svg|json)$/

const RULES = [
  { name: '设计包品牌字样', pattern: /元宝|yuanbao/i },
  { name: 'dangerouslySetInnerHTML', pattern: /dangerouslySetInnerHTML/ },
  { name: 'eval / new Function', pattern: /\beval\s*\(|new\s+Function\s*\(/ },
]

let failed = false
function fail(message) {
  console.error(`✗ ${message}`)
  failed = true
}

function run(label, cmd, args, cwd = repoRoot) {
  console.log(`\n▶ ${label}`)
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false })
  if (result.status !== 0) fail(`${label} 失败`)
}

async function listFiles(dir, filter) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      out.push(...(await listFiles(full, filter)))
    } else if (filter(entry.name)) {
      out.push(full)
    }
  }
  return out
}

async function scanSources() {
  console.log('\n▶ 源码规则检查')
  const files = []
  for (const dir of SOURCE_DIRS) files.push(...(await listFiles(dir, (name) => SOURCE_EXT.test(name))))
  files.push(path.join(webRoot, 'index.html'))
  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split('\n')
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        if (rule.pattern.test(line)) fail(`${rule.name}：${path.relative(repoRoot, file)}:${index + 1}`)
      }
    })
  }
  console.log(`  已检查 ${files.length} 个文件`)
}

async function scanDist() {
  console.log('\n▶ 构建产物检查')
  const dist = path.join(webRoot, 'dist')
  const fonts = await listFiles(dist, (name) => /\.(otf|ttf|woff2?)$/i.test(name))
  for (const font of fonts) fail(`生产包中包含字体文件：${path.relative(repoRoot, font)}`)
  const banned = ['yuanbao-brand.svg', 'favicon.svg']
  for (const name of banned) {
    const hits = await listFiles(dist, (file) => file === name)
    for (const hit of hits) fail(`生产包中包含设计包品牌资产：${path.relative(repoRoot, hit)}`)
  }
  const css = await listFiles(path.join(dist, 'assets'), (name) => name.endsWith('.css'))
  for (const file of css) {
    if (/@font-face/.test(await readFile(file, 'utf8'))) fail(`生产 CSS 中包含 @font-face：${path.relative(repoRoot, file)}`)
  }
}

await scanSources()
run('单元测试', process.execPath, ['--test', ...(await listFiles(path.join(webRoot, 'src'), (n) => n.endsWith('.test.ts')))])
run('类型检查', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], webRoot)
run('类型检查（配置与测试）', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.node.json'], webRoot)
run('类型检查（组件测试与 E2E）', 'npx', ['tsc', '--noEmit', '-p', 'tsconfig.test.json'], webRoot)
if (!skipBuild) {
  run('构建', 'npx', ['vite', 'build'], webRoot)
  await scanDist()
}

if (failed) {
  console.error('\n前端检查未通过')
  process.exit(1)
}
console.log('\n✓ 前端检查通过')
