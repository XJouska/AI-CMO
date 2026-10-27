import { expect, test } from '@playwright/test'
import { expectNoFallback, signUp, watchPageErrors } from './helpers'

// 计划 03：AI 获客助手。后端 TEST_MODE 使用规则化的假助手（关键词选择工具），走真实的 SSE、工具、确认链路。

test('对话中提供网址 → 档案变更卡片 → 确认后档案更新', async ({ page, request }) => {
  const errors = watchPageErrors(page)
  const account = await signUp(page, request)
  await page.goto('/assistant')
  await expect(page.getByText(/你好，我是/)).toBeVisible()
  await expect(page).toHaveScreenshot('assistant-welcome.png')

  const input = page.locator('.yb-agent-native')
  await input.fill('我们是做不锈钢阀门的，官网是 demo-valve.example')
  await input.press('Enter')
  await expect(page).toHaveURL(/\/assistant\?c=/)
  await expect(page.getByText('档案待确认变更')).toBeVisible()
  // worker 在后台整理网站内容，卡片轮询状态
  await expect(page.getByText(/整理出 \d+ 项变更，点击确认/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: '复制' })).toBeVisible()
  await expectNoFallback(page)
  await expect(page).toHaveScreenshot('assistant-diff-card.png', { mask: [page.locator('.yb-md-prompt-stack')] })

  await page.getByText('档案待确认变更').click()
  await expect(page).toHaveURL(/\/extractions\/[\w-]+\/review$/)
  await page.getByRole('button', { name: /确认合并/ }).click()
  await expect(page).toHaveURL(/\/me\/profile$/)

  const profile = await (
    await request.get('/api/v1/profile', { headers: { Authorization: `Bearer ${account.token}`, 'X-Company-Id': account.companyId! } })
  ).json()
  expect(profile.founded_year).toBe(2008)
  expect(profile.field_sources.founded_year.source).toBe('url')
  expect(errors).toEqual([])
})

test('结构化回答、追问、刷新后从历史恢复', async ({ page, request }) => {
  await signUp(page, request)
  await page.goto('/assistant')
  await page.getByRole('button', { name: /帮我补充企业档案/ }).click()
  await expect(page.getByRole('heading', { name: '档案情况' })).toBeVisible()
  await expect(page.locator('strong', { hasText: '0%' })).toBeVisible()
  await expect(page).toHaveScreenshot('assistant-completed.png', { mask: [page.locator('.yb-md-prompt-stack')] })

  await page.reload()
  await expect(page.getByRole('heading', { name: '档案情况' })).toBeVisible()
  await page.getByRole('button', { name: '打开侧边栏菜单' }).click()
  await expect(page.getByRole('dialog')).toContainText('帮我补充企业档案')
  await expect(page.getByRole('dialog').getByRole('button', { name: '新对话' })).toBeVisible()
  await expect(page).toHaveScreenshot('assistant-history.png')
})

test('生成中可停止；停止后可重试', async ({ page, request }) => {
  await signUp(page, request)
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  // 拦截第一次发送：只推送开始事件后保持连接，模拟生成中
  await page.route('**/api/v1/assistant/conversations/*/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await gate
    await route.abort()
  }, { times: 1 })
  await page.goto('/assistant')
  const input = page.locator('.yb-agent-native')
  await input.fill('你好')
  await input.press('Enter')
  await expect(page.getByText('思考中')).toBeVisible()
  await expect(page.getByRole('button', { name: '停止' })).toBeVisible()
  await expect(page).toHaveScreenshot('assistant-thinking.png', { mask: [page.locator('.yb-md-progress')] })
  await page.getByRole('button', { name: '停止' }).click()
  release()
  await expect(page.getByText('已停止生成')).toBeVisible()
  await page.getByRole('button', { name: '重试' }).click()
  await expect(page.getByText(/我可以帮你整理企业档案/)).toBeVisible()
})

test('弱网：5 秒无数据显示轻提示，保持输出中', async ({ page, request }) => {
  await signUp(page, request)
  await page.route('**/api/v1/assistant/conversations/*/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await new Promise((resolve) => setTimeout(resolve, 8000))
    await route.abort()
  })
  await page.goto('/assistant')
  const input = page.locator('.yb-agent-native')
  await input.fill('你好')
  await input.press('Enter')
  await expect(page.getByText('网络有点慢，正在继续生成')).toBeVisible({ timeout: 7000 })
  await expect(page.getByText('思考中')).toBeVisible()
})
