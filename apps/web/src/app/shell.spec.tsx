import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAIN_NAV } from '@/layout/AppLayout'
import { demoOverview, demoProfile, DEMO_USER, installFakeServer, OPERATOR_USER, signedIn, type FakeServer } from '@/test/fakeServer'
import { renderRoutes } from '@/test/render'

let server: FakeServer

// 客户页面上不应该出现的词（老板看不懂的说法）
const JARGON = /档案|完整度|监控|商机|助手|模板|发布|版本|SMTP/

beforeEach(() => {
  server = installFakeServer()
  server
    .on('GET', '/auth/me', DEMO_USER)
    .on('GET', '/profile', demoProfile())
    .on('GET', '/service/overview', demoOverview())
    .on('GET', '/assets', [])
    .on('GET', '/notifications', [])
    .on('GET', /^\/leads\?/, { items: [], total: 0, new_count: 0, today_count: 0 })
  signedIn()
})

function sidebar() {
  return screen.getAllByRole('navigation', { name: '主导航' })[0]
}

describe('客户工作台布局', () => {
  it('侧边栏只有「首页 / 我的网站 / 海外买家 / 我的资料」，没有手机外壳和设计包品牌字样', async () => {
    renderRoutes('/home')
    await screen.findAllByRole('navigation', { name: '主导航' })
    expect(within(sidebar()).getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['首页', '我的网站', '海外买家', '我的资料'])
    expect(document.body.textContent).not.toMatch(/\u5143\u5b9d/)
    expect(document.querySelector('[class*="yb-"]')).toBeNull()
  })

  it('点击侧边栏切换路由，当前页面高亮；每个页面都没有行话', async () => {
    const { router } = renderRoutes('/home')
    await screen.findByText('找海外买家')
    expect(document.body.textContent).not.toMatch(JARGON)
    for (const item of MAIN_NAV.slice(1)) {
      fireEvent.click(within(sidebar()).getByRole('link', { name: item.label }))
      await waitFor(() => expect(router.state.location.pathname).toBe(item.path))
      expect(within(sidebar()).getByRole('link', { name: item.label }).getAttribute('aria-current')).toBe('page')
      await waitFor(() => expect(document.querySelector('.ui-spinner')).toBeNull())
      expect(document.body.textContent).not.toMatch(JARGON)
    }
  })

  it('客户打开运营工具（助手、网站编辑、找买家设置）会回到首页', async () => {
    const { router } = renderRoutes('/assistant')
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
    await act(() => router.navigate('/site'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
    await act(() => router.navigate('/me/watches'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
  })

  it('运营代操作时额外显示「代操作工具」和运营菜单', async () => {
    server.on('GET', '/auth/me', OPERATOR_USER).on('GET', '/assistant/conversations', [])
    renderRoutes('/home')
    const nav = await screen.findByRole('navigation', { name: '主导航' })
    expect(await within(nav).findByRole('link', { name: 'AI 助手' })).toBeTruthy()
    expect(within(nav).getByText('代操作工具')).toBeTruthy()
    expect(within(nav).getByRole('link', { name: '待办任务' })).toBeTruthy()
  })

  it('手机宽度：顶栏菜单按钮打开抽屉导航，选择后关闭', async () => {
    const { router } = renderRoutes('/home')
    await screen.findAllByRole('navigation', { name: '主导航' })
    fireEvent.click(screen.getByRole('button', { name: '菜单' }))
    const drawer = await screen.findByRole('dialog', { name: '菜单' })
    fireEvent.click(within(drawer).getByRole('link', { name: '海外买家' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/buyers'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '菜单' })).toBeNull())
  })

  it('深浅色切换写入 <html data-theme> 并记住选择', async () => {
    renderRoutes('/home')
    await screen.findAllByRole('navigation', { name: '主导航' })
    const before = document.documentElement.dataset.theme
    fireEvent.click(screen.getAllByRole('button', { name: before === 'dark' ? '浅色模式' : '深色模式' })[0])
    await waitFor(() => expect(document.documentElement.dataset.theme).not.toBe(before))
    expect(window.localStorage.getItem('aicmo.theme')).toBe(document.documentElement.dataset.theme)
  })

  it('请求携带登录 token 与当前企业头', async () => {
    renderRoutes('/home')
    await screen.findByText('找海外买家')
    const call = server.calls.find((c) => c.path === '/service/overview')!
    expect(call.headers.get('Authorization')).toBe('Bearer test-token')
    expect(call.headers.get('X-Company-Id')).toBe('c1')
  })
})

describe('客户首页', () => {
  it('找买家和做网站分两条线显示；下一步卡片的按钮跳到对应页面', async () => {
    server.on(
      'GET',
      '/service/overview',
      demoOverview({
        stage: 'materials',
        missing: ['product_photo'],
        next: { title: '补几张照片，网站会更好看', body: '建议补充：产品照片。', action: '去传照片', link: '/materials' },
      }),
    )
    const { router } = renderRoutes('/home')
    // 找买家：没有网站也已经在找，并说明在找什么
    const buyers = await screen.findByText('找海外买家')
    const card = buyers.closest('[data-buyers-state]') as HTMLElement
    expect(card.getAttribute('data-buyers-state')).toBe('searching')
    expect(within(card).getByText('正在找：不锈钢球阀')).toBeTruthy()
    expect(within(card).getByText('目标市场：Germany')).toBeTruthy()
    // 网站：四个阶段
    const track = screen.getByRole('list', { name: '服务进度' })
    expect(within(track).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1资料已收到', '2网站制作中', '3网站待你确认', '4网站已上线'])
    expect(within(track).getByText('资料已收到').closest('li')?.getAttribute('aria-current')).toBe('step')
    fireEvent.click(screen.getByRole('button', { name: '去传照片' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/materials'))
  })

  it('只需等待时说明「不用做什么」', async () => {
    server.on('GET', '/service/overview', demoOverview({ stage: 'building', next: { title: '你的英文网站正在制作', body: '大约 2 小时做好', action: '', link: '' } }))
    renderRoutes('/home')
    expect(await screen.findByText('你现在不用做什么，等我们的通知就行。')).toBeTruthy()
  })

  it('还没走完开通向导时直接进入向导', async () => {
    server.on('GET', '/service/overview', demoOverview({ stage: 'start', submitted: false }))
    const { router } = renderRoutes('/home')
    await waitFor(() => expect(router.state.location.pathname).toBe('/start'))
  })
})

describe('公开首页', () => {
  it('未登录访问首页展示营销内容与注册 / 登录入口；已登录访问首页进入工作台首页', async () => {
    window.localStorage.clear()
    const first = renderRoutes('/')
    expect(await screen.findByRole('heading', { level: 1, name: '帮工厂找到海外买家' })).toBeTruthy()
    expect(screen.getByText('一个英文官网')).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: '主导航' })).toBeNull()
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: '登录' }))
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/login'))
    first.unmount()

    signedIn()
    const { router } = renderRoutes('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
  })
})

describe('路由守卫', () => {
  it('未登录访问应用页跳转到登录页，并记住来源', async () => {
    window.localStorage.clear()
    const { router } = renderRoutes('/materials')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect((router.state.location.state as { from: string }).from).toBe('/materials')
  })

  it('没有企业时进入开通向导', async () => {
    server.on('GET', '/auth/me', { ...DEMO_USER, companies: [] })
    const { router } = renderRoutes('/home')
    await waitFor(() => expect(router.state.location.pathname).toBe('/start'))
    expect(await screen.findByText('第 1 步，共 3 步')).toBeTruthy()
  })

  it('token 失效（401）时清除登录态并回到登录页', async () => {
    server.on('GET', '/auth/me', { error: { code: 'unauthorized', message: '登录已过期' } }, 401)
    const { router } = renderRoutes('/home')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(window.localStorage.getItem('aicmo.token')).toBeNull()
  })

  it('已登录访问登录页直接进入应用', async () => {
    const { router } = renderRoutes('/login')
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
  })
})

describe('没有企业的运营人员', () => {
  it('侧边栏只显示运营菜单，并提示如何进入客户企业；没有页面内的第二列导航', async () => {
    server.on('GET', '/auth/me', { ...DEMO_USER, is_staff: true, companies: [] }).on('GET', /^\/ops\/customers/, [])
    window.localStorage.removeItem('aicmo.company')
    const { router } = renderRoutes('/ops')
    await waitFor(() => expect(router.state.location.pathname).toBe('/ops/customers'))
    const nav = await screen.findByRole('navigation', { name: '主导航' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent?.trim())).toEqual([
      '客户列表',
      '待办任务',
      '待审核买家',
      '找买家渠道',
      'AI 花费',
      '操作记录',
      '删除请求',
    ])
    expect(within(nav).queryByRole('link', { name: '首页' })).toBeNull()
    expect(screen.getAllByRole('navigation').filter((n) => n.closest('[role="dialog"]') === null)).toHaveLength(1)
    fireEvent.click(within(nav).getByRole('link', { name: '操作记录' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/ops/audit'))
    expect(screen.getAllByRole('link', { name: 'AI-CMO' })[0].getAttribute('href')).toBe('/ops/customers')
  })
})
