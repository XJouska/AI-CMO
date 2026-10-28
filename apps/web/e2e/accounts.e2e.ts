import { expect, test } from '@playwright/test'
import { expectNoFallback, signUp, watchPageErrors } from './helpers'

// 计划 02：注册 → 创建企业 → 建档（网址 / 口述）→ 确认变更 → 档案完整度；产品与退出登录。
// 后端运行在 TEST_MODE：网页抓取与 LLM 使用假实现，worker 真实处理任务表。

test('注册并创建企业后进入建档引导', async ({ page }) => {
  const errors = watchPageErrors(page)
  await page.goto('/register')
  const register = page.getByRole('button', { name: '注册', exact: true })
  await expect(register).toBeDisabled()
  await page.getByLabel('称呼').fill('王总')
  await page.getByLabel('邮箱').fill(`reg-${Date.now()}@example.com`)
  await page.getByLabel('密码', { exact: true }).fill('abcdefgh')
  await register.click()
  await expect(page.getByText('密码需同时包含字母和数字')).toBeVisible()
  await page.getByLabel('密码', { exact: true }).fill('Factory123')
  await register.click()

  await expect(page).toHaveURL(/\/onboarding\/company$/)
  await page.getByLabel('企业中文名').fill('宁波演示阀门厂')
  await page.getByRole('button', { name: '创建企业' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await expect(page.getByText('我有企业网站')).toBeVisible()
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('onboarding-choose.png')
  expect(errors).toEqual([])
})

test('从网址建档：进度 → 确认变更 → 合并后完整度更新', async ({ page, request }) => {
  await signUp(page, request)
  await page.goto('/onboarding/url')
  await page.getByLabel('网址').fill('127.0.0.1')
  await page.getByRole('button', { name: '开始整理' }).click()
  const blocked = page.getByText('该网址无法访问，请检查是否为公开的网站地址')
  await expect(blocked).toBeVisible()
  await expect(blocked).toBeHidden({ timeout: 5000 })

  await page.getByLabel('网址').fill('demo-valve.example')
  await page.getByRole('button', { name: '开始整理' }).click()
  await expect(page).toHaveURL(/\/extractions\/[\w-]+(\/review)?$/)
  await expect(page).toHaveURL(/\/review$/, { timeout: 20_000 })

  await expect(page.getByText('成立年份')).toBeVisible()
  await expect(page.getByText(/^Stainless Steel Ball Valve · /)).toBeVisible()
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('extraction-review.png', { fullPage: false })

  const merge = page.getByRole('button', { name: /确认合并/ })
  await merge.click()
  await expect(page).toHaveURL(/\/me\/profile$/)
  await expect(page.getByText(/已更新档案，完整度 \d+%/)).toBeVisible()
  await expect(page.getByText(/^完整度 [1-9]\d*%$/).first()).toBeVisible()

  await page.goto('/me/products')
  await expect(page.getByText('Stainless Steel Ball Valve', { exact: true }).first()).toBeVisible()
})

test('口述建档：取消部分条目后只合并勾选项', async ({ page, request }) => {
  const account = await signUp(page, request)
  await page.goto('/onboarding/chat')
  await page.getByLabel('工厂和产品介绍').fill('我们是做不锈钢阀门的工厂，成立于 2010 年，有 200 名员工，邮箱 sales@demo.example')
  await page.getByRole('button', { name: '开始整理' }).click()
  await expect(page).toHaveURL(/\/review$/, { timeout: 20_000 })

  const employees = page.locator('.review-row', { hasText: '员工人数' })
  await employees.getByRole('checkbox').uncheck()
  await page.getByRole('button', { name: /确认合并/ }).click()
  await expect(page).toHaveURL(/\/me\/profile$/)

  const profile = await request.get('/api/v1/profile', {
    headers: { Authorization: `Bearer ${account.token}`, 'X-Company-Id': account.companyId! },
  })
  const body = await profile.json()
  expect(body.founded_year).toBe(2010)
  expect(body.employees).toBe('')
  expect(body.field_sources.founded_year.source).toBe('chat')
})

test('档案分区编辑与产品管理', async ({ page, request }) => {
  await signUp(page, request)
  await page.goto('/me')
  await expect(page.getByText('完整度 0%').first()).toBeVisible()
  await expectNoFallback(page)
  await page.goto('/me/profile')
  await expect(page.getByText('完整度 0%', { exact: true }).first()).toBeVisible()
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('profile-empty.png')
  await page.getByRole('button', { name: /核心优势/ }).click()
  await expect(page).toHaveURL(/\/me\/profile\/story$/)
  await page.getByLabel('核心优势').fill('In-house casting and 100% pressure testing')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page).toHaveURL(/\/me\/profile$/)
  await expect(page.getByText('完整度 8%', { exact: true }).first()).toBeVisible()

  await page.goto('/me/products')
  await expect(page.getByText('还没有产品')).toBeVisible()
  await expect(page).toHaveScreenshot('products-empty.png')
  await page.getByRole('button', { name: '新增产品' }).click()
  await page.getByLabel('英文名称').fill('Gate Valve')
  await page.getByLabel(/英文关键词/).fill('gate valve, industrial valve')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page).toHaveURL(/\/me\/products$/)
  await expect(page.getByText('Gate Valve', { exact: true })).toBeVisible()
})

test('退出登录需要确认，退出后回到登录页', async ({ page, request }) => {
  await signUp(page, request)
  await page.goto('/me')
  await page.getByRole('main').getByRole('button', { name: '退出登录' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('确定退出登录？')
  await expect(page).toHaveScreenshot('logout-dialog.png')
  await dialog.getByRole('button', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/me')
  await expect(page).toHaveURL(/\/login$/)
})

test('网络错误状态：接口失败时显示错误空态并可重试', async ({ page, request }) => {
  await signUp(page, request)
  let fail = true
  await page.route('**/api/v1/profile', (route) => (fail ? route.fulfill({ status: 502, body: '' }) : route.fallback()))
  await page.goto('/me/profile')
  await expect(page.getByText('网络不太顺畅')).toBeVisible()
  await expect(page).toHaveScreenshot('profile-network-error.png')
  fail = false
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(page.getByText('完整度 0%', { exact: true }).first()).toBeVisible()
})
