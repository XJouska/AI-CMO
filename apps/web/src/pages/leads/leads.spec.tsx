import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { leadsQuery, type LeadOut, type WatchOut } from '@/leads/api'
import { demoProfile, installFakeServer, signedIn, type FakeServer, OPERATOR_USER } from '@/test/fakeServer'
import { renderRoutes } from '@/test/render'
import { safeExternal } from './LeadPages'

let server: FakeServer

function lead(overrides: Partial<LeadOut> = {}): LeadOut {
  return {
    id: 'l1',
    type: 'tender',
    title: 'Tender: ball valves for water utility',
    summary_cn: '市政水务项目招标',
    reasons: ['需求产品与主营产品一致'],
    suggested_action: '准备资质文件',
    products_matched: ['Ball Valve'],
    market: 'Germany',
    score: 86,
    score_detail: [{ key: 'product_match', label: '产品匹配度', weight: 0.35, score: 85 }],
    confidence: 'high',
    deadline: '2026-12-15',
    source_url: 'https://tenders.example/x',
    source_domain: 'tenders.example',
    status: 'new',
    review_status: 'approved',
    is_new: true,
    created_at: '2026-10-27T08:00:00',
    buyer: { name: 'Stadtwerke', domain: 'stadtwerke.example', country: 'Germany', industry: '', size_hint: '', public_contacts: { emails: ['buy@stadtwerke.example'] } },
    signal_count: 2,
    ...overrides,
  }
}

const activeWatch: WatchOut = {
  id: 'w1',
  name: '主营产品监控',
  product_ids: [],
  markets: ['Germany'],
  keywords_en: ['ball valve'],
  negative_keywords: [],
  source_keys: [],
  frequency: 'daily',
  is_active: true,
  status: 'active',
  last_run_at: '2026-10-27T08:00:00',
  next_run_at: null,
  last_run: { id: 'r1', status: 'done', trigger: 'manual', stats: { new_signals: 4, leads: 2 }, error: '', created_at: '', finished_at: null },
}

beforeEach(() => {
  server = installFakeServer()
  server.on('GET', '/auth/me', OPERATOR_USER).on('GET', '/profile', demoProfile())
  signedIn()
})

