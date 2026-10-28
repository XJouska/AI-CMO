// 运营工作台（staff）：客户列表 / 详情（代客操作、手工开通）、复核队列（键盘快捷键）、审计日志、数据源、成本、评测、联系人删除请求。
// 与其他页面一样使用 402 宽画布单栏布局（桌面双栏见 docs/ui-gaps.md GAP-016）。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, FormDoubleLine, FormSingleLine, ListSectionTitle, Markdown, SettingsFullWidthItem, Tag } from '@yb/generated/components'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { QueryView } from '@/components/local/QueryView'
import { StackPage } from '@/components/local/StackPage'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { opsApi, pct, usageText, yuan, type ReviewItem } from '@/ops/api'
import { shortTime } from '@/outreach/api'
import { useSession } from '@/session/session'

function StaffOnly({ children }: { children: React.ReactNode }) {
  const session = useSession()
  if (!session.user?.is_staff) return <Navigate replace to="/me" />
  return <>{children}</>
}

export function OpsHomePage() {
  const navigate = useNavigate()
  const session = useSession()
  const items: [string, string][] = [
    [t.ops.customers, '/ops/customers'],
    [t.ops.review, '/ops/review'],
    [t.ops.audit, '/ops/audit'],
    [t.ops.sources, '/ops/sources'],
    [t.ops.costs, '/ops/costs'],
    [t.ops.evals, '/ops/evals'],
    [t.ops.dataRequests, '/ops/data-requests'],
  ]
  return (
    <StaffOnly>
      <StackPage backTo="/me" noBack={!session.company} title={t.ops.section}>
        {items.map(([label, path]) => (
          <SettingsFullWidthItem key={path} onAction={(a) => a === 'open' && navigate(path)} trailing=" " trailingKind="chevron" type="单行列表-常规">
            {label}
          </SettingsFullWidthItem>
        ))}
      </StackPage>
    </StaffOnly>
  )
}

// ── 客户 ───────────────────────────────────────────────────────────────

export function OpsCustomersPage() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const customers = useQuery({ queryKey: ['ops-customers', query], queryFn: () => opsApi.customers(query) })
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), 300)
    return () => clearTimeout(timer)
  }, [q])
  return (
    <StaffOnly>
      <StackPage backTo="/ops" title={t.ops.customers}>
        <div className="form-stack">
          <FormSingleLine align="left" label={t.ops.search} maxLength={60} onChange={setQ} placeholder={t.ops.search} value={q} />
        </div>
        <QueryView empty={{ title: t.ops.customers, desc: t.common.networkErrorDesc }} isEmpty={(rows) => rows.length === 0} query={customers}>
          {(rows) => (
            <div className="ops-grid">
              {rows.map((c) => (
                <div data-company-id={c.id} key={c.id}>
                  <SettingsFullWidthItem
                    onAction={(a) => a === 'open' && navigate(`/ops/customers/${c.id}`)}
                    showDot={c.pending_review > 0}
                    subtitle={t.ops.customerMeta(c)}
                    trailing={c.plan_status === 'expired' ? '已到期' : c.last_active_at ? shortTime(c.last_active_at) : ' '}
                    trailingKind="chevron"
                    type="双行列表-常规"
                  >
                    {c.name_cn}
                  </SettingsFullWidthItem>
                </div>
              ))}
            </div>
          )}
        </QueryView>
      </StackPage>
    </StaffOnly>
  )
}

