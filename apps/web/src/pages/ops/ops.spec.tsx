import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CustomerOut, PrefsOut, ReviewItem, UsageOut } from '@/ops/api'
import { usageText } from '@/ops/api'
import { demoProfile, DEMO_USER, installFakeServer, signedIn, type FakeServer } from '@/test/fakeServer'
import { renderRoutes } from '@/test/render'

let server: FakeServer

const USAGE: UsageOut = {
  plan: { key: 'growth', name: '获客版', description: '建站版 + 每日商机监控 + 开发信' },
  features: ['site', 'leads', 'outreach'],
  status: 'active',
  source: 'manual',
  starts_at: '2026-10-01T00:00:00Z',
  ends_at: '2026-11-01T00:00:00Z',
  usage: [
    { kind: 'leads', label: '本月商机', used: 300, limit: 300 },
    { kind: 'llm_tokens', label: '本月 AI 用量', used: 1200, limit: 3_000_000 },
    { kind: 'emails_sent', label: '本月发信数', used: 0, limit: 0 },
  ],
}

const PREFS: PrefsOut = {
  groups: [
    { key: 'leads', label: '新商机', email: true, wecom: true },
    { key: 'report', label: '效果周报', email: true, wecom: false },
  ],
  wecom_configured: false,
  email: 'wang@example.com',
}

const STAFF = { ...DEMO_USER, is_staff: true }

function customer(overrides: Partial<CustomerOut> = {}): CustomerOut {
  return {
    id: 'c2',
    name_cn: '温州泵业',
    name_en: '',
    plan: '试用版',
    plan_status: 'active',
    ends_at: null,
    completeness: 72,
    site_status: 'published',
    leads_week: 5,
    pending_review: 2,
    valid_rate: 0.6,
    last_active_at: '2026-10-27T08:00:00Z',
    operator_joined: false,
    ...overrides,
  }
}

beforeEach(() => {
  server = installFakeServer()
  server.on('GET', '/profile', demoProfile())
  signedIn()
})

describe('套餐与用量', () => {
  it('显示套餐、本月用量（到上限标红点）、可选套餐与联系入口', async () => {
    server
      .on('GET', '/auth/me', DEMO_USER)
      .on('GET', '/billing/usage', USAGE)
      .on('GET', '/billing/plans', [{ key: 'growth', name: '获客版', description: 'x', features: [], limits: {}, price_cents: 199900, setup_fee_cents: 0, period: 'month' }])
      .on('GET', '/billing/invoices', [{ id: 'i1', number: 'INV202610280001', amount_cents: 199900, status: 'paid', method: 'bank_transfer', period_start: '2026-10-28', period_end: '2026-11-28', paid_at: null, created_at: '' }])
    renderRoutes('/me/billing')
    expect((await screen.findAllByText('获客版')).length).toBeGreaterThan(0)
    expect(screen.getByText('有效期至 2026-11-01')).toBeTruthy()
    expect(screen.getByText('300 / 300')).toBeTruthy()
    expect(document.querySelector('[data-kind="leads"][data-full]')).toBeTruthy()
    expect(screen.getByText('不含')).toBeTruthy()
    expect(screen.getByText('¥1,999 / 月')).toBeTruthy()
    expect(screen.getByText('¥1,999 · 已付款')).toBeTruthy()
    expect(screen.getByText(/续费 \/ 升级请联系客户经理/)).toBeTruthy()
  })

  it('用量文案', () => {
    expect(usageText({ kind: 'x', label: '', used: 5, limit: -1 })).toBe('5 / 不限')
    expect(usageText({ kind: 'x', label: '', used: 1500, limit: 3000 })).toBe('1,500 / 3,000')
  })

  it('套餐限额错误附带升级提示', async () => {
    const { quotaHint } = await import('@/feedback/useErrorToast')
    const { ApiError } = await import('@/api/client')
    expect(quotaHint(new ApiError(402, 'quota_exceeded', 'x'))).toContain('套餐与用量')
    expect(quotaHint(new ApiError(400, 'x', 'x'))).toBe('')
  })
})

