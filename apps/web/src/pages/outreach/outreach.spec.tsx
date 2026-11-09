import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeadOut } from '@/leads/api'
import type { DraftOut, FollowUpOut, MailAccountOut, PipelineOut } from '@/outreach/api'
import { describeActivity, localInputToIso } from '@/outreach/api'
import { demoProfile, installFakeServer, signedIn, type FakeServer, OPERATOR_USER } from '@/test/fakeServer'
import { renderRoutes } from '@/test/render'

let server: FakeServer

const STAGES = {
  new: '新商机',
  viewed: '已查看',
  contacted: '已联系',
  replied: '已回复',
  inquiry: '已询价',
  quoted: '已报价',
  sampling: '打样中',
  won: '已成交',
  lost: '已放弃',
  invalid: '无效',
}
const LOST = { no_reply: '多次联系无回复', price: '价格没有竞争力' }

function lead(): LeadOut {
  return {
    id: 'l1',
    type: 'tender',
    title: 'Tender: ball valves',
    summary_cn: '采购 2,000 个球阀',
    reasons: [],
    suggested_action: '',
    products_matched: [],
    market: 'Germany',
    score: 80,
    score_detail: [],
    confidence: 'high',
    deadline: null,
    source_url: '',
    source_domain: '',
    status: 'viewed',
    review_status: 'approved',
    is_new: false,
    created_at: '2026-10-27T08:00:00',
    buyer: null,
    signal_count: 1,
  }
}

function pipeline(overrides: Partial<PipelineOut> = {}): PipelineOut {
  return {
    lead_id: 'l1',
    stage: 'viewed',
    stage_label: '已查看',
    allowed_next: ['contacted', 'replied', 'inquiry', 'quoted', 'sampling', 'won', 'lost', 'invalid'],
    next_action: '',
    next_action_at: null,
    overdue: false,
    lost_reason: '',
    deal_value: null,
    currency: 'USD',
    ...overrides,
  }
}

function followUp(overrides: Partial<FollowUpOut> = {}): FollowUpOut {
  return {
    pipeline: pipeline(),
    activities: [
      { id: 'a1', kind: 'stage_change', content: { from: 'new', to: 'viewed', note: '' }, user_id: null, created_at: '2026-10-27T08:00:00Z' },
    ],
    stages: STAGES,
    lost_reasons: LOST,
    ...overrides,
  }
}

function draft(overrides: Partial<DraftOut> = {}): DraftOut {
  return {
    id: 'd1',
    lead_id: 'l1',
    tone: 'professional',
    language: 'en',
    to_email: 'buyer@b.example',
    subject: 'Re: Tender: ball valves',
    body: 'Dear team, ...',
    version: 1,
    status: 'draft',
    flags: [],
    word_count: 150,
    mailto: 'mailto:buyer@b.example?subject=Re',
    created_at: '2026-10-27T08:00:00Z',
    sent_at: null,
    ...overrides,
  }
}

const ACCOUNT: MailAccountOut = {
  id: 'm1',
  provider: 'smtp',
  from_address: 'sales@a.example',
  from_name: 'Sales',
  smtp_host: 'smtp.a.example',
  smtp_port: 465,
  username: 'sales@a.example',
  daily_limit: 30,
  sent_today: 2,
  verified: true,
  last_error: '',
  dns: { spf: true, dmarc: false, hints: ['发信域名未配置 DMARC 记录'] },
}

beforeEach(() => {
  server = installFakeServer()
  server.on('GET', '/auth/me', OPERATOR_USER).on('GET', '/profile', demoProfile())
  signedIn()
})

