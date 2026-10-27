import { expect, test, type APIRequestContext } from '@playwright/test'
import { completeProfile, expectNoFallback, signUp, staffHeaders, waitForPendingLeads, watchPageErrors } from './helpers'

// 计划 06：商机 → 生成开发信 → 确认发送（假 SMTP）→ 自动推进「已联系」→ 记录回复 → 推进阶段 → 下一步提醒（待跟进）→ 周报。

async function approvedLead(request: APIRequestContext, token: string, companyId: string) {
  const headers = await completeProfile(request, token, companyId)
  const watch = await (await request.post('/api/v1/watches/from-profile', { headers })).json()
  await request.patch(`/api/v1/watches/${watch.id}`, { headers, data: { is_active: true } })
  await request.post(`/api/v1/watches/${watch.id}/run`, { headers })
  const staff = await staffHeaders(request)
  const queue = await waitForPendingLeads(request, staff, companyId)
  const tender = queue.find((item) => item.lead.type === 'tender') ?? queue[0]
  await request.post(`/api/v1/ops/leads/${tender.lead.id}/review`, { headers: staff, data: { decision: 'approved' } })
  return { headers, leadId: tender.lead.id }
}

test('开发信 → 确认发送 → 跟进阶段 → 待跟进 → 周报', async ({ page, request }) => {
  const errors = watchPageErrors(page)
  const account = await signUp(page, request)
  const { headers, leadId } = await approvedLead(request, account.token, account.companyId!)

  // 绑定发信邮箱（假 SMTP；*.example 视为公网地址）
  await page.goto('/me/mail-accounts')
  await expect(page.getByText('还没有绑定发信邮箱')).toBeVisible()
  await expect(page).toHaveScreenshot('mail-empty.png')
  await page.getByRole('button', { name: '绑定邮箱' }).click()
  await page.getByLabel('发件邮箱').fill('sales@demo-valve.example')
  await page.getByLabel('SMTP 服务器').fill('smtp.demo-valve.example')
  await page.getByLabel('登录账号').fill('sales@demo-valve.example')
  await page.getByLabel('密码 / 授权码').fill('app-password-123')
  await expect(page).toHaveScreenshot('mail-new.png')
  await page.getByRole('button', { name: '绑定邮箱' }).click()
  await expect(page.getByText('今日已发 0 / 30 封')).toBeVisible()
  await expect(page.getByText('SPF / DMARC 已配置')).toBeVisible()
  expect(await page.locator('body').innerText()).not.toContain('app-password-123')

  // 商机详情：跟进区
  await page.goto(`/leads/${leadId}`)
  await expect(page.getByText('跟进阶段')).toBeVisible()
  await expect(page.getByText('新商机 → 已查看')).toBeVisible()
  await expectNoFallback(page)
  await page.locator('.follow-up').scrollIntoViewIfNeeded()
  await expect(page.locator('.follow-up')).toHaveScreenshot('lead-follow-up.png', { mask: [page.getByText(/\d{2}-\d{2} \d{2}:\d{2}/)] })

  // 开发信：自动生成 → 确认发送
  await page.getByRole('button', { name: '写开发信' }).click()
  await expect(page.getByLabel('主题')).toHaveValue(/^Re: /, { timeout: 15_000 })
  await expect(page.getByLabel('收件人')).toHaveValue(/@utility-.*\.example$/)
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('draft.png')
  await page.getByRole('button', { name: '确认发送' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('sales@demo-valve.example')
  await expect(page).toHaveScreenshot('draft-confirm.png')
  await dialog.getByRole('button', { name: '确认发送' }).click()
  await expect(page).toHaveURL(new RegExp(`/leads/${leadId}$`))
  await expect(page.getByText('已发送，今日还可发送 29 封')).toBeVisible()
  await expect(page.getByText(/^已发送开发信：Re: /)).toBeVisible()
  await expect(page.locator('.follow-up[data-stage="contacted"]')).toBeVisible()

  // 记录回复 → 自动「已回复」；推进到「已询价」
  await page.getByText('添加记录').click()
  await page.getByRole('button', { name: '对方回复' }).click()
  await page.getByRole('dialog').getByLabel('内容').fill('Please send your catalogue and price list.')
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click()
  await expect(page.locator('.follow-up[data-stage="replied"]')).toBeVisible()
  await page.getByRole('button', { name: '推进' }).click()
  await page.getByRole('button', { name: '已询价' }).click()
  await expect(page.getByText('已更新为「已询价」')).toBeVisible()

  // 下一步（设置为已过去的时间 → 待跟进中显示逾期）
  await request.put(`/api/v1/leads/${leadId}/next-action`, { headers, data: { next_action: '发送报价单', next_action_at: '2026-01-01T09:00:00Z' } })
  await page.goto('/leads')
  await page.getByRole('tab', { name: '跟进' }).click()
  await expect(page.locator(`[data-lead-id="${leadId}"][data-overdue]`)).toBeVisible()
  await expect(page.getByText('已询价 · 发送报价单')).toBeVisible()
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('due-list.png', { mask: [page.getByText(/已逾期 · /)] })

  // 周报（本周至今）
  await page.goto('/me/reports')
  await expect(page.getByText('还没有周报')).toBeVisible()
  await page.getByText('本周至今').click()
  await expect(page.getByText(/^效果周报（/)).toBeVisible()
  await expect(page.getByText('新增商机')).toBeVisible()
  await expect(page.getByText('下周建议重点')).toBeVisible()
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('report.png', { mask: [page.getByText(/^效果周报（/)] })

  expect(errors).toEqual([])
})

test('未绑定邮箱：复制开发信后标记已发送', async ({ page, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors = watchPageErrors(page)
  const account = await signUp(page, request)
  const { leadId } = await approvedLead(request, account.token, account.companyId!)
  await page.goto(`/leads/${leadId}/draft`)
  await expect(page.getByLabel('主题')).toHaveValue(/^Re: /, { timeout: 15_000 })
  await expect(page.getByRole('button', { name: '确认发送' })).toHaveCount(0)
  await page.getByRole('tab', { name: '简洁' }).click()
  await expect(page.getByText('还没有「简洁」语气的版本')).toBeVisible()
  await expect(page).toHaveScreenshot('draft-tone-empty.png')
  await page.getByRole('button', { name: '生成这个语气' }).click()
  await expect(page.getByLabel('主题')).toHaveValue(/^Re: /, { timeout: 15_000 })
  await page.getByRole('button', { name: '复制', exact: true }).click()
  await expect(page.getByText('已复制，用你的邮箱发出后请点「我已发送」')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Re: [\s\S]*Best regards/)
  await page.getByRole('button', { name: '我已发送' }).click()
  await expect(page.getByText('已记录发送，商机推进到「已联系」')).toBeVisible()
  await expect(page.locator('.follow-up[data-stage="contacted"]')).toBeVisible()
  expect(errors).toEqual([])
})
