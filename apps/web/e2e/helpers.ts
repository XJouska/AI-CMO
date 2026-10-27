import { expect, type APIRequestContext, type Page } from '@playwright/test'

let counter = 0

export interface TestAccount {
  email: string
  password: string
  token: string
  companyId: string | null
}

/** 通过接口注册账号（可选创建企业），并把登录态写入浏览器 localStorage。 */
export async function signUp(
  page: Page,
  request: APIRequestContext,
  options: { company?: string | false; name?: string } = {},
): Promise<TestAccount> {
  counter += 1
  const email = `e2e-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 7)}@example.com`
  const password = 'Factory123'
  const registered = await request.post('/api/v1/auth/register', { data: { email, password, name: options.name ?? '王总' } })
  expect(registered.ok()).toBeTruthy()
  const { token } = await registered.json()
  let companyId: string | null = null
  if (options.company !== false) {
    const created = await request.post('/api/v1/companies', {
      data: { name_cn: options.company ?? '宁波演示阀门厂', name_en: '' },
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(created.ok()).toBeTruthy()
    companyId = (await created.json()).id
  }
  await page.addInitScript(
    ([t, c]) => {
      // 只在顶层页面写入登录态；沙箱 iframe（官网预览）没有存储权限
      if (window.top !== window) return
      try {
        if (!window.sessionStorage.getItem('e2e-init')) {
          window.localStorage.setItem('aicmo.token', t)
          if (c) window.localStorage.setItem('aicmo.company', c)
          window.sessionStorage.setItem('e2e-init', '1')
        }
      } catch {
        // 无存储权限的上下文
      }
    },
    [token, companyId] as const,
  )
  return { email, password, token, companyId }
}

/** 页面不得出现脚本错误、控制台错误（含失败的网络请求）与降级渲染。 */
export function watchPageErrors(page: Page, { allowHttpErrors = false } = {}): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (allowHttpErrors && msg.text().startsWith('Failed to load resource')) return
    // 测试框架注入到每个 frame 的初始化脚本在沙箱预览 iframe 中被拦截——这正说明沙箱生效，不属于应用错误
    if (msg.text().startsWith('Blocked script execution') && msg.text().includes('/public/site-preview/')) return
    errors.push(`console: ${msg.text()}`)
  })
  return errors
}

// 正式组件在缺少内容时显示的设计稿占位文案；出现即说明页面漏传了内容。
const PLACEHOLDER_TEXT = /描述文本|列表标题|标题下描述文本|其他文本内容|这里是标题|主要按钮|次要按钮|Description|^Title$/m

export async function expectNoFallback(page: Page) {
  expect(await page.locator('.yb-fallback').count()).toBe(0)
  const text = await page.locator('body').innerText()
  expect(text).not.toMatch(/\u5143\u5b9d/)
  expect(text).not.toMatch(PLACEHOLDER_TEXT)
}

/** 通过接口把企业档案补全到可生成官网 / 商机监控的程度，返回带企业头的请求头。 */
export async function completeProfile(request: APIRequestContext, token: string, companyId: string) {
  const headers = { Authorization: `Bearer ${token}`, 'X-Company-Id': companyId }
  await request.patch('/api/v1/profile', {
    headers,
    data: {
      name_en: 'Demo Valve Co., Ltd.',
      founded_year: 2008,
      employees: '120',
      factory_area: '15000 m²',
      annual_capacity: '500,000 valves',
      export_markets: ['Germany', 'United States'],
      certifications: ['ISO 9001', 'CE'],
      usp: 'In-house casting and 100% pressure testing',
      about_en: 'Demo Valve manufactures stainless steel ball valves.',
      contacts: { email: 'sales@demo-valve.example' },
    },
  })
  await request.post('/api/v1/products', {
    headers,
    data: { name_en: 'Stainless Steel Ball Valve', keywords_en: ['ball valve'], applications: ['water treatment'] },
  })
  return headers
}

/** 预置运营账号（backend/scripts/e2e_seed.py）的认证头。 */
export async function staffHeaders(request: APIRequestContext) {
  const res = await request.post('/api/v1/auth/login', { data: { email: 'ops-e2e@example.com', password: 'Operator123' } })
  expect(res.ok()).toBeTruthy()
  return { Authorization: `Bearer ${(await res.json()).token}` }
}

/** 等待指定企业的复核队列出现待复核商机。 */
export async function waitForPendingLeads(request: APIRequestContext, headers: Record<string, string>, companyId: string) {
  let items: { lead: { id: string; type: string } }[] = []
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/v1/ops/review-queue?company_id=${companyId}`, { headers })
        items = await res.json()
        return items.length
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0)
  return items
}
