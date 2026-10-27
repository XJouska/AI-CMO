import { expect, test } from '@playwright/test'

// 计划 01：应用壳。四个 Tab、画布尺寸、无品牌字样、无渲染降级、Toast。

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error
  })
})

test('后端健康检查经前端代理可达', async ({ request }) => {
  const res = await request.get('/api/v1/meta')
  expect(res.ok()).toBeTruthy()
  expect((await res.json()).name).toBe('AI-CMO')
})

test('四个 Tab 可切换，且没有设计包品牌字样和降级渲染', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/assistant$/)
  const nav = page.getByRole('navigation', { name: '主导航' })
  await expect(nav.getByRole('button')).toHaveText(['助手', '商机', '官网', '我的'])

  for (const [label, path] of [['商机', '/leads'], ['官网', '/site'], ['我的', '/me'], ['助手', '/assistant']] as const) {
    await nav.getByRole('button', { name: label }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    expect(await page.locator('body').innerText()).not.toMatch(/\u5143\u5b9d/)
    expect(await page.locator('.yb-fallback').count()).toBe(0)
  }
})

test('桌面端画布居中 402 宽；手机端铺满且无横向溢出', async ({ page }, info) => {
  await page.goto('/assistant')
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

test('发送消息弹出 Toast，3 秒后消失', async ({ page }) => {
  await page.goto('/assistant')
  const input = page.locator('.yb-agent-native')
  await input.fill('找德国的阀门买家')
  await input.press('Enter')
  const toast = page.getByText('对话功能即将上线')
  await expect(toast).toBeVisible()
  await expect(input).toHaveValue('')
  await expect(toast).toBeHidden({ timeout: 5000 })
})

test('页面截图基线', async ({ page }) => {
  for (const path of ['/assistant', '/leads', '/site', '/me']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot(`shell${path.replace('/', '-')}.png`, { fullPage: false })
  }
})
