#!/usr/bin/env node
// 总检查：每个计划提交前必须通过。
// 用法：node scripts/check-all.mjs [--skip-e2e] [--skip-build] [--skip-audit]
// 前置：测试数据库 aicmo-v2-testdb（127.0.0.1:55432）在运行；backend/.venv 已安装 requirements-dev.txt。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backend = path.join(repoRoot, 'backend')
const args = new Set(process.argv.slice(2))
const py = path.join(backend, '.venv', 'bin', 'python')

const results = []

function step(label, cmd, cmdArgs, { cwd = repoRoot, env = {}, advisory = false } = {}) {
  console.log(`\n━━ ${label}`)
  const started = Date.now()
  const res = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', shell: false, env: { ...process.env, ...env } })
  const ok = res.status === 0
  results.push({ label, ok, advisory, seconds: ((Date.now() - started) / 1000).toFixed(1) })
  return ok
}

if (!existsSync(py)) {
  console.error('缺少 backend/.venv，请先执行：cd backend && python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt')
  process.exit(1)
}

step('前端检查', process.execPath, ['scripts/check-web.mjs', ...(args.has('--skip-build') ? ['--skip-build'] : [])])
if (existsSync(path.join(repoRoot, 'apps/web/vitest.config.ts'))) {
  step('前端组件测试（Vitest）', 'npx', ['vitest', 'run'], { cwd: path.join(repoRoot, 'apps/web') })
}
step('后端 ruff check', py, ['-m', 'ruff', 'check', '.'], { cwd: backend })
step('后端 ruff format --check', py, ['-m', 'ruff', 'format', '--check', '.'], { cwd: backend })
step('后端 pytest + 覆盖率', py, ['-m', 'pytest', '--cov', '--cov-report=term', '--cov-fail-under=85'], { cwd: backend })
step('安全模块覆盖率 100%', py, ['-m', 'pytest', 'tests/test_ssrf.py', 'tests/test_auth.py', 'tests/test_profile_products_assets.py', 'tests/test_route_guard.py', 'tests/test_deps.py', '--cov=app.core.security', '--cov=app.core.deps', '--cov-report=term-missing', '--cov-fail-under=100'], { cwd: backend })
step('迁移在空库可升级 / 回退', py, ['scripts/migration_roundtrip.py'], { cwd: backend })

if (!args.has('--skip-e2e') && existsSync(path.join(repoRoot, 'apps/web/playwright.config.ts'))) {
  step('端到端测试（Playwright）', 'npx', ['playwright', 'test'], { cwd: path.join(repoRoot, 'apps/web') })
}

if (!args.has('--skip-audit')) {
  step('依赖审计（pip-audit，仅报告）', py, ['-m', 'pip_audit', '-r', 'requirements.txt', '--progress-spinner', 'off'], { cwd: backend, advisory: true })
  step('依赖审计（npm audit，仅报告）', 'npm', ['audit', '--omit=dev'], { advisory: true })
}

console.log('\n━━ 汇总')
for (const r of results) {
  const mark = r.ok ? '✓' : r.advisory ? '!' : '✗'
  console.log(`  ${mark} ${r.label} (${r.seconds}s)${!r.ok && r.advisory ? ' — 仅报告' : ''}`)
}
const failed = results.filter((r) => !r.ok && !r.advisory)
if (failed.length) {
  console.error(`\n✗ ${failed.length} 项检查未通过`)
  process.exit(1)
}
console.log('\n✓ 全部检查通过')
