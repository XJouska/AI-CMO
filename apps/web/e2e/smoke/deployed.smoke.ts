import { expect, test } from '@playwright/test'

// 针对已部署的 aicmo-v2 容器做冒烟测试（含真实 Nginx 与 CSP）。
// 用法：SMOKE_BASE_URL=http://127.0.0.1:9020 npx playwright test -c playwright.smoke.config.ts

test('生产容器：页面加载无 CSP 违规和脚本错误，四个 Tab 可切换', async ({ page }) => {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`)
  })

  const response = await page.goto('/')
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'")
  await expect(page).toHaveURL(/\/assistant$/)
  const nav = page.getByRole('navigation', { name: '主导航' })
  for (const label of ['商机', '官网', '我的', '助手']) {
    await nav.getByRole('button', { name: label }).click()
  }
  await expect(page.getByText('AI-CMO').first()).toBeVisible()
  expect(problems).toEqual([])
})

test('生产容器：健康检查与安全响应头', async ({ request }) => {
  const health = await request.get('/health')
  expect(health.status()).toBe(200)
  const headers = (await request.get('/me')).headers()
  expect(headers['x-frame-options']).toBe('DENY')
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect((await request.get('/.env')).status()).toBe(403)
})