export function OpsCustomerPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const showError = useErrorToast()
  const session = useSession()
  const queryClient = useQueryClient()
  const detail = useQuery({ queryKey: ['ops-customer', id], queryFn: () => opsApi.customer(id) })
  const [form, setForm] = useState({ plan_key: 'growth', ends_at: '', amount: '', note: '' })
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }))
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['ops-customer', id] })
    void queryClient.invalidateQueries({ queryKey: ['ops-customers'] })
  }
  const join = useMutation({
    mutationFn: () => opsApi.join(id),
    onSuccess: async () => {
      refresh()
      await session.refresh()
      toast.show(t.ops.joined)
    },
    onError: showError,
  })
  const leave = useMutation({
    mutationFn: () => opsApi.leave(id),
    onSuccess: async () => {
      refresh()
      await session.refresh()
    },
    onError: showError,
  })
  const activate = useMutation({
    mutationFn: () =>
      opsApi.activate(id, {
        plan_key: form.plan_key.trim(),
        ends_at: form.ends_at.trim() || null,
        note: form.note.trim(),
        invoice_amount_cents: form.amount.trim() ? Math.round(Number(form.amount) * 100) : null,
      }),
    onSuccess: () => {
      refresh()
      toast.show(t.ops.activated)
    },
    onError: showError,
  })
  return (
    <StaffOnly>
      <StackPage backTo="/ops/customers" title={detail.data?.customer.name_cn ?? t.ops.customers}>
        <QueryView query={detail}>
          {(data) => (
            <>
              <SettingsFullWidthItem subtitle={t.ops.customerMeta(data.customer)} trailing={data.customer.plan_status === 'expired' ? '已到期' : '生效中'} trailingKind="none" type="双行列表-常规">
                {data.usage.plan.name}
              </SettingsFullWidthItem>
              {data.usage.usage.map((u) => (
                <SettingsFullWidthItem key={u.kind} trailing={usageText(u)} trailingKind="none" type="单行列表-常规">
                  {u.label}
                </SettingsFullWidthItem>
              ))}
              <div className="form-actions content-inset">
                {data.customer.operator_joined ? (
                  <>
                    <Button
                      onAction={(a) => {
                        if (a !== 'press') return
                        session.selectCompany(id)
                        navigate('/assistant')
                      }}
                      size="L"
                      type="Primary"
                    >
                      {t.ops.switchTo}
                    </Button>
                    <Button onAction={(a) => a === 'press' && !leave.isPending && leave.mutate()} size="M" type="Text">
                      {t.ops.leave}
                    </Button>
                  </>
                ) : (
                  <Button onAction={(a) => a === 'press' && !join.isPending && join.mutate()} size="L" state={join.isPending ? 'Disable' : 'Default'} type="Primary">
                    {t.ops.join}
                  </Button>
                )}
              </div>

              <ListSectionTitle>{t.ops.activate}</ListSectionTitle>
              <div className="form-stack">
                <FormSingleLine align="left" label={t.ops.activatePlan} maxLength={32} onChange={set('plan_key')} placeholder="growth" value={form.plan_key} />
                <FormSingleLine align="left" label={t.ops.activateEnds} maxLength={10} onChange={set('ends_at')} placeholder="2027-10-31" value={form.ends_at} />
                <FormSingleLine align="left" label={t.ops.activateAmount} maxLength={10} onChange={(v) => set('amount')(v.replace(/[^\d.]/g, ''))} placeholder="1999" value={form.amount} />
                <FormSingleLine align="left" label={t.ops.activateNote} maxLength={300} onChange={set('note')} placeholder={t.ops.activateNote} value={form.note} />
                <div className="form-actions">
                  <Button onAction={(a) => a === 'press' && form.plan_key.trim() && !activate.isPending && activate.mutate()} size="M" state={activate.isPending ? 'Disable' : 'Default'} type="Secondary">
                    {t.ops.activate}
                  </Button>
                </div>
              </div>

              <ListSectionTitle>{t.ops.audit}</ListSectionTitle>
              {data.recent_audit.map((a) => (
                <SettingsFullWidthItem key={a.id} subtitle={a.on_behalf ? t.ops.onBehalf : a.target_type || ' '} trailing={shortTime(a.created_at)} trailingKind="none" type="双行列表-常规">
                  {a.action}
                </SettingsFullWidthItem>
              ))}
            </>
          )}
        </QueryView>
      </StackPage>
    </StaffOnly>
  )
}

// ── 复核队列（桌面键盘快捷键：A 通过 · R 驳回 · J / K 切换）─────────────

export function OpsReviewPage() {
  const queue = useQuery({ queryKey: ['ops-review'], queryFn: opsApi.reviewQueue })
  return (
    <StaffOnly>
      <StackPage backTo="/ops" title={t.ops.review}>
        <QueryView empty={{ title: t.ops.reviewEmpty, desc: t.ops.shortcuts }} isEmpty={(items) => items.length === 0} query={queue}>
          {(items) => <ReviewBoard items={items} />}
        </QueryView>
      </StackPage>
    </StaffOnly>
  )
}

