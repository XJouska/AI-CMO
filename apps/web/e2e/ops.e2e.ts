import { expect, test, type Page } from '@playwright/test'
import { completeProfile, expectNoFallback, signUp, staffHeaders, watchPageErrors, signUpAsOperator } from './helpers'

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

test('客户：我的套餐、消息设置；运营：数据与隐私', async ({ page, request, browser, baseURL }) => {
  const errors = watchPageErrors(page)
  const account = await signUp(page, request)
  await request.post('/api/v1/service/business', {
    headers: { Authorization: `Bearer ${account.token}`, 'X-Company-Id': account.companyId! },
    data: { business: '不锈钢球阀', target_markets: '德国' },
  })
  await page.goto('/materials')
  await page.getByRole('main').getByRole('button', { name: /我的套餐/ }).click()
  await expect(page).toHaveURL(/\/account\/billing$/)
  await expect(page.getByText('本月商机')).toBeVisible()
  await expect(page.getByText('获客版', { exact: false }).first()).toBeVisible()
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('billing.png', { mask: [page.getByText(/^有效期至/)] })

  await page.goto('/account/notifications')
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

  // 数据导出与注销由运营代客操作
  const opContext = await browser.newContext({ baseURL, viewport: page.viewportSize()!, locale: 'zh-CN', acceptDownloads: true })
  const op = await opContext.newPage()
  await signUpAsOperator(op, request)
  await op.goto('/me/privacy')
  await expect(op.getByText('导出企业数据（JSON）')).toBeVisible()
  const download = op.waitForEvent('download')
  await op.getByText('导出商机列表（CSV）').click()
  expect((await download).suggestedFilename()).toMatch(/^leads-\d{8}\.csv$/)
  await expect(op).toHaveScreenshot('privacy-settings.png', { mask: [op.getByText(/^请输入企业名/)] })
  await opContext.close()
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
  // 运营入口直接进入客户列表；运营菜单只在侧边栏中出现一次，页面内没有第二列导航
  await expect(fresh).toHaveURL(/\/ops\/customers$/)
  await expect(fresh.locator('.app-page__aside, .subnav')).toHaveCount(0)
  await expectNoFallback(fresh)
  await fresh.getByLabel('搜索企业').fill('运营演示工厂')
  const row = fresh.locator(`[data-company-id="${customer.companyId}"]`)
  await expect(row).toBeVisible()
  await expectNoFallback(fresh)
  await row.click()

  // 五步工作台
  await expect(fresh.getByText('1. 客户资料')).toBeVisible()
  await expect(fresh.getByText('5. 找买家')).toBeVisible()

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
  await expect(fresh).toHaveURL(/\/home$/)
  await fresh.goto('/me/billing')
  await expect(fresh.getByText('获客版').first()).toBeVisible()

  // 复核队列：键盘快捷键通过
  await fresh.goto('/ops/review')
  await expect(fresh.locator('.ops-review')).toBeVisible({ timeout: 20_000 })
  // 复核队列内容与其他用例共享数据（条数、企业名会变化），只比较页面框架
  // 只截取页面框架（顶栏 + 侧边栏）；复核列表与详情的高度取决于共享数据，不纳入比较
  await expect(fresh.locator('.app-topbar')).toHaveScreenshot('ops-review.png')
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

test('代运营全流程：客户提交资料 → 运营生成网站并发给客户 → 客户提修改 → 再确认上线', async ({ page, request, browser, baseURL }) => {
  test.setTimeout(90_000)
  const errors = watchPageErrors(page)
  const companyName = `全流程工厂${Date.now()}`
  const marker = `主做球阀-${Date.now()}`
  const customer = await signUp(page, request, { company: companyName })
  const headers = await completeProfile(request, customer.token, customer.companyId!)
  await request.post('/api/v1/service/business', { headers, data: { business: `不锈钢球阀 ${marker}` } })
  await request.post('/api/v1/service/onboarding', { headers, data: { style_choice: 'heritage' } })

  // 运营：待办里有「整理资料」，进入客户工作台生成网站并发给客户
  const staff = await staffHeaders(request)
  const staffContext = await browser.newContext({ baseURL, viewport: page.viewportSize()!, locale: 'zh-CN' })
  const op = await staffContext.newPage()
  const opErrors = watchPageErrors(op)
  await staffLogin(op, staff.Authorization.replace('Bearer ', ''))
  await op.goto('/ops/tasks')
  const task = op.locator('.task-row', { hasText: marker })
  await expect(task).toBeVisible()
  await expect(task).toContainText('整理资料')
  await expectNoFallback(op)
  await task.getByRole('button', { name: companyName }).click()
  await expect(op).toHaveURL(new RegExp(`/ops/customers/${customer.companyId}$`))
  await op.locator('[data-step="site"]').getByRole('button', { name: '生成网站' }).click()
  await expect(op.locator('[data-step="site"]').getByRole('button', { name: '重新生成' })).toBeVisible({ timeout: 25_000 })
  await op.getByRole('button', { name: '发给客户确认' }).click()
  await expect(op.getByText('已发给客户确认，客户会收到通知')).toBeVisible()

  // 客户：首页提示去看网站 → 我的网站：预览、提修改意见
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: '你的英文网站做好了，请看一看' })).toBeVisible()
  await page.getByRole('button', { name: '去看网站' }).click()
  await expect(page).toHaveURL(/\/my-site$/)
  await expect(page.locator('.site-preview iframe')).toBeVisible()
  await expect(page.locator('main')).not.toContainText(/档案|完整度|监控|商机|助手|模板|发布|版本/)
  await page.getByRole('button', { name: '我要修改' }).click()
  await page.getByLabel('修改意见').fill('首页大图换成车间照片')
  await page.getByRole('button', { name: '提交' }).click()
  await expect(page.getByText('已收到你的修改意见，我们改好后会再请你看')).toBeVisible()
  await expect(page.getByText('我们正在按你的意见修改，改好后会通知你')).toBeVisible()

  // 运营：待办出现「修改网站」，改好后再次发给客户
  await op.goto('/ops/tasks')
  await expect(op.locator('.task-row', { hasText: '首页大图换成车间照片' })).toContainText('修改网站')
  await op.goto(`/ops/customers/${customer.companyId}`)
  await op.getByRole('button', { name: '发给客户确认' }).click()
  await expect(op.getByText('已发给客户确认，客户会收到通知')).toBeVisible()

  // 客户：确认上线 → 网站已上线
  await page.goto('/my-site')
  await page.getByRole('button', { name: '确认上线' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认上线' }).click()
  await expect(page.getByText('已确认，网站正在上线，几分钟后就能打开')).toBeVisible()
  await expect(page.getByRole('heading', { name: '网站已上线' })).toBeVisible({ timeout: 20_000 })
  await page.goto('/home')
  await expect(page.getByRole('list', { name: '服务进度' }).locator('[aria-current="step"]')).toContainText('网站已上线')
  await staffContext.close()
  expect(errors).toEqual([])
  expect(opErrors).toEqual([])
})

test.describe('Dark 主题截图基线', () => {
  test.use({ colorScheme: 'dark' })

  test('关键页面 Dark', async ({ page, request }) => {
    const errors = watchPageErrors(page)
    await page.goto('/login')
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page).toHaveScreenshot('dark-login.png')
    const account = await signUp(page, request)
    await request.post('/api/v1/service/business', {
      headers: { Authorization: `Bearer ${account.token}`, 'X-Company-Id': account.companyId! },
      data: { business: '不锈钢球阀', target_markets: '德国' },
    })
    for (const path of ['/home', '/my-site', '/buyers', '/materials', '/account/billing', '/account/notifications/settings']) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expectNoFallback(page)
      await expect(page).toHaveScreenshot(`dark${path.replaceAll('/', '-')}.png`, { mask: [page.getByText(/^有效期至|^邮件发送到/)] })
    }
    expect(errors).toEqual([])
  })
})
