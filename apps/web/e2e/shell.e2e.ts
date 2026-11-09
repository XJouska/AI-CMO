import { expect, test, type Page } from '@playwright/test'
import { expectNoFallback, signUp, watchPageErrors } from './helpers'

// 网站外壳：营销首页、登录页、工作台侧边栏（桌面）/ 抽屉菜单（手机）、无品牌字样、无横向溢出、截图基线。

/** 主导航：桌面在侧边栏，手机需要先打开抽屉。 */
async function openNav(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByRole('button', { name: '菜单' }).click()
    return page.getByRole('dialog', { name: '菜单' }).getByRole('navigation', { name: '主导航' })
  }
  return page.locator('.app-sidebar').getByRole('navigation', { name: '主导航' })
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  expect(overflow).toBe(false)
}

test('后端经前端代理可达', async ({ request }) => {
  const res = await request.get('/api/v1/meta')
  expect(res.ok()).toBeTruthy()
  expect((await res.json()).name).toBe('AI-CMO')
})

test('主导航四个页面可切换，且没有设计包品牌字样和占位文案', async ({ page, request }, info) => {
  const mobile = info.project.name === 'mobile'
  const errors = watchPageErrors(page)
  await signUp(page, request)
  await page.goto('/')
  await expect(page).toHaveURL(/\/assistant$/)
  if (!mobile) await expect((await openNav(page, false)).getByRole('link')).toHaveText(['助手', '商机', '官网', '我的'])

  for (const [label, path] of [['商机', '/leads'], ['官网', '/site'], ['我的', '/me'], ['助手', '/assistant']] as const) {
    const nav = await openNav(page, mobile)
    await nav.getByRole('link', { name: label }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('dialog', { name: '菜单' })).toHaveCount(0)
    await expectNoFallback(page)
    await expectNoHorizontalOverflow(page)
  }
  expect(errors).toEqual([])
})

test('桌面显示侧边栏；手机隐藏侧边栏、使用抽屉菜单，页面铺满且无横向溢出', async ({ page, request }, info) => {
  await signUp(page, request)
  await page.goto('/me')
  const sidebar = page.locator('.app-sidebar')
  const menu = page.getByRole('button', { name: '菜单' })
  if (info.project.name === 'desktop') {
    await expect(sidebar).toBeVisible()
    await expect(menu).toBeHidden()
    const box = await page.locator('.app-main').boundingBox()
    expect(Math.round(box!.width)).toBeGreaterThan(1000)
  } else {
    await expect(sidebar).toBeHidden()
    await expect(menu).toBeVisible()
  }
  await expectNoHorizontalOverflow(page)
})

test('未登录访问首页：营销内容，可进入注册 / 登录；未知地址回到首页', async ({ page }) => {
  const errors = watchPageErrors(page)
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1, name: '帮工厂找到海外买家' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '举个例子：一家做阀门的工厂' })).toBeVisible()
  await expect(page.locator('.app-sidebar')).toHaveCount(0)
  await expectNoFallback(page)
  await expectNoHorizontalOverflow(page)
  await expect(page).toHaveScreenshot('home.png', { fullPage: true })
  await page.locator('.home-hero').getByRole('button', { name: '免费试用 14 天' }).click()
  await expect(page).toHaveURL(/\/register$/)
  await page.goto('/')
  await page.locator('.home-hero').getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/some-unknown-page')
  await expect(page).toHaveURL(/\/$/)
  expect(errors).toEqual([])
})

test('页面截图基线', async ({ page, request }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  await expect(page).toHaveScreenshot('shell-login.png')
  await signUp(page, request)
  for (const path of ['/assistant', '/leads', '/site', '/me']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot(`shell${path.replace('/', '-')}.png`)
  }
})
