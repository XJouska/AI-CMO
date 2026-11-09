import { expect, test } from '@playwright/test'
import { completeProfile, expectNoFallback, signUp, signUpAsOperator, staffHeaders, waitForPendingLeads, watchPageErrors } from './helpers'

// 计划 05：一键创建监控 → 手动运行（假搜索源，worker 真实跑流水线）→ 运营复核通过 → 用户看到商机 → 详情 / 反馈。
// 运营账号由 backend/scripts/e2e_seed.py 预置。

test('一键创建监控 → 运行 → 复核通过 → 用户看到商机 → 详情与反馈', async ({ page, request }, info) => {
  const errors = watchPageErrors(page)
  const account = await signUpAsOperator(page, request)
  await completeProfile(request, account.token, account.companyId!)

  await page.goto('/leads')
  await expect(page.getByText('还没有开启商机监控')).toBeVisible()
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('leads-no-watch.png')

  await page.getByRole('button', { name: '一键根据档案创建监控' }).click()
  await expect(page).toHaveURL(/\/me\/watches$/)
  await expect(page.getByLabel('关键词（英文，逗号分隔）')).toHaveValue('ball valve')
  await expect(page.getByText(/新商机 \d+ 条（待复核）/)).toBeVisible({ timeout: 20_000 })

  // 复核前用户看不到商机
  await page.goto('/leads')
  await expect(page.getByText('正在为你寻找商机')).toBeVisible()
  await expect(page).toHaveScreenshot('leads-waiting.png')

  // 运营复核：通过第一条，驳回其余
  const staff = await staffHeaders(request)
  const queue = await waitForPendingLeads(request, staff, account.companyId!)
  const [approved, ...rejected] = queue
  expect((await request.post(`/api/v1/ops/leads/${approved.lead.id}/review`, { headers: staff, data: { decision: 'approved' } })).ok()).toBeTruthy()
  for (const item of rejected) {
    await request.post(`/api/v1/ops/leads/${item.lead.id}/review`, { headers: staff, data: { decision: 'rejected' } })
  }

  await page.reload()
  const card = page.locator(`[data-lead-id="${approved.lead.id}"]`)
  await expect(card).toBeVisible()
  expect(await page.locator('[data-lead-id]').count()).toBe(1)
  if (info.project.name === 'desktop') await expect(page.locator('.app-sidebar').getByRole('link', { name: /海外买家/ })).toContainText('1')
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('leads-list.png', { mask: [page.getByText(/今日新增/)] })

  await card.click()
  await expect(page).toHaveURL(new RegExp(`/leads/${approved.lead.id}$`))
  await expect(page.getByText('为什么推荐')).toBeVisible()
  await expect(page.getByText('评分明细')).toBeVisible()
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('lead-detail.png', { fullPage: true })

  await page.getByRole('button', { name: '反馈' }).click()
  await page.getByRole('button', { name: '有用' }).click()
  await expect(page.getByText('感谢反馈，我们会据此优化推荐')).toBeVisible()

  expect(errors).toEqual([])
})

test('客户：海外买家卡片 → 联系话术（中英文对照、复制、一键打开）→ 标记联系进展', async ({ page, request }) => {
  const errors = watchPageErrors(page)
  const account = await signUp(page, request)
  const headers = await completeProfile(request, account.token, account.companyId!)
  await request.post('/api/v1/service/onboarding', { headers, data: { style_choice: 'precision' } })
  const watch = await (await request.post('/api/v1/watches/from-profile', { headers })).json()
  await request.patch(`/api/v1/watches/${watch.id}`, { headers, data: { is_active: true } })
  await request.post(`/api/v1/watches/${watch.id}/run`, { headers })
  const staff = await staffHeaders(request)
  const [first, ...rest] = await waitForPendingLeads(request, staff, account.companyId!)
  await request.post(`/api/v1/ops/leads/${first.lead.id}/review`, { headers: staff, data: { decision: 'approved' } })
  for (const item of rest) await request.post(`/api/v1/ops/leads/${item.lead.id}/review`, { headers: staff, data: { decision: 'rejected' } })

  await page.goto('/buyers')
  const card = page.locator(`[data-lead-id="${first.lead.id}"]`)
  await expect(card).toBeVisible()
  await expect(card.getByText('对方要采购')).toBeVisible()
  await expect(card.getByText('怎么联系')).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/商机|档案|监控|助手/)
  await expectNoFallback(page)
  await card.getByRole('button', { name: '查看话术' }).click()
  await expect(page).toHaveURL(new RegExp(`/buyers/${first.lead.id}$`))

  await page.getByRole('button', { name: '帮我写联系话术' }).click()
  const kit = page.locator('.kit-card').first()
  await expect(kit).toBeVisible({ timeout: 20_000 })
  await expect(kit.getByText('英文（发给对方）')).toBeVisible()
  await expect(kit.getByText('中文意思（给你看）')).toBeVisible()
  await expect(kit.getByRole('button', { name: '复制英文' })).toBeVisible()
  await expectNoFallback(page)
  await expect(page.locator('body')).not.toContainText(/商机|档案|监控|助手/)

  await page.getByRole('button', { name: '我已联系' }).click()
  await expect(page.getByRole('button', { name: '我已联系' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '对方回复了' }).click()
  await expect(page.getByRole('button', { name: '对方回复了' })).toHaveAttribute('aria-pressed', 'true')
  await page.goto('/buyers')
  await expect(page.locator(`[data-lead-id="${first.lead.id}"]`).getByText('对方回复了')).toBeVisible()
  expect(errors).toEqual([])
})
