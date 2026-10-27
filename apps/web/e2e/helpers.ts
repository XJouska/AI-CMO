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
      if (!window.sessionStorage.getItem('e2e-init')) {
        window.localStorage.setItem('aicmo.token', t)
        if (c) window.localStorage.setItem('aicmo.company', c)
        window.sessionStorage.setItem('e2e-init', '1')
      }
    },
    [token, companyId] as const,
  )
  return { email, password, token, companyId }
}

/** 页面不得出现脚本错误与降级渲染。 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
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