describe('「商机」Tab', () => {
  it('未设置监控：一键根据档案创建并运行', async () => {
    server
      .on('GET', /^\/leads\?/, { items: [], total: 0, new_count: 0, today_count: 0 })
      .on('GET', '/watches', [])
      .on('POST', '/watches/from-profile', { ...activeWatch, is_active: false, status: 'draft' })
      .on('PATCH', '/watches/w1', activeWatch)
      .on('POST', '/watches/w1/run', activeWatch.last_run)
    const { router } = renderRoutes('/leads')
    fireEvent.click(await screen.findByRole('button', { name: '一键根据档案创建监控' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/watches'))
    expect(server.calls.find((c) => c.method === 'PATCH')!.body).toEqual({ is_active: true })
    expect(server.calls.some((c) => c.path === '/watches/w1/run')).toBe(true)
  })

  it('监控中但暂无商机：说明预计时间', async () => {
    server.on('GET', /^\/leads\?/, { items: [], total: 0, new_count: 0, today_count: 0 }).on('GET', '/watches', [activeWatch])
    renderRoutes('/leads')
    expect(await screen.findByText('正在为你寻找商机')).toBeTruthy()
  })

  it('列表：卡片、概览、侧边栏未读数、分类标签、分页、进入详情', async () => {
    const page1 = { items: [lead(), lead({ id: 'l2', type: 'rfq', title: 'RFQ: valves', is_new: false })], total: 3, new_count: 1, today_count: 2 }
    server
      .on('GET', '/watches', [activeWatch])
      .on('GET', /^\/leads\?offset=0/, page1)
      .on('GET', /^\/leads\?offset=2/, { ...page1, items: [lead({ id: 'l3', title: 'Third lead' })] })
      .on('GET', /^\/leads\?type=tender/, { ...page1, items: [lead()], total: 1 })
      .on('GET', '/leads/l1', lead())
    const { router } = renderRoutes('/leads')
    expect(await screen.findByText('Tender: ball valves for water utility')).toBeTruthy()
    expect(screen.getByText('今日新增 2 条 · 共 3 条')).toBeTruthy()
    expect(within(document.querySelector('[data-lead-id="l1"]') as HTMLElement).getByText('86 分')).toBeTruthy()
    const nav = screen.getByRole('navigation', { name: '主导航' })
    await waitFor(() => expect(within(nav).getByRole('link', { name: /商机/ }).textContent).toContain('1'))

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    expect(await screen.findByText('Third lead')).toBeTruthy()
    expect(screen.getByText('没有更多了')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '招标' }))
    await waitFor(() => expect(server.calls.some((c) => c.path.startsWith('/leads?type=tender'))).toBe(true))

    fireEvent.click(await screen.findByRole('link', { name: 'Tender: ball valves for water utility' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/leads/l1'))
  })

  it('筛选：市场与最低分数', async () => {
    server.on('GET', '/watches', [activeWatch]).on('GET', /^\/leads\?/, { items: [lead()], total: 1, new_count: 0, today_count: 0 })
    renderRoutes('/leads')
    await screen.findByText('Tender: ball valves for water utility')
    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    fireEvent.change(await screen.findByLabelText('市场（英文，如 Germany）'), { target: { value: ' Poland ' } })
    fireEvent.change(screen.getByLabelText('最低分数'), { target: { value: '7a0' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '应用' }))
    await waitFor(() => expect(server.calls.some((c) => c.path === leadsQuery({ market: 'Poland', min_score: 70 }, 0))).toBe(true))
  })

  it('加载失败显示网络错误', async () => {
    server.on('GET', '/watches', [activeWatch]).on('GET', /^\/leads\?/, { error: { code: 'internal_error', message: '' } }, 500)
    renderRoutes('/leads')
    expect(await screen.findByText('网络不太顺畅')).toBeTruthy()
  })
})

describe('商机详情', () => {
  it('理由、买家、评分明细；外链需确认；反馈', async () => {
    server.on('GET', '/leads/l1', lead()).on('POST', '/leads/l1/feedback', null, 204)
    renderRoutes('/leads/l1')
    expect(await screen.findByText('需求产品与主营产品一致')).toBeTruthy()
    expect(screen.getByText('buy@stadtwerke.example')).toBeTruthy()
    expect(screen.getByText('产品匹配度（35%）')).toBeTruthy()
    fireEvent.click(screen.getByText('查看原文（tenders.example）'))
    expect((await screen.findByRole('dialog')).textContent).toContain('https://tenders.example/x')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    fireEvent.click(screen.getByRole('button', { name: '反馈' }))
    fireEvent.click(await screen.findByRole('button', { name: '不相关' }))
    expect(await screen.findByText('感谢反馈，我们会据此优化推荐')).toBeTruthy()
    expect(server.calls.find((c) => c.method === 'POST')!.body).toEqual({ verdict: 'irrelevant' })
  })

  it('危险链接不显示外链入口', async () => {
    server.on('GET', '/leads/l1', lead({ source_url: 'javascript:alert(1)' }))
    renderRoutes('/leads/l1')
    await screen.findByText('需求摘要')
    expect(screen.queryByText(/查看原文/)).toBeNull()
    expect(safeExternal('data:text/html,x')).toBeNull()
    expect(safeExternal('https://a.example/x')).toBe('https://a.example/x')
  })
})

describe('监控设置', () => {
  it('保存关键词与市场，立即运行', async () => {
    server
      .on('GET', '/watches', [activeWatch])
      .on('PATCH', '/watches/w1', activeWatch)
      .on('POST', '/watches/w1/run', activeWatch.last_run)
    renderRoutes('/me/watches')
    expect(await screen.findByText('抓取 4 条，新商机 2 条（待复核）')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('关键词（英文，逗号分隔）'), { target: { value: 'ball valve, gate valve' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(server.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ keywords_en: ['ball valve', 'gate valve'], markets: ['Germany'], negative_keywords: [] }))
    fireEvent.click(screen.getByRole('button', { name: '立即运行' }))
    expect(await screen.findByText('已开始运行，新商机复核后会推送给你')).toBeTruthy()
  })
})
