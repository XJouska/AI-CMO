import { expect, test } from '@playwright/test'
import { signUp } from '../helpers'

// 针对已部署的 aicmo-v2 容器做冒烟测试（含真实 Nginx 与 CSP）。
// 用法：SMOKE_BASE_URL=http://127.0.0.1:9020 npx playwright test -c playwright.smoke.config.ts

test('生产容器：页面加载无 CSP 违规和脚本错误，主导航可切换', async ({ page, request }) => {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`)
  })

  const home = await page.goto('/')
  expect(home?.headers()['content-security-policy']).toContain("script-src 'self'")
  await expect(page.getByRole('heading', { level: 1, name: '帮工厂找到海外买家' })).toBeVisible()
  await expect(page.locator('[class*="yb-"]')).toHaveCount(0)

  const account = await signUp(page, request, { company: '冒烟测试厂' })
  await request.post('/api/v1/service/business', {
    headers: { Authorization: `Bearer ${account.token}`, 'X-Company-Id': account.companyId! },
    data: { business: '不锈钢球阀', target_markets: '德国' },
  })
  await page.goto('/')
  await expect(page).toHaveURL(/\/home$/)
  const nav = page.locator('.app-sidebar').getByRole('navigation', { name: '主导航' })
  for (const label of ['我的网站', '海外买家', '我的资料', '首页']) {
    await nav.getByRole('link', { name: label }).click()
    await page.waitForLoadState('networkidle')
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
  // 生产环境不公开接口文档
  expect((await request.get('/api/v1/../openapi.json')).status()).not.toBe(200)
})

test('生产容器：注册、建企业、写档案；AI 建档能结束（已配置模型时成功，未配置时给出失败原因）', async ({ request }) => {
  const email = `smoke-${Date.now()}@example.com`
  const reg = await request.post('/api/v1/auth/register', { data: { email, password: 'Factory123', name: 'smoke' } })
  expect(reg.status()).toBe(201)
  const auth = { Authorization: `Bearer ${(await reg.json()).token}` }
  const company = await (await request.post('/api/v1/companies', { data: { name_cn: '冒烟测试厂' }, headers: auth })).json()
  const headers = { ...auth, 'X-Company-Id': company.id }
  const patched = await request.patch('/api/v1/profile', { data: { usp: 'smoke' }, headers })
  expect((await patched.json()).completeness).toBe(8)

  const created = await (
    await request.post('/api/v1/extractions', { data: { source: 'chat', text: '我们是做不锈钢阀门的工厂' }, headers })
  ).json()
  await expect
    .poll(async () => (await (await request.get(`/api/v1/extractions/${created.id}`, { headers })).json()).status, {
      timeout: 120_000,
      intervals: [2000],
    })
    .toMatch(/^(succeeded|failed)$/)
})

test('生产容器：助手 SSE 经过 Nginx 正常返回事件流', async ({ request }) => {
  const reg = await request.post('/api/v1/auth/register', {
    data: { email: `sse-${Date.now()}@example.com`, password: 'Factory123', name: 'sse' },
  })
  const auth = { Authorization: `Bearer ${(await reg.json()).token}` }
  const company = await (await request.post('/api/v1/companies', { data: { name_cn: 'SSE 测试厂' }, headers: auth })).json()
  const headers = { ...auth, 'X-Company-Id': company.id }
  const conversation = await (await request.post('/api/v1/assistant/conversations', { data: {}, headers })).json()
  const res = await request.post(`/api/v1/assistant/conversations/${conversation.id}/messages`, { data: { text: '你好' }, headers })
  expect(res.headers()['content-type']).toContain('text/event-stream')
  // 宿主 Nginx 会消费 X-Accel-Buffering 头，经过它之后客户端看不到该头，这里只检查事件流本身
  const body = await res.text()
  expect(body).toContain('event: message.start')
  // 已配置模型时正常结束；未配置时返回明确错误码
  expect(body).toMatch(/event: message\.done|"code":"llm_not_configured"/)
})