function ReviewBoard({ items }: { items: ReviewItem[] }) {
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const [index, setIndex] = useState(0)
  const [summary, setSummary] = useState<string | null>(null)
  const current = items[Math.min(index, items.length - 1)]
  const review = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      opsApi.review(current.lead.id, { decision, ...(summary !== null && summary !== current.lead.summary_cn ? { summary_cn: summary } : {}) }),
    onSuccess: (_r, decision) => {
      toast.show(t.ops.reviewed(decision))
      setSummary(null)
      void queryClient.invalidateQueries({ queryKey: ['ops-review'] })
    },
    onError: showError,
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (event.key === 'a' && !review.isPending) review.mutate('approved')
      else if (event.key === 'r' && !review.isPending) review.mutate('rejected')
      else if (event.key === 'j') setIndex((i) => Math.min(i + 1, items.length - 1))
      else if (event.key === 'k') setIndex((i) => Math.max(i - 1, 0))
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items.length, review])
  if (!current) return null
  return (
    <div className="ops-grid ops-review" data-lead-id={current.lead.id}>
      <div>
        <ListSectionTitle>{`${index + 1} / ${items.length} · ${t.ops.shortcuts}`}</ListSectionTitle>
        {items.map((item, i) => (
          <SettingsFullWidthItem
            key={item.lead.id}
            onAction={(a) => a === 'open' && (setIndex(i), setSummary(null))}
            showDot={i === index}
            subtitle={`${item.company_name} · ${item.lead.market || '—'}`}
            trailing={`${item.lead.score} 分`}
            trailingKind="chevron"
            type="双行列表-常规"
          >
            {item.lead.title}
          </SettingsFullWidthItem>
        ))}
      </div>
      <div className="content-inset">
        <div className="lead-card-tags">
          <Tag showIcon={false} type="Default">
            {current.company_name}
          </Tag>
          <Tag showIcon={false} type="Badge">
            {`${current.lead.score} 分`}
          </Tag>
        </div>
        <Markdown variant="Others+H4">{current.lead.title}</Markdown>
        <FormDoubleLine label={t.ops.editSummary} maxLength={500} onChange={setSummary} placeholder={t.ops.editSummary} value={summary ?? current.lead.summary_cn} />
        {current.signals.map((s, i) => (
          <Markdown key={i} quoteText={<p>{`${s.source} · ${s.title}\n${s.snippet}`}</p>} variant="Quote" />
        ))}
        <div className="form-actions">
          <Button onAction={(a) => a === 'press' && !review.isPending && review.mutate('approved')} size="L" state={review.isPending ? 'Disable' : 'Default'} type="Primary">
            {t.ops.approve}
          </Button>
          <Button onAction={(a) => a === 'press' && !review.isPending && review.mutate('rejected')} size="L" state={review.isPending ? 'Disable' : 'Default'} type="Secondary">
            {t.ops.reject}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── 审计 / 数据源 / 成本 / 评测 / 删除请求 ─────────────────────────────

export function OpsAuditPage() {
  const logs = useQuery({ queryKey: ['ops-audit'], queryFn: () => opsApi.audit('?limit=200') })
  return (
    <StaffOnly>
      <StackPage backTo="/ops" title={t.ops.audit}>
        <QueryView query={logs}>
          {(rows) => (
            <div className="ops-grid">
              {rows.map((a) => (
                <SettingsFullWidthItem
                  key={a.id}
                  subtitle={[a.on_behalf ? t.ops.onBehalf : '', a.target_type, a.target_id.slice(0, 8)].filter(Boolean).join(' · ') || ' '}
                  trailing={shortTime(a.created_at)}
                  trailingKind="none"
                  type="双行列表-常规"
                >
                  {a.action}
                </SettingsFullWidthItem>
              ))}
            </div>
          )}
        </QueryView>
      </StackPage>
    </StaffOnly>
  )
}

export function OpsSourcesPage() {
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const sources = useQuery({ queryKey: ['ops-sources'], queryFn: opsApi.sources })
  const toggle = useMutation({
    mutationFn: (v: { key: string; enabled: boolean }) => opsApi.toggleSource(v.key, v.enabled),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ops-sources'] }),
    onError: showError,
  })
  return (
    <StaffOnly>
      <StackPage backTo="/ops" title={t.ops.sources}>
        <ListSectionTitle>{t.ops.days(7)}</ListSectionTitle>
        <QueryView empty={{ title: t.ops.sources, desc: t.ops.days(7) }} isEmpty={(rows) => rows.length === 0} query={sources}>
          {(rows) => (
            <>
              {rows.map((s) => (
                <SettingsFullWidthItem
                  key={s.source_key}
                  onAction={(a) => a === 'open' && toggle.mutate({ key: s.source_key, enabled: !s.enabled })}
                  showDot={!s.enabled || (s.success_rate !== null && s.success_rate < 0.5)}
                  subtitle={`成功率 ${pct(s.success_rate)} · ${s.avg_ms}ms · 封禁 ${s.blocked} · 商机 ${s.leads} · 有效率 ${pct(s.valid_rate)}`}
                  trailing={s.enabled ? t.ops.disable : t.ops.enable}
                  trailingKind="chevron"
                  type="双行列表-常规"
                >
                  {`${s.source_key}（${s.requests} 次）`}
                </SettingsFullWidthItem>
              ))}
            </>
          )}
        </QueryView>
      </StackPage>
    </StaffOnly>
  )
}

export function OpsCostsPage() {
  const costs = useQuery({ queryKey: ['ops-costs'], queryFn: () => opsApi.costs(30) })
  const micros = (n: number) => yuan(Math.round(n / 10_000))
  return (
    <StaffOnly>
      <StackPage backTo="/ops" title={t.ops.costs}>
        <QueryView query={costs}>
          {(data) => (
            <>
              <SettingsFullWidthItem subtitle={Object.entries(data.totals).map(([k, v]) => `${k} ${v.toLocaleString('zh-CN')}`).join(' · ') || ' '} trailing={micros(data.cost_micros)} trailingKind="none" type="双行列表-常规">
                {`${t.ops.total}（${t.ops.days(data.days)}）`}
              </SettingsFullWidthItem>
              <div className="ops-grid">
                {data.companies.map((c) => (
                  <SettingsFullWidthItem key={c.company_id} subtitle={Object.entries(c.usage).map(([k, v]) => `${k} ${v.toLocaleString('zh-CN')}`).join(' · ')} trailing={micros(c.cost_micros)} trailingKind="none" type="双行列表-常规">
                    {c.name || c.company_id.slice(0, 8)}
                  </SettingsFullWidthItem>
                ))}
              </div>
            </>
          )}
        </QueryView>
      </StackPage>
    </StaffOnly>
  )
}

export function OpsEvalsPage() {
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const evals = useQuery({ queryKey: ['ops-evals'], queryFn: opsApi.evals, refetchInterval: (q) => (q.state.data?.runs.some((r) => r.status === 'queued') ? 2000 : false) })
  const run = useMutation({
    mutationFn: (dataset: string) => opsApi.runEval(dataset),
    onSuccess: () => {
      toast.show(t.ops.evalStarted)
      void queryClient.invalidateQueries({ queryKey: ['ops-evals'] })
    },
    onError: showError,
  })
  return (
    <StaffOnly>
      <StackPage backTo="/ops" title={t.ops.evals}>
        <QueryView query={evals}>
          {(data) => (
            <>
              {data.datasets.map((d) => (
                <SettingsFullWidthItem key={d} onAction={(a) => a === 'open' && !run.isPending && run.mutate(d)} trailing={t.ops.runEval} trailingKind="chevron" type="单行列表-常规">
                  {d}
                </SettingsFullWidthItem>
              ))}
              <ListSectionTitle>{t.ops.evals}</ListSectionTitle>
              {data.runs.map((r) => (
                <SettingsFullWidthItem
                  key={r.id}
                  subtitle={
                    r.status === 'done'
                      ? `准确率 ${pct(r.metrics.intent_accuracy ?? null)} · Top20 有效 ${pct(r.metrics.top20_valid_rate ?? null)} · 重复 ${pct(r.metrics.duplicate_rate ?? null)} · 虚假 ${pct(r.metrics.fake_rate ?? null)}`
                      : r.error || r.status
                  }
                  trailing={shortTime(r.created_at)}
                  trailingKind="none"
                  type="双行列表-常规"
                >
                  {`${r.dataset}（${r.mode}）`}
                </SettingsFullWidthItem>
              ))}
            </>
          )}
        </QueryView>
      </StackPage>
    </StaffOnly>
  )
}

export function OpsDataRequestsPage() {
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const requests = useQuery({ queryKey: ['ops-data-requests'], queryFn: opsApi.dataRequests })
  const handle = useMutation({
    mutationFn: (v: { id: string; decision: 'done' | 'rejected' }) => opsApi.handleDataRequest(v.id, v.decision),
    onSuccess: () => {
      toast.show(t.ops.handled)
      void queryClient.invalidateQueries({ queryKey: ['ops-data-requests'] })
    },
    onError: showError,
  })
  return (
    <StaffOnly>
      <StackPage backTo="/ops" title={t.ops.dataRequests}>
        <QueryView empty={{ title: t.ops.dataRequests, desc: t.privacy.erasureDesc }} isEmpty={(rows) => rows.length === 0} query={requests}>
          {(rows) => (
            <>
              {rows.map((r) => (
                <section data-request-id={r.id} key={r.id}>
                  <SettingsFullWidthItem subtitle={r.note || shortTime(r.created_at)} trailing={r.status} trailingKind="none" type="双行列表-常规">
                    {r.email}
                  </SettingsFullWidthItem>
                  {r.status === 'open' ? (
                    <div className="form-actions content-inset">
                      <Button onAction={(a) => a === 'press' && handle.mutate({ id: r.id, decision: 'done' })} size="M" type="Primary">
                        {t.ops.handle}
                      </Button>
                      <Button onAction={(a) => a === 'press' && handle.mutate({ id: r.id, decision: 'rejected' })} size="M" type="Text">
                        {t.ops.rejectRequest}
                      </Button>
                    </div>
                  ) : null}
                </section>
              ))}
            </>
          )}
        </QueryView>
      </StackPage>
    </StaffOnly>
  )
}