describe('通知', () => {
  it('通知列表：未读红点，点击标记已读并跳转站内链接', async () => {
    server
      .on('GET', '/auth/me', DEMO_USER)
      .on('GET', '/notifications', [
        { id: 'n1', kind: 'new_inquiry', title: '新询盘：Buyer GmbH', body: 'Please quote', link: '/site/inquiries/x', read: false, created_at: '2026-10-28T01:00:00Z' },
        { id: 'n2', kind: 'system', title: '外链', body: '', link: 'https://evil.example', read: true, created_at: '2026-10-27T01:00:00Z' },
      ])
      .on('POST', '/notifications/n1/read', null, 204)
      .on('POST', '/notifications/n2/read', null, 204)
      .on('GET', '/site/inquiries/x', { id: 'x' })
    const { router } = renderRoutes('/me/notifications')
    expect(await screen.findByText('新询盘：Buyer GmbH')).toBeTruthy()
    expect(document.querySelector('[data-notification-id="n1"]:not([data-read])')).toBeTruthy()
    fireEvent.click(screen.getByText('外链'))
    await waitFor(() => expect(server.calls.some((c) => c.path === '/notifications/n2/read')).toBe(true))
    expect(router.state.location.pathname).toBe('/me/notifications') // 外部链接不跳转
    fireEvent.click(screen.getByText('新询盘：Buyer GmbH'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/site/inquiries/x'))
  })

  it('通知设置：开关邮件；配置企业微信', async () => {
    server
      .on('GET', '/auth/me', DEMO_USER)
      .on('GET', '/notification-prefs', PREFS)
      .on('PATCH', '/notification-prefs', ({ body }: { body: unknown }) => {
        const b = body as { group: string; enabled: boolean }
        return { ...PREFS, groups: PREFS.groups.map((g) => (g.key === b.group ? { ...g, email: b.enabled } : g)) }
      })
      .on('PUT', '/notification-prefs/wecom', { ...PREFS, wecom_configured: true })
    renderRoutes('/me/notifications/settings')
    expect(await screen.findByText('邮件发送到 wang@example.com；站内通知始终开启')).toBeTruthy()
    const row = document.querySelector('[data-channel="email"] [data-group="leads"]') as HTMLElement
    const toggle = within(row).getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    await waitFor(() => expect(server.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ group: 'leads', channel: 'email', enabled: false }))
    await waitFor(() => expect(within(document.querySelector('[data-channel="email"] [data-group="leads"]') as HTMLElement).getByRole('switch').getAttribute('aria-checked')).toBe('false'))
    expect(document.querySelector('[data-channel="wecom"]')).toBeNull()

    fireEvent.change(screen.getByLabelText('Webhook 地址'), { target: { value: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('企业微信已配置')).toBeTruthy()
    expect(document.querySelector('[data-channel="wecom"]')).toBeTruthy()
  })
})

describe('数据与隐私', () => {
  it('注销企业需输入企业名并二次确认', async () => {
    server
      .on('GET', '/auth/me', DEMO_USER)
      .on('POST', '/compliance/delete-company', null, 204)
    renderRoutes('/me/privacy')
    const company = DEMO_USER.companies[0].name_cn
    expect(await screen.findByText('导出企业数据（JSON）')).toBeTruthy()
    const remove = screen.getAllByText('注销企业').at(-1)!
    fireEvent.click(remove)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.change(screen.getByLabelText(`请输入企业名「${company}」确认`), { target: { value: company } })
    fireEvent.click(remove)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '确认注销' }))
    await waitFor(() => expect(server.calls.find((c) => c.method === 'POST')?.body).toEqual({ confirm: 'DELETE', company_name: company }))
  })

  it('公开的联系人删除请求页（无需登录）', async () => {
    window.localStorage.clear()
    server.on('POST', '/public/data-requests', { status: 'received' }, 202)
    renderRoutes('/data-request')
    const submit = await screen.findByRole('button', { name: '提交请求' })
    fireEvent.change(screen.getByLabelText('你的邮箱'), { target: { value: 'jane@b.example' } })
    fireEvent.click(submit)
    expect((await screen.findAllByText('已收到你的请求，处理完成后不会再有平台用户联系你')).length).toBeGreaterThan(0)
  })

  it('隐私政策页可公开访问', async () => {
    window.localStorage.clear()
    renderRoutes('/privacy')
    expect(await screen.findByText('我们收集的信息')).toBeTruthy()
    expect(within(screen.getByRole('main')).getByRole('link', { name: '删除我的联系方式' })).toBeTruthy()
  })
})

