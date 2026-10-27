import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TABS } from '@/components/local/TabPage'
import { demoProfile, DEMO_USER, installFakeServer, signedIn, type FakeServer } from '@/test/fakeServer'
import { renderRoutes } from '@/test/render'

let server: FakeServer

beforeEach(() => {
  server = installFakeServer()
  server.on('GET', '/auth/me', DEMO_USER).on('GET', '/profile', demoProfile())
  signedIn()
})

describe('应用壳与 Tab', () => {
  it('底部 TabBar 显示「助手 / 商机 / 官网 / 我的」，无设计包品牌字样', async () => {
    renderRoutes('/assistant')
    const nav = await screen.findByRole('navigation', { name: '主导航' })
    expect(within(nav).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['助手', '商机', '官网', '我的'])
    expect(document.body.textContent).not.toMatch(/\u5143\u5b9d/)
  })

  it('点击 Tab 切换路由', async () => {
    const { router } = renderRoutes('/assistant')
    await screen.findByRole('navigation', { name: '主导航' })
    for (const tab of TABS.slice(1)) {
      fireEvent.click(screen.getByRole('button', { name: tab.label }))
      await waitFor(() => expect(router.state.location.pathname).toBe(tab.path))
    }
  })

  it('商机页为空态，官网页空态按钮跳转到助手', async () => {
    const { router } = renderRoutes('/leads')
    expect(await screen.findByText('暂无商机')).toBeTruthy()
    await act(() => router.navigate('/site'))
    fireEvent.click(screen.getByRole('button', { name: '去和助手聊聊' }))
    expect(router.state.location.pathname).toBe('/assistant')
  })

  it('助手页发送后清空输入并弹出 Toast，3 秒后消失', async () => {
    renderRoutes('/assistant')
    await screen.findByRole('navigation', { name: '主导航' })
    vi.useFakeTimers()
    try {
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('.yb-agent-native')!
      fireEvent.change(input, { target: { value: '找德国的阀门买家' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(screen.getByText('对话功能即将上线')).toBeTruthy()
      expect(input.value).toBe('')
      act(() => {
        vi.advanceTimersByTime(3100)
      })
      expect(screen.queryByText('对话功能即将上线')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('请求携带登录 token 与当前企业头', async () => {
    renderRoutes('/me')
    await screen.findByText('完整度 0%')
    const profileCall = server.calls.find((call) => call.path === '/profile')!
    expect(profileCall.headers.get('Authorization')).toBe('Bearer test-token')
    expect(profileCall.headers.get('X-Company-Id')).toBe('c1')
  })
})

describe('路由守卫', () => {
  it('未登录访问应用页跳转到登录页，并记住来源', async () => {
    window.localStorage.clear()
    const { router } = renderRoutes('/me/products')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect((router.state.location.state as { from: string }).from).toBe('/me/products')
  })

  it('没有企业时进入创建企业页', async () => {
    server.on('GET', '/auth/me', { ...DEMO_USER, companies: [] })
    const { router } = renderRoutes('/assistant')
    await waitFor(() => expect(router.state.location.pathname).toBe('/onboarding/company'))
  })

  it('token 失效（401）时清除登录态并回到登录页', async () => {
    server.on('GET', '/auth/me', { error: { code: 'unauthorized', message: '登录已过期' } }, 401)
    const { router } = renderRoutes('/me')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(window.localStorage.getItem('aicmo.token')).toBeNull()
  })

  it('已登录访问登录页直接进入应用', async () => {
    const { router } = renderRoutes('/login')
    await waitFor(() => expect(router.state.location.pathname).toBe('/assistant'))
  })
})
