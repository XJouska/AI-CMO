import { expect, test, type Page } from '@playwright/test'
import { completeProfile, expectNoFallback, signUp, staffHeaders, watchPageErrors } from './helpers'

// 计划 07：套餐与用量、通知设置、数据与隐私、公开政策页、运营工作台（代客操作 + 手工开通 + 复核 + 审计），
// 以及 Light / Dark 主题的关键页面截图基线。

async function staffLogin(page: Page, token: string) {
  await page.addInitScript((t) => {
    if (window.top !== window) return
    if (!window.sessionStorage.getItem('e2e-staff')) {
      window.localStorage.setItem('aicmo.token', t)
      window.localStorage.removeItem('aicmo.company')
      window.sessionStorage.setItem('e2e-staff', '1')
    }
  }, token)
}

test('套餐与用量、通知设置、数据与隐私', async ({ page, request }) => {
  const errors = watchPageErrors(page)
  await signUp(page, request)
  await page.goto('/me')
  await expect(page.getByText('试用版')).toBeVisible()
  await page.getByRole('main').getByRole('button', { name: /套餐与用量/ }).click()
  await expect(page).toHaveURL(/\/me\/billing$/)
  await expect(page.getByText('本月商机')).toBeVisible()
  await expect(page.getByText('获客版', { exact: false }).first()).toBeVisible()
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('billing.png', { mask: [page.getByText(/^有效期至/)] })

  await page.goto('/me/notifications')
  await expect(page.getByText('暂无通知')).toBeVisible()
  await page.getByRole('button', { name: '通知设置' }).click()
  const toggle = page.locator('[data-channel="email"] [data-group="report"] [role="switch"]')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await page.reload()
  await expect(page.locator('[data-channel="email"] [data-group="report"] [role="switch"]')).toHaveAttribute('aria-checked', 'false')
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('notification-settings.png', { mask: [page.getByText(/^邮件发送到/)] })

  await page.goto('/me/privacy')
  await expect(page.getByText('导出企业数据（JSON）')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByText('导出商机列表（CSV）').click()
  expect((await download).suggestedFilename()).toMatch(/^leads-\d{8}\.csv$/)
  await expect(page).toHaveScreenshot('privacy-settings.png', { mask: [page.getByText(/^请输入企业名/)] })
  expect(errors).toEqual([])
})

test('公开页面：隐私政策与联系人删除请求（无需登录）', async ({ page }) => {
  const errors = watchPageErrors(page)
  await page.goto('/privacy')
  await expect(page.getByText('我们收集的信息')).toBeVisible()
  await expect(page).toHaveScreenshot('privacy-policy.png')
  await page.getByRole('main').getByRole('link', { name: '删除我的联系方式' }).click()
  await expect(page).toHaveURL(/\/data-request$/)
  await page.getByLabel('你的邮箱').fill(`jane-${Date.now()}@buyer.example`)
  await page.getByRole('button', { name: '提交请求' }).click()
  await expect(page.getByText('已收到你的请求，处理完成后不会再有平台用户联系你').first()).toBeVisible()
  await page.goto('/terms')
  await expect(page.getByText('用户协议').first()).toBeVisible()
  expect(errors).toEqual([])
})

test('运营工作台：代客操作、手工开通、复核、审计', async ({ page, request, browser, baseURL }) => {
  const errors = watchPageErrors(page)
  // 客户企业：有一条待复核商机
  const customer = await signUp(page, request, { company: `运营演示工厂${Date.now()}` })
  const headers = await completeProfile(request, customer.token, customer.companyId!)
  const watch = await (await request.post('/api/v1/watches/from-profile', { headers })).json()
  await request.patch(`/api/v1/watches/${watch.id}`, { headers, data: { is_active: true } })
  await request.post(`/api/v1/watches/${watch.id}/run`, { headers })

  const staff = await staffHeaders(request)
  // 运营人员使用独立的浏览器上下文（与客户的登录态隔离）
  const staffContext = await browser.newContext({ baseURL, viewport: page.viewportSize()!, locale: 'zh-CN' })
  const fresh = await staffContext.newPage()
  const staffErrors = watchPageErrors(fresh)
  await staffLogin(fresh, staff.Authorization.replace('Bearer ', ''))
  // 预置运营账号在不同用例间共享（可能已以运营身份加入过其他企业），直接进入运营工作台
  await fresh.goto('/ops')
  await expect(fresh.getByRole('button', { name: '客户列表' })).toBeVisible()
  await expectNoFallback(fresh)
  await expect(fresh).toHaveScreenshot('ops-home.png', { mask: [fresh.locator('.sidebar__company, .sidebar__user')] })
  await fresh.getByRole('button', { name: '客户列表' }).click()
  await fresh.getByLabel('搜索企业').fill('运营演示工厂')
  const row = fresh.locator(`[data-company-id="${customer.companyId}"]`)
  await expect(row).toBeVisible()
  await expectNoFallback(fresh)
  await row.click()

  // 手工开通获客版
  await fresh.getByLabel('到账金额（元，可选）').fill('1999')
  await fresh.getByLabel('备注（如转账流水号）').fill('对公转账 E2E')
  await fresh.getByRole('button', { name: '手工开通套餐' }).click()
  await expect(fresh.getByText('已开通')).toBeVisible()
  await expect(fresh.getByText('subscription.activate')).toBeVisible()

  // 代客操作：进入企业 → 切换 → 以运营身份操作
  await fresh.getByRole('button', { name: '进入企业代操作' }).click()
  await expect(fresh.getByText('已以运营身份进入，所有操作会记录为「运营代操作」')).toBeVisible()
  await fresh.getByRole('button', { name: '切换到该企业' }).click()
  await expect(fresh).toHaveURL(/\/assistant$/)
  await fresh.goto('/me/billing')
  await expect(fresh.getByText('获客版').first()).toBeVisible()

  // 复核队列：键盘快捷键通过
  await fresh.goto('/ops/review')
  await expect(fresh.locator('.ops-review')).toBeVisible({ timeout: 20_000 })
  // 复核队列内容与其他用例共享数据（条数、企业名会变化），只比较页面框架
  await expect(fresh).toHaveScreenshot('ops-review.png', { mask: [fresh.locator('.ops-review, .review-board__list, .sidebar__company, .sidebar__user')] })
  await fresh.keyboard.press('a')
  await expect(fresh.getByText('已通过')).toBeVisible()

  // 审计日志：代客操作与复核都有记录
  await fresh.goto('/ops/audit')
  await expect(fresh.getByText('operator.join').first()).toBeVisible()
  await expect(fresh.getByText('lead.review.approved').first()).toBeVisible()
  await expect(fresh.getByText(/运营代操作/).first()).toBeVisible()
  await staffContext.close()
  expect(errors).toEqual([])
  expect(staffErrors).toEqual([])
})

test.describe('Dark 主题截图基线', () => {
  test.use({ colorScheme: 'dark' })

  test('关键页面 Dark', async ({ page, request }) => {
    const errors = watchPageErrors(page)
    await page.goto('/login')
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page).toHaveScreenshot('dark-login.png')
    await signUp(page, request)
    for (const path of ['/assistant', '/leads', '/site', '/me', '/me/billing', '/me/notifications/settings']) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expectNoFallback(page)
      await expect(page).toHaveScreenshot(`dark${path.replaceAll('/', '-')}.png`, { mask: [page.getByText(/^有效期至|^邮件发送到/)] })
    }
    expect(errors).toEqual([])
  })
})
