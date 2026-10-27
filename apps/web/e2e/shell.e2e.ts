import { expect, test } from '@playwright/test'
import { expectNoFallback, signUp, watchPageErrors } from './helpers'

// 计划 01：应用壳。四个 Tab、画布尺寸、无品牌字样、无渲染降级、Toast。

test('后端经前端代理可达', async ({ request }) => {
  const res = await request.get('/api/v1/meta')
  expect(res.ok()).toBeTruthy()
  expect((await res.json()).name).toBe('AI-CMO')
})

test('四个 Tab 可切换，且没有设计包品牌字样和降级渲染', async ({ page, request }) => {
  const errors = watchPageErrors(page)
  await signUp(page, request)
  await page.goto('/')
  await expect(page).toHaveURL(/\/assistant$/)
  const nav = page.getByRole('navigation', { name: '主导航' })
  await expect(nav.getByRole('button')).toHaveText(['助手', '商机', '官网', '我的'])

  for (const [label, path] of [['商机', '/leads'], ['官网', '/site'], ['我的', '/me'], ['助手', '/assistant']] as const) {
    await nav.getByRole('button', { name: label }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expectNoFallback(page)
  }
  expect(errors).toEqual([])
})

test('桌面端画布居中 402 宽；手机端铺满且无横向溢出', async ({ page }, info) => {
  await page.goto('/login')
  const box = await page.locator('.app-canvas').boundingBox()
  const viewport = page.viewportSize()!
  expect(box).not.toBeNull()
  if (info.project.name === 'desktop') {
    expect(Math.round(box!.width)).toBe(402)
    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(2)
  } else {
    expect(Math.round(box!.width)).toBe(viewport.width)
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})

test('页面截图基线', async ({ page, request }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
  await expect(page).toHaveScreenshot('shell-login.png')
  await signUp(page, request)
  for (const path of ['/assistant', '/leads', '/site', '/me']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot(`shell${path.replace('/', '-')}.png`)
  }
})
