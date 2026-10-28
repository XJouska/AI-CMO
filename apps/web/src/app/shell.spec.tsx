import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAIN_NAV } from '@/layout/AppLayout'
import { demoProfile, DEMO_USER, installFakeServer, signedIn, type FakeServer } from '@/test/fakeServer'
import { renderRoutes } from '@/test/render'

let server: FakeServer

beforeEach(() => {
  server = installFakeServer()
  server.on('GET', '/auth/me', DEMO_USER).on('GET', '/profile', demoProfile()).on('GET', '/assistant/conversations', [])
  signedIn()
})

function sidebar() {
  return screen.getAllByRole('navigation', { name: '主导航' })[0]
}

describe('工作台布局', () => {
  it('侧边栏显示「助手 / 商机 / 官网 / 我的」，没有手机外壳和设计包品牌字样', async () => {
    renderRoutes('/assistant')
    await screen.findAllByRole('navigation', { name: '主导航' })
    expect(within(sidebar()).getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['助手', '商机', '官网', '我的'])
    expect(document.body.textContent).not.toMatch(/\u5143\u5b9d/)
    expect(document.querySelector('[class*="yb-"]')).toBeNull()
    expect(document.querySelector('.app-canvas, .page-tabbar')).toBeNull()
  })

  it('点击侧边栏切换路由，当前页面高亮', async () => {
    const { router } = renderRoutes('/assistant')
    await screen.findAllByRole('navigation', { name: '主导航' })
    for (const item of MAIN_NAV.slice(1)) {
      fireEvent.click(within(sidebar()).getByRole('link', { name: item.label }))
      await waitFor(() => expect(router.state.location.pathname).toBe(item.path))
      expect(within(sidebar()).getByRole('link', { name: item.label }).getAttribute('aria-current')).toBe('page')
    }
  })

  it('运营菜单只对运营人员显示', async () => {
    const first = renderRoutes('/assistant')
    await screen.findAllByRole('navigation', { name: '主导航' })
    expect(within(sidebar()).queryByRole('link', { name: '运营工作台' })).toBeNull()
    first.unmount()

    server.on('GET', '/auth/me', { ...DEMO_USER, is_staff: true })
    renderRoutes('/assistant')
    expect(await within(await screen.findByRole('navigation', { name: '主导航' })).findByRole('link', { name: '运营工作台' })).toBeTruthy()
  })

  it('手机宽度：顶栏菜单按钮打开抽屉导航，选择后关闭', async () => {
    const { router } = renderRoutes('/assistant')
    await screen.findAllByRole('navigation', { name: '主导航' })
    fireEvent.click(screen.getByRole('button', { name: '菜单' }))
    const drawer = await screen.findByRole('dialog', { name: '菜单' })
    fireEvent.click(within(drawer).getByRole('link', { name: '商机' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/leads'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '菜单' })).toBeNull())
  })

  it('深浅色切换写入 <html data-theme> 并记住选择', async () => {
    renderRoutes('/assistant')
    await screen.findAllByRole('navigation', { name: '主导航' })
    const before = document.documentElement.dataset.theme
    fireEvent.click(screen.getAllByRole('button', { name: before === 'dark' ? '浅色模式' : '深色模式' })[0])
    await waitFor(() => expect(document.documentElement.dataset.theme).not.toBe(before))
    expect(window.localStorage.getItem('aicmo.theme')).toBe(document.documentElement.dataset.theme)
  })

  it('商机页未开启监控时引导创建；官网页在档案不足时引导完善档案', async () => {
    server
      .on('GET', '/site', null)
      .on('GET', '/watches', [])
      .on('GET', /^\/leads\?/, { items: [], total: 0, new_count: 0, today_count: 0 })
    const { router } = renderRoutes('/leads')
    expect(await screen.findByText('还没有开启商机监控')).toBeTruthy()
    await act(() => router.navigate('/site'))
    fireEvent.click(await screen.findByRole('button', { name: '先完善企业档案' }))
    expect(router.state.location.pathname).toBe('/me/profile')
  })

  it('Toast 3 秒后自动消失（同一时间只显示一条）', async () => {
    server.on('POST', '/assistant/conversations', { error: { code: 'internal_error', message: '' } }, 500)
    renderRoutes('/assistant')
    const input = (await screen.findByRole('textbox', { name: '给助手发消息' })) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '找德国的阀门买家' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('服务暂时不可用，请稍后重试')).toBeTruthy()
    expect(input.value).toBe('')
    const shownAt = Date.now()
    await waitFor(() => expect(screen.queryByText('服务暂时不可用，请稍后重试')).toBeNull(), { timeout: 4500 })
    expect(Date.now() - shownAt).toBeGreaterThanOrEqual(2500)
  })

  it('请求携带登录 token 与当前企业头', async () => {
    renderRoutes('/me')
    await screen.findAllByText('完整度 0%')
    const profileCall = server.calls.find((call) => call.path === '/profile')!
    expect(profileCall.headers.get('Authorization')).toBe('Bearer test-token')
    expect(profileCall.headers.get('X-Company-Id')).toBe('c1')
  })
})

describe('公开首页', () => {
  it('未登录访问首页展示营销内容与注册 / 登录入口；已登录访问首页进入助手', async () => {
    window.localStorage.clear()
    const first = renderRoutes('/')
    expect(await screen.findByRole('heading', { level: 1, name: '外贸工厂的 AI 获客助手' })).toBeTruthy()
    expect(screen.getByText('生成英文品牌官网')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: '常见问题' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: '主导航' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '已有账号？登录' }))
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/login'))
    first.unmount()

    window.localStorage.clear()
    const second = renderRoutes('/')
    fireEvent.click((await screen.findAllByRole('button', { name: '免费试用 14 天' }))[0])
    await waitFor(() => expect(second.router.state.location.pathname).toBe('/register'))
    second.unmount()

    signedIn()
    const { router } = renderRoutes('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/assistant'))
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
