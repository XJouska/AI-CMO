import { expect, test } from '@playwright/test'
import { expectNoFallback, signUp, signUpAsOperator, watchPageErrors } from './helpers'

// 客户：注册 → 三步开通向导（工厂名 / 分类上传资料 / 选网站风格）→ 首页进度。
// 运营：从网址 / 口述自动整理工厂信息 → 确认变更；工厂信息与产品编辑。
// 后端运行在 TEST_MODE：网页抓取与 LLM 使用假实现，worker 真实处理任务表。

function pngFile(name: string) {
  // 8×8 红色 PNG
  const data = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGM8oaHBgA0wYRUdtBIA4DgBKJ8lCQoAAAAASUVORK5CYII=',
    'base64',
  )
  return { name, mimeType: 'image/png', buffer: data }
}

test('注册后填工厂和产品就开始找买家；照片可选，上传有清楚的进度和结果；首页两条线', async ({ page }) => {
  const errors = watchPageErrors(page)
  await page.goto('/register')
  await page.getByLabel('称呼').fill('王总')
  await page.getByLabel('邮箱').fill(`wiz-${Date.now()}@example.com`)
  await page.getByLabel('密码', { exact: true }).fill('Factory123')
  await page.getByRole('button', { name: '注册', exact: true }).click()

  // 第 1 步：工厂名 + 做什么产品 + 想卖到哪里 → 开始找买家
  await expect(page).toHaveURL(/\/start$/)
  await expect(page.getByText('第 1 步，共 3 步')).toBeVisible()
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('start-1-name.png')
  await page.getByRole('button', { name: '开始找买家' }).click()
  await expect(page.getByText('写一下你们做什么产品')).toBeVisible()
  await page.getByLabel('工厂名称').fill('宁波演示阀门厂')
  await page.getByLabel('主要做什么产品？').fill('不锈钢球阀、闸阀')
  await page.getByLabel('想卖到哪些国家？（可不填）').fill('德国、波兰')
  await page.getByRole('button', { name: '开始找买家' }).click()

  // 第 2 步：照片全部可选；上传后显示缩略图和「上传好了」
  await expect(page.getByText('第 2 步，共 3 步')).toBeVisible()
  await expect(page.getByText('找买家已经开始了，不用等这一步。', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '先跳过，以后再传' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/档案|完整度|监控|商机|助手|必需/)
  await expect(page).toHaveScreenshot('start-2-materials.png', { fullPage: true })
  const product = page.locator('.material[data-kind="product_photo"]')
  await product.locator('input[type="file"]:not([capture])').setInputFiles([pngFile('a.png'), pngFile('b.png')])
  await expect(product).toHaveClass(/is-done/, { timeout: 10_000 })
  await expect(product.getByText('上传好了，我们已经收到')).toBeVisible()
  await expect(product.locator('.material__thumb')).toHaveCount(2)
  await expect(product.getByText('已传 2 个')).toBeVisible()
  // 照片类别只收图片：传 PDF 会说明原因
  const factory = page.locator('.material[data-kind="factory_photo"]')
  await factory.locator('input[type="file"]:not([capture])').setInputFiles({ name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
  await expect(factory.getByText('这里只能传照片（JPG / PNG）', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '下一步' }).click()

  // 第 3 步：风格可选
  await expect(page.getByText('第 3 步，共 3 步')).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(7)
  await page.getByRole('radio', { name: /老牌工厂/ }).click()
  await page.getByLabel('已经有网站或阿里巴巴店铺？（可不填）').fill('demo-valve.example')
  await expect(page).toHaveScreenshot('start-3-style.png', { fullPage: true })
  await page.getByRole('button', { name: '完成' }).click()

  // 首页：找买家已经在进行（不等网站），并说明在找什么
  await expect(page).toHaveURL(/\/home$/)
  const buyers = page.locator('[data-buyers-state]')
  await expect(buyers).toHaveAttribute('data-buyers-state', 'searching', { timeout: 20_000 })
  await expect(buyers).toContainText('正在找：')
  await expect(buyers).toContainText('Germany')
  const track = page.getByRole('list', { name: '服务进度' })
  await expect(track.locator('[aria-current="step"]')).toContainText('资料已收到')
  await expect(page.locator('main')).not.toContainText(/档案|完整度|监控|商机|助手/)
  await page.goto('/buyers')
  await expect(page.getByText('我们每天都在国外的招标网站和采购信息里找', { exact: false })).toBeVisible()
  expect(errors).toEqual([])
})

test('注册时校验密码强度', async ({ page }) => {
  await page.goto('/register')
  const register = page.getByRole('button', { name: '注册', exact: true })
  await expect(register).toBeDisabled()
  await page.getByLabel('称呼').fill('王总')
  await page.getByLabel('邮箱').fill(`reg-${Date.now()}@example.com`)
  await page.getByLabel('密码', { exact: true }).fill('abcdefgh')
  await register.click()
  await expect(page.getByText('密码需同时包含字母和数字')).toBeVisible()
  await expect(page).toHaveURL(/\/register$/)
})

test('运营：从网址整理工厂信息：进度 → 确认变更 → 合并后完整度更新', async ({ page, request }) => {
  await signUpAsOperator(page, request)
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

test('运营：口述整理：取消部分条目后只合并勾选项', async ({ page, request }) => {
  const account = await signUpAsOperator(page, request)
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

test('运营：工厂信息分区编辑与产品管理', async ({ page, request }) => {
  await signUpAsOperator(page, request)
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
  const account = await signUp(page, request)
  await request.post('/api/v1/service/business', {
    headers: { Authorization: `Bearer ${account.token}`, 'X-Company-Id': account.companyId! },
    data: { business: '不锈钢球阀', target_markets: '德国' },
  })
  await page.goto('/materials')
  await page.getByRole('main').getByRole('button', { name: '退出登录' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('确定退出登录吗？')
  await expect(page).toHaveScreenshot('logout-dialog.png')
  await dialog.getByRole('button', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/materials')
  await expect(page).toHaveURL(/\/login$/)
})

test('网络错误状态：接口失败时显示错误空态并可重试', async ({ page, request }) => {
  await signUpAsOperator(page, request)
  let fail = true
  await page.route('**/api/v1/profile', (route) => (fail ? route.fulfill({ status: 502, body: '' }) : route.fallback()))
  await page.goto('/me/profile')
  await expect(page.getByText('网络不太顺畅')).toBeVisible()
  await expect(page).toHaveScreenshot('profile-network-error.png')
  fail = false
  await page.getByRole('button', { name: '重新加载' }).click()
  await expect(page.getByText('完整度 0%', { exact: true }).first()).toBeVisible()
})
