import { expect, test, type APIRequestContext } from '@playwright/test'
import { completeProfile, expectNoFallback, signUp, watchPageErrors } from './helpers'

// 计划 05：一键创建监控 → 手动运行（假搜索源，worker 真实跑流水线）→ 运营复核通过 → 用户看到商机 → 详情 / 反馈。
// 运营账号由 backend/scripts/e2e_seed.py 预置。

async function staffHeaders(request: APIRequestContext) {
  const res = await request.post('/api/v1/auth/login', { data: { email: 'ops-e2e@example.com', password: 'Operator123' } })
  expect(res.ok()).toBeTruthy()
  return { Authorization: `Bearer ${(await res.json()).token}` }
}

async function waitForPendingLeads(request: APIRequestContext, headers: Record<string, string>, companyId: string) {
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

test('一键创建监控 → 运行 → 复核通过 → 用户看到商机 → 详情与反馈', async ({ page, request }) => {
  const errors = watchPageErrors(page)
  const account = await signUp(page, request)
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
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: /商机/ })).toContainText('1')
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
