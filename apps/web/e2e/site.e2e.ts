import { expect, test } from '@playwright/test'
import { completeProfile, expectNoFallback, signUpAsOperator, watchPageErrors } from './helpers'

// 计划 04：官网生成 → 编辑 → 预览 → 发布 → 询盘 → 应用内通知。后端 TEST_MODE（假 LLM），worker 真实处理任务。

test('档案不足时引导完善；生成官网 → 编辑 → 预览 → 发布 → 询盘通知', async ({ page, request }) => {
  const errors = watchPageErrors(page)
  const account = await signUpAsOperator(page, request)
  await page.goto('/site')
  await expect(page.getByText(/企业档案完整度需要达到 60%/)).toBeVisible()
  await expect(page).toHaveScreenshot('site-need-profile.png')

  const headers = await completeProfile(request, account.token, account.companyId!)
  await page.reload()
  await page.getByRole('button', { name: '生成我的英文官网' }).click()
  await expect(page.getByText('访问地址')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('首页横幅')).toBeVisible()
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('site-dashboard.png', { mask: [page.getByText(/sites\.e2e\.test/)] })

  // 编辑首页横幅
  await page.getByText('首页横幅').click()
  await page.getByLabel('主标题').fill('Factory-direct Stainless Steel Ball Valves')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page).toHaveURL(/\/site$/)

  // 预览（沙箱 iframe）
  await page.getByRole('button', { name: '预览' }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('heading', { level: 1 })).toHaveText('Factory-direct Stainless Steel Ball Valves')
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', '')
  await page.goBack()

  // 发布
  await page.getByRole('button', { name: '发布更新' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '发布更新' }).click()
  await expect(page.getByText(/^已发布：/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: '已发布' })).toBeDisabled()

  // 买家通过官网表单提交询盘（含 XSS 内容）
  const site = await (await request.get('/api/v1/site', { headers })).json()
  const submit = await request.post(`/api/v1/public/sites/${site.id}/inquiries`, {
    form: { name: 'John', email: 'john@buyer.example', company_name: 'Buyer GmbH', country: 'Germany',
      product_ref: 'Ball Valve', message: '<img src=x onerror=alert(1)> Please quote 500 pcs.' },
    maxRedirects: 0,
  })
  expect(submit.status()).toBe(303)
  expect(submit.headers()['location']).toBe('/thank-you.html')

  await page.reload()
  await expect(page.getByText('Buyer GmbH · Germany')).toBeVisible()
  await page.getByText('Buyer GmbH · Germany').click()
  await expect(page.getByText('<img src=x onerror=alert(1)> Please quote 500 pcs.')).toBeVisible()
  expect(await page.locator('img[src="x"]').count()).toBe(0)
  await expect(page).toHaveScreenshot('site-inquiry.png', { mask: [page.getByText(/\d{4}-\d{2}-\d{2}/)] })

  const notifications = await (await request.get('/api/v1/notifications', { headers })).json()
  expect(notifications[0].title).toBe('网站收到询价：Buyer GmbH')
  expect(errors).toEqual([])
})

test('版本回滚与健康检查', async ({ page, request }) => {
  const account = await signUpAsOperator(page, request)
  const headers = await completeProfile(request, account.token, account.companyId!)
  await request.post('/api/v1/site/generate', { headers, data: {} })
  await expect.poll(async () => (await (await request.get('/api/v1/site', { headers })).json()).task.status, { timeout: 20_000 }).toBe('idle')
  await request.put('/api/v1/site/sections/hero', { headers, data: { data: { headline: 'Second', cta: 'Quote' } } })

  await page.goto('/site/versions')
  await expect(page.getByText('编辑：hero')).toBeVisible()
  await page.locator('.ui-row', { hasText: 'AI 生成' }).getByRole('button', { name: '恢复为草稿' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '恢复为草稿' }).click()
  await expect(page.getByText('已恢复为草稿')).toBeVisible()
  const draft = await (await request.get('/api/v1/site/draft', { headers })).json()
  expect(draft.note).toBe('回滚到历史版本')
  expect(draft.content.hero.headline).not.toBe('Second')

  await page.goto('/site/health')
  await page.getByRole('button', { name: '重新检查' }).click()
  await expect(page.getByText('缺少工厂实拍图片')).toBeVisible()
  await expect(page).toHaveScreenshot('site-health.png')
})