describe('跟进阶段与记录', () => {
  it('推进阶段；选择「已放弃」需选原因', async () => {
    server
      .on('GET', '/leads/l1', lead())
      .on('GET', '/leads/l1/follow-up', followUp())
      .on('POST', '/leads/l1/stage', ({ body }: { body: unknown }) => pipeline({ stage: (body as { stage: 'contacted' }).stage, stage_label: '已联系' }))
    renderRoutes('/leads/l1')
    expect(await screen.findByText('新商机 → 已查看')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '推进' }))
    fireEvent.click(await screen.findByRole('button', { name: '已联系' }))
    expect(await screen.findByText('已更新为「已联系」')).toBeTruthy()
    expect(server.calls.find((c) => c.path === '/leads/l1/stage')!.body).toEqual({ stage: 'contacted' })

    fireEvent.click(screen.getByRole('button', { name: '推进' }))
    fireEvent.click(await screen.findByRole('button', { name: '已放弃' }))
    fireEvent.click(await screen.findByRole('button', { name: '价格没有竞争力' }))
    await waitFor(() => expect(server.calls.filter((c) => c.path === '/leads/l1/stage').at(-1)!.body).toEqual({ stage: 'lost', lost_reason: 'price' }))
  })

  it('设置下一步与添加记录', async () => {
    server
      .on('GET', '/leads/l1', lead())
      .on('GET', '/leads/l1/follow-up', followUp())
      .on('PUT', '/leads/l1/next-action', pipeline({ next_action: '电话跟进', next_action_at: '2026-10-28T01:00:00Z' }))
      .on('POST', '/leads/l1/activities', { id: 'a2', kind: 'reply', content: { text: 'ok' }, user_id: null, created_at: '' }, 201)
    renderRoutes('/leads/l1')
    fireEvent.click(await screen.findByText('下一步'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('要做什么'), { target: { value: '电话跟进' } })
    fireEvent.change(within(dialog).getByLabelText('时间'), { target: { value: '2026-10-28T09:00' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => {
      const call = server.calls.find((c) => c.method === 'PUT')
      expect(call?.body).toEqual({ next_action: '电话跟进', next_action_at: localInputToIso('2026-10-28T09:00') })
    })

    fireEvent.click(screen.getByText('添加记录'))
    fireEvent.click(await screen.findByRole('button', { name: '对方回复' }))
    const sheet = await screen.findByRole('dialog')
    fireEvent.change(within(sheet).getByLabelText('内容'), { target: { value: 'Please send catalogue' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(server.calls.find((c) => c.path === '/leads/l1/activities')?.body).toEqual({ kind: 'reply', text: 'Please send catalogue' }))
  })

  it('已结束的商机不显示下一步', async () => {
    server
      .on('GET', '/leads/l1', lead())
      .on('GET', '/leads/l1/follow-up', followUp({ pipeline: pipeline({ stage: 'won', stage_label: '已成交', allowed_next: ['contacted'] }) }))
    renderRoutes('/leads/l1')
    expect(await screen.findByText('已成交')).toBeTruthy()
    expect(screen.queryByText('下一步')).toBeNull()
  })

  it('跟进记录描述为纯文本', () => {
    const { title, detail } = describeActivity(
      { id: 'x', kind: 'stage_change', content: { from: 'inquiry', to: 'lost', lost_reason: 'price', note: '<b>贵</b>' }, user_id: null, created_at: '' },
      STAGES,
      LOST,
    )
    expect(title).toBe('已询价 → 已放弃（价格没有竞争力）')
    expect(detail).toBe('<b>贵</b>')
    expect(describeActivity({ id: 'y', kind: 'email_sent', content: { subject: 'Hi', to: 'a@b' }, user_id: null, created_at: '' }, STAGES, LOST).title).toBe('已发送开发信：Hi')
  })
})

describe('开发信', () => {
  it('没有草稿时自动生成；事实校验提示；切换语气', async () => {
    let drafts: DraftOut[] = []
    server
      .on('GET', '/leads/l1/drafts', () => drafts)
      .on('GET', '/mail-accounts', [])
      .on('POST', '/leads/l1/drafts', ({ body }: { body: unknown }) => {
        const tone = (body as { tone: DraftOut['tone'] }).tone
        const d = draft({ id: `d-${tone}`, tone, flags: tone === 'professional' ? [{ text: 'FDA', reason: '证书不在企业档案中' }] : [] })
        drafts = [d, ...drafts]
        return d
      }, 201)
    renderRoutes('/leads/l1/draft')
    expect(await screen.findByText(/FDA（证书不在企业档案中）/)).toBeTruthy()
    expect((screen.getByLabelText('收件人') as HTMLInputElement).value).toBe('buyer@b.example')
    expect(server.calls.filter((c) => c.method === 'POST')[0].body).toEqual({ tone: 'professional' })

    fireEvent.click(screen.getByRole('tab', { name: '简洁' }))
    expect(await screen.findByText('还没有「简洁」语气的版本')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '生成这个语气' }))
    await waitFor(() => expect(server.calls.filter((c) => c.method === 'POST').at(-1)!.body).toEqual({ tone: 'concise' }))
  })

  it('未绑定邮箱：复制后标记已发送', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    server
      .on('GET', '/leads/l1/drafts', [draft()])
      .on('GET', '/mail-accounts', [])
      .on('POST', '/drafts/d1/mark-sent', draft({ status: 'sent' }))
      .on('GET', '/leads/l1', lead())
      .on('GET', '/leads/l1/follow-up', followUp())
    const { router } = renderRoutes('/leads/l1/draft')
    await screen.findByDisplayValue('Re: Tender: ball valves')
    expect(screen.queryByRole('button', { name: '确认发送' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Re: Tender: ball valves\n\nDear team, ...'))
    fireEvent.click(screen.getByRole('button', { name: '我已发送' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/leads/l1'))
    expect(server.calls.find((c) => c.path === '/drafts/d1/mark-sent')!.body).toEqual({ method: 'copy' })
  })

  it('绑定邮箱：修改后先保存，确认对话框展示收件人与主题，确认后发送', async () => {
    server
      .on('GET', '/leads/l1/drafts', [draft()])
      .on('GET', '/mail-accounts', [ACCOUNT])
      .on('PATCH', '/drafts/d1', ({ body }: { body: unknown }) => draft(body as Partial<DraftOut>))
      .on('POST', '/drafts/d1/send', { draft: draft({ status: 'sent' }), pipeline: pipeline({ stage: 'contacted' }), remaining_today: 27 })
      .on('GET', '/leads/l1', lead())
      .on('GET', '/leads/l1/follow-up', followUp())
    renderRoutes('/leads/l1/draft')
    const subject = await screen.findByLabelText('主题')
    fireEvent.change(subject, { target: { value: 'Ball valves for your tender' } })
    fireEvent.click(await screen.findByRole('button', { name: '确认发送' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('sales@a.example')
    expect(dialog.textContent).toContain('Ball valves for your tender')
    expect(server.calls.some((c) => c.path === '/drafts/d1/send')).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: '确认发送' }))
    expect(await screen.findByText('已发送，今日还可发送 27 封')).toBeTruthy()
    const patchIndex = server.calls.findIndex((c) => c.method === 'PATCH')
    const sendIndex = server.calls.findIndex((c) => c.path === '/drafts/d1/send')
    expect(patchIndex).toBeGreaterThan(-1)
    expect(sendIndex).toBeGreaterThan(patchIndex)
    expect(server.calls[sendIndex].body).toEqual({ mail_account_id: 'm1', confirm_to: 'buyer@b.example', confirm_subject: 'Ball valves for your tender' })
  })

  it('让 AI 修改', async () => {
    server
      .on('GET', '/leads/l1/drafts', [draft()])
      .on('GET', '/mail-accounts', [])
      .on('POST', '/drafts/d1/revise', draft({ id: 'd2', version: 2 }), 201)
    renderRoutes('/leads/l1/draft')
    fireEvent.change(await screen.findByLabelText('让 AI 修改'), { target: { value: '再短一点' } })
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    await waitFor(() => expect(server.calls.find((c) => c.path === '/drafts/d1/revise')?.body).toEqual({ instruction: '再短一点' }))
  })
})

describe('待跟进、发信邮箱、周报', () => {
  it('「待跟进」分类：逾期标红点，点击进入详情', async () => {
    server
      .on('GET', '/watches', [])
      .on('GET', /^\/leads\?/, { items: [], total: 0, new_count: 0, today_count: 0 })
      .on('GET', '/follow-ups/due', [
        { lead_id: 'l1', title: 'Overdue lead', type: 'tender', score: 80, pipeline: pipeline({ next_action: '电话', next_action_at: '2020-01-01T00:00:00Z', overdue: true }) },
      ])
      .on('GET', '/leads/l1', lead())
      .on('GET', '/leads/l1/follow-up', followUp())
    const { router } = renderRoutes('/leads')
    fireEvent.click(await screen.findByRole('tab', { name: '跟进' }))
    expect(await screen.findByText('Overdue lead')).toBeTruthy()
    expect(document.querySelector('[data-lead-id="l1"][data-overdue]')).toBeTruthy()
    expect(screen.getByText(/^已逾期 · /)).toBeTruthy()
    fireEvent.click(screen.getByText('Overdue lead'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/leads/l1'))
  })

  it('绑定发信邮箱：校验后提交，密码不回显', async () => {
    server
      .on('GET', '/mail-accounts', [])
      .on('POST', '/mail-accounts', ACCOUNT, 201)
    const { router } = renderRoutes('/me/mail-accounts/new')
    const submit = await screen.findByRole('button', { name: '绑定邮箱' })
    fireEvent.change(screen.getByLabelText('发件邮箱'), { target: { value: 'sales@a.example' } })
    fireEvent.change(screen.getByLabelText('SMTP 服务器'), { target: { value: 'smtp.a.example' } })
    fireEvent.change(screen.getByLabelText('登录账号'), { target: { value: 'sales@a.example' } })
    const password = screen.getByLabelText('密码 / 授权码') as HTMLInputElement
    expect(password.type).toBe('password')
    fireEvent.change(password, { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText(/^端口/), { target: { value: '25' } })
    expect(screen.getByText('端口只支持 465 或 587')).toBeTruthy()
    fireEvent.click(submit)
    expect(server.calls.some((c) => c.method === 'POST')).toBe(false)
    fireEvent.change(screen.getByLabelText(/^端口/), { target: { value: '587' } })
    fireEvent.click(submit)
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/mail-accounts'))
    expect(server.calls.find((c) => c.method === 'POST')!.body).toMatchObject({ smtp_port: 587, password: 'secret', daily_limit: 30 })
  })

  it('发信邮箱列表：今日发送量与 DNS 提示', async () => {
    server.on('GET', '/mail-accounts', [ACCOUNT])
    renderRoutes('/me/mail-accounts')
    expect(await screen.findByText('今日已发 2 / 30 封')).toBeTruthy()
    expect(screen.getByText('发信域名未配置 DMARC 记录')).toBeTruthy()
  })

  it('周报详情：表格按列表行展示', async () => {
    server.on('GET', '/reports/weekly/r1', {
      id: 'r1',
      week_start: '2026-10-19',
      stats: {},
      markdown: '### 效果周报（10.19–10.25）\n\n| 指标 | 本周 |\n| --- | --- |\n| 新增商机 | 3 |\n\n#### 下周建议重点\n\n1. 优先跟进',
      created_at: '',
    })
    renderRoutes('/me/reports/r1')
    expect(await screen.findByText('效果周报（10.19–10.25）')).toBeTruthy()
    expect(screen.getByText('新增商机')).toBeTruthy()
    expect(screen.getByText('优先跟进')).toBeTruthy()
    expect(screen.queryByText(/\| 指标/)).toBeNull()
  })
})