describe('运营工作台', () => {
  it('非运营人员无法进入', async () => {
    server.on('GET', '/auth/me', DEMO_USER).on('GET', '/billing/usage', USAGE).on('GET', '/notifications', []).on('GET', '/watches', []).on('GET', '/mail-accounts', [])
    const { router } = renderRoutes('/ops/customers')
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    expect(screen.queryByText('运营工作台')).toBeNull()
  })

  it('客户列表与代客操作', async () => {
    let joined = false
    server
      .on('GET', '/auth/me', STAFF)
      .on('GET', /^\/ops\/customers(\?.*)?$/, [customer()])
      .on('GET', '/ops/customers/c2', () => ({ customer: customer({ operator_joined: joined }), usage: USAGE, members: [], recent_audit: [{ id: 'a1', action: 'operator.join', actor_user_id: 'u', company_id: 'c2', target_type: 'user', target_id: 'u', on_behalf: true, detail: {}, created_at: '2026-10-28T01:00:00Z' }] }))
      .on('POST', '/ops/customers/c2/join', () => {
        joined = true
        return customer({ operator_joined: true })
      })
      .on('POST', '/ops/companies/c2/subscription', {}, 201)
    const { router } = renderRoutes('/ops/customers')
    expect(await screen.findByText('温州泵业')).toBeTruthy()
    expect(screen.getByText('试用版 · 档案 72% · 本周商机 5 · 待复核 2')).toBeTruthy()
    fireEvent.click(screen.getByText('温州泵业'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/ops/customers/c2'))
    expect(await screen.findByText('运营代操作')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '进入企业代操作' }))
    expect(await screen.findByText('已以运营身份进入，所有操作会记录为「运营代操作」')).toBeTruthy()
    expect(await screen.findByRole('button', { name: '切换到该企业' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('到账金额（元，可选）'), { target: { value: '1999' } })
    fireEvent.click(screen.getByRole('button', { name: '手工开通套餐' }))
    await waitFor(() =>
      expect(server.calls.find((c) => c.path === '/ops/companies/c2/subscription')?.body).toEqual({ plan_key: 'growth', ends_at: null, note: '', invoice_amount_cents: 199900 }),
    )
  })

  it('复核队列：键盘快捷键通过 / 驳回 / 切换', async () => {
    const items: ReviewItem[] = [
      { lead: { id: 'l1', type: 'tender', title: 'Lead one', summary_cn: '摘要一', score: 80, market: 'Germany' }, company_id: 'c2', company_name: '温州泵业', signals: [] },
      { lead: { id: 'l2', type: 'rfq', title: 'Lead two', summary_cn: '摘要二', score: 60, market: 'Poland' }, company_id: 'c2', company_name: '温州泵业', signals: [] },
    ]
    server.on('GET', '/auth/me', STAFF).on('GET', '/ops/review-queue', items).on('POST', /^\/ops\/leads\/l\d\/review$/, {})
    renderRoutes('/ops/review')
    expect((await screen.findAllByText('Lead one')).length).toBeGreaterThan(0)
    expect(document.querySelector('.ops-review')!.getAttribute('data-lead-id')).toBe('l1')
    fireEvent.keyDown(window, { key: 'j' })
    await waitFor(() => expect(document.querySelector('.ops-review')!.getAttribute('data-lead-id')).toBe('l2'))
    fireEvent.change(screen.getByLabelText('编辑摘要'), { target: { value: '改过的摘要' } })
    fireEvent.keyDown(screen.getByLabelText('编辑摘要'), { key: 'a' }) // 输入框内不触发快捷键
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false)
    fireEvent.keyDown(window, { key: 'a' })
    await waitFor(() => expect(server.calls.find((c) => c.path === '/ops/leads/l2/review')?.body).toEqual({ decision: 'approved', summary_cn: '改过的摘要' }))
    fireEvent.keyDown(window, { key: 'k' })
    fireEvent.keyDown(window, { key: 'r' })
    await waitFor(() => expect(server.calls.find((c) => c.path === '/ops/leads/l1/review')?.body).toEqual({ decision: 'rejected' }))
  })

  it('运营人员的运营菜单在侧边栏中，「我的」页面不再重复显示', async () => {
    server.on('GET', '/auth/me', STAFF).on('GET', '/billing/usage', USAGE).on('GET', '/notifications', []).on('GET', '/watches', []).on('GET', '/mail-accounts', [])
    const { router } = renderRoutes('/me')
    expect(await screen.findByText('获客版')).toBeTruthy()
    expect(within(screen.getByRole('main')).queryByText('运营工作台')).toBeNull()
    fireEvent.click(within(screen.getByRole('navigation', { name: '主导航' })).getByRole('link', { name: '复核队列' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/ops/review'))
  })
})
