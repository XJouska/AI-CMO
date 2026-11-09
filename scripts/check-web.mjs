#!/usr/bin/env node
// 前端检查：源码规则（品牌字样、设计包引用、危险 API）、类型检查、单元测试、构建、生产包不含字体与设计包资源。
// 用法：npm run check:web   （加 --skip-build 跳过构建）
import { spawnSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = path.join(repoRoot, 'apps', 'web')
const skipBuild = process.argv.includes('--skip-build')

// 应用自有代码。
const SOURCE_DIRS = [path.join(webRoot, 'src')]
const SOURCE_EXT = /\.(tsx?|css|html|svg|json)$/

const RULES = [
  { name: '设计包品牌字样', pattern: /元宝|yuanbao/i },
  // 界面只借鉴设计规范的基础样式，不允许引用设计包的组件、类名、图标或画布
  { name: '引用设计包', pattern: /@yb\/|@yb-ext\/|packages\/yb-ui|\byb-[a-z]|HostCanvas|BrandTabBar/ },
  { name: 'dangerouslySetInnerHTML', pattern: /dangerouslySetInnerHTML/ },
  { name: 'eval / new Function', pattern: /\beval\s*\(|new\s+Function\s*\(/ },
]

// 客户（工厂老板）看到的页面不出现行话：只检查字符串字面量和 JSX 文本，不检查注释和标识符。
const CUSTOMER_FILES = [
  'src/i18n/customer.ts',
  'src/pages/customer/StartPage.tsx',
  'src/pages/customer/HomePage.tsx',
  'src/pages/customer/MySitePage.tsx',
  'src/pages/customer/BuyersPages.tsx',
  'src/pages/customer/MaterialsPage.tsx',
  'src/service/components.tsx',
  'src/layout/StartLayout.tsx',
]
const CUSTOMER_JARGON = /档案|完整度|监控|商机|助手|模板|发布|版本|SMTP|询盘|开发信|复核/

/** 去掉注释，只保留字符串字面量与 JSX 文本中的中文。 */
function customerVisibleText(source) {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const texts = []
  for (const m of noComments.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`|>([^<>{}]+)</g)) texts.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '')
  return texts.join('\n')
}

async function scanCustomerCopy() {
  console.log('\n▶ 客户页面用语检查')
  for (const rel of CUSTOMER_FILES) {
    const file = path.join(webRoot, rel)
    const text = customerVisibleText(await readFile(file, 'utf8'))
    for (const line of text.split('\n')) {
      const hit = CUSTOMER_JARGON.exec(line)
      if (hit) fail(`客户页面出现行话「${hit[0]}」：${rel}：${line.trim().slice(0, 60)}`)
    }
  }
}

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
    const content = await readFile(file, 'utf8')
    // CSS：选择器列表以逗号结尾后紧跟空行，会把下一条规则误并进来（曾导致整个顶栏被隐藏）
    if (file.endsWith('.css')) {
      const dangling = /,[ \t]*\n[ \t]*\n/.exec(content)
      if (dangling) fail(`CSS 选择器后有多余的逗号：${path.relative(repoRoot, file)}:${content.slice(0, dangling.index).split('\n').length}`)
      let depth = 0
      for (const ch of content) {
        if (ch === '{') depth += 1
        if (ch === '}') depth -= 1
        if (depth < 0) break
      }
      if (depth !== 0) fail(`CSS 花括号不配对：${path.relative(repoRoot, file)}`)
    }
    const lines = content.split('\n')
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
  // 生产包里不能出现设计包的图标、插画或品牌资产
  const bannedDirs = ['icons', 'figma-assets', 'loading']
  for (const dir of bannedDirs) {
    const hits = await listFiles(path.join(dist, dir), () => true)
    if (hits.length) fail(`生产包中包含设计包资源目录：dist/${dir}`)
  }
  const banned = ['yuanbao-brand.svg', 'favicon.svg']
  for (const name of banned) {
    const hits = await listFiles(dist, (file) => file === name)
    for (const hit of hits) fail(`生产包中包含设计包品牌资产：${path.relative(repoRoot, hit)}`)
  }
  // 包体预算：首屏 JS（入口 + 共享组件库，gzip 前）与整个 dist 的体积
  const { stat } = await import('node:fs/promises')
  const js = await listFiles(path.join(dist, 'assets'), (name) => name.endsWith('.js'))
  const sizes = await Promise.all(js.map(async (f) => ({ f, size: (await stat(f)).size })))
  const largest = sizes.sort((a, b) => b.size - a.size)[0]
  if (largest && largest.size > 480 * 1024) fail(`单个 JS 文件超过 480KB：${path.relative(repoRoot, largest.f)}（${Math.round(largest.size / 1024)}KB）`)
  const all = await listFiles(dist, () => true)
  const total = (await Promise.all(all.map(async (f) => (await stat(f)).size))).reduce((a, b) => a + b, 0)
  if (total > 6 * 1024 * 1024) fail(`dist 总体积超过 6MB（${(total / 1024 / 1024).toFixed(1)}MB）`)
  console.log(`  最大 JS ${Math.round((largest?.size ?? 0) / 1024)}KB · dist 共 ${(total / 1024 / 1024).toFixed(1)}MB`)
  const css = await listFiles(path.join(dist, 'assets'), (name) => name.endsWith('.css'))
  for (const file of css) {
    if (/@font-face/.test(await readFile(file, 'utf8'))) fail(`生产 CSS 中包含 @font-face：${path.relative(repoRoot, file)}`)
  }
}

await scanSources()
await scanCustomerCopy()
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
