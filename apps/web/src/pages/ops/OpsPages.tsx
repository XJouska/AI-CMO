// 运营工作台（staff）：客户列表 / 详情（代客操作、手工开通）、复核队列（两栏 + 键盘快捷键）、审计日志、数据源、成本、评测、联系人删除请求。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ClipboardCheck, Coins, Database, FlaskConical, History, Play, Search, Users, UserX, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { QueryView } from '@/components/QueryView'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { SubNav } from '@/layout/AppLayout'
import { AppPage, type AppPageProps } from '@/layout/AppPage'
import { opsApi, pct, usageText, yuan, type ReviewItem } from '@/ops/api'
import { shortTime } from '@/outreach/api'
import { useSession } from '@/session/session'
import { Button, Card, CardHeader, cx, Heading, KeyValue, ListGroup, ListRow, Quote, Stat, Switch, Tag, TextArea, TextField, useToast } from '@/ui'

const OPS_NAV = [
  {
    items: [
      { path: '/ops', label: t.ops.overview, icon: ClipboardCheck, end: true },
      { path: '/ops/customers', label: t.ops.customers, icon: Users },
      { path: '/ops/review', label: t.ops.review, icon: Check },
      { path: '/ops/audit', label: t.ops.audit, icon: History },
      { path: '/ops/sources', label: t.ops.sources, icon: Database },
      { path: '/ops/costs', label: t.ops.costs, icon: Coins },
      { path: '/ops/evals', label: t.ops.evals, icon: FlaskConical },
      { path: '/ops/data-requests', label: t.ops.dataRequests, icon: UserX },
    ],
  },
]

function OpsPage({ children, ...props }: Omit<AppPageProps, 'aside'> & { children: ReactNode }) {
  const session = useSession()
  if (!session.user?.is_staff) return <Navigate replace to="/me" />
  return (
    <AppPage {...props} aside={<SubNav groups={OPS_NAV} label={t.ops.section} />}>
      {children}
    </AppPage>
  )
}

/** 简单数据表：窄屏横向滚动。 */
function DataTable({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx('table-wrap', className)}>
      <table className="table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function OpsHomePage() {
  const navigate = useNavigate()
  const items = OPS_NAV[0].items.slice(1)
  return (
    <OpsPage title={t.ops.section}>
      <div className="grid-3 ops-home">
        {items.map((item) => (
          <button className="ops-tile" key={item.path} onClick={() => navigate(item.path)} type="button">
            <span aria-hidden className="ops-tile__icon">
              <item.icon size={20} />
            </span>
            <span className="ops-tile__label">{item.label}</span>
          </button>
        ))}
      </div>
    </OpsPage>
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
    <OpsPage title={t.ops.customers} toolbar={<TextField aria-label={t.ops.search} fieldClassName="ops-search" maxLength={60} onChange={setQ} placeholder={t.ops.search} prefix={<Search size={16} />} value={q} />}>
      <QueryView empty={{ title: t.ops.customers, desc: t.common.networkErrorDesc, icon: Users }} isEmpty={(rows) => rows.length === 0} query={customers}>
        {(rows) => (
          <DataTable head={[t.ops.colCompany, t.ops.colPlan, t.ops.colProfile, t.ops.colLeads, t.ops.colPending, t.ops.colActive]}>
            {rows.map((c) => (
              <tr className="is-clickable" data-company-id={c.id} key={c.id} onClick={() => navigate(`/ops/customers/${c.id}`)}>
                <td>
                  <div className="table__title">{c.name_cn}</div>
                  <div className="table__sub">{t.ops.customerMeta(c)}</div>
                </td>
                <td>{c.plan_status === 'expired' ? <Tag tone="danger">{t.billing.status.expired}</Tag> : c.plan}</td>
                <td>{`${c.completeness}%`}</td>
                <td>{c.leads_week}</td>
                <td>{c.pending_review ? <Tag tone="warning">{c.pending_review}</Tag> : 0}</td>
                <td className="muted">{c.last_active_at ? shortTime(c.last_active_at) : '—'}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </QueryView>
    </OpsPage>
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
    <OpsPage back="/ops/customers" title={detail.data?.customer.name_cn ?? t.ops.customers}>
      <QueryView query={detail}>
        {(data) => (
          <div className="split">
            <div className="stack-lg">
              <Card>
                <CardHeader
                  actions={<Tag tone={data.customer.plan_status === 'expired' ? 'danger' : 'success'}>{data.customer.plan_status === 'expired' ? t.billing.status.expired : t.billing.status.active}</Tag>}
                  description={t.ops.customerMeta(data.customer)}
                  title={data.usage.plan.name}
                />
                <KeyValue items={data.usage.usage.map((u) => ({ label: u.label, value: usageText(u) }))} />
              </Card>
              <ListGroup title={t.ops.audit}>
                {data.recent_audit.length ? (
                  data.recent_audit.map((a) => <ListRow key={a.id} subtitle={a.on_behalf ? t.ops.onBehalf : a.target_type || undefined} title={a.action} value={shortTime(a.created_at)} />)
                ) : (
                  <ListRow title="—" />
                )}
              </ListGroup>
            </div>
            <aside className="split__side">
              <Card>
                <CardHeader title={t.ops.operate} />
                <div className="stack">
                  {data.customer.operator_joined ? (
                    <>
                      <Button
                        block
                        onClick={() => {
                          session.selectCompany(id)
                          navigate('/assistant')
                        }}
                        variant="primary"
                      >
                        {t.ops.switchTo}
                      </Button>
                      <Button block loading={leave.isPending} onClick={() => leave.mutate()} variant="ghost">
                        {t.ops.leave}
                      </Button>
                    </>
                  ) : (
                    <Button block loading={join.isPending} onClick={() => join.mutate()} variant="primary">
                      {t.ops.join}
                    </Button>
                  )}
                </div>
              </Card>
              <Card>
                <CardHeader title={t.ops.activate} />
                <div className="ui-form-stack">
                  <TextField label={t.ops.activatePlan} maxLength={32} onChange={set('plan_key')} placeholder="growth" value={form.plan_key} />
                  <TextField label={t.ops.activateEnds} maxLength={10} onChange={set('ends_at')} placeholder="2027-10-31" value={form.ends_at} />
                  <TextField inputMode="decimal" label={t.ops.activateAmount} maxLength={10} onChange={(v) => set('amount')(v.replace(/[^\d.]/g, ''))} placeholder="1999" value={form.amount} />
                  <TextField label={t.ops.activateNote} maxLength={300} onChange={set('note')} placeholder={t.ops.activateNote} value={form.note} />
                  <Button disabled={!form.plan_key.trim()} loading={activate.isPending} onClick={() => activate.mutate()} variant="secondary">
                    {t.ops.activate}
                  </Button>
                </div>
              </Card>
            </aside>
          </div>
        )}
      </QueryView>
    </OpsPage>
  )
}

// ── 复核队列（两栏；键盘快捷键：A 通过 · R 驳回 · J / K 切换）─────────────

export function OpsReviewPage() {
  const queue = useQuery({ queryKey: ['ops-review'], queryFn: opsApi.reviewQueue })
  return (
    <OpsPage description={t.ops.shortcuts} title={t.ops.review} width="full">
      <QueryView empty={{ title: t.ops.reviewEmpty, desc: t.ops.shortcuts, icon: ClipboardCheck }} isEmpty={(items) => items.length === 0} query={queue}>
        {(items) => <ReviewBoard items={items} />}
      </QueryView>
    </OpsPage>
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
    <div className="review-board">
      <div className="review-board__list">
        <div className="review-board__count">{`${index + 1} / ${items.length}`}</div>
        <div className="ui-list">
          {items.map((item, i) => (
            <ListRow
              active={i === index}
              key={item.lead.id}
              onClick={() => {
                setIndex(i)
                setSummary(null)
              }}
              subtitle={`${item.company_name} · ${item.lead.market || '—'}`}
              title={item.lead.title}
              value={`${item.lead.score} 分`}
            />
          ))}
        </div>
      </div>
      <Card className="ops-review review-board__detail" data-lead-id={current.lead.id} padding="lg">
        <div className="stack">
          <div className="row">
            <Tag>{current.company_name}</Tag>
            <Tag tone="accent">{`${current.lead.score} 分`}</Tag>
            {current.lead.market ? <Tag>{current.lead.market}</Tag> : null}
          </div>
          <Heading level={3}>{current.lead.title}</Heading>
          <TextArea label={t.ops.editSummary} maxLength={500} onChange={setSummary} placeholder={t.ops.editSummary} rows={4} value={summary ?? current.lead.summary_cn} />
          {current.signals.map((s, i) => (
            <Quote key={i}>
              <span className="pre-wrap">{`${s.source} · ${s.title}\n${s.snippet}`}</span>
            </Quote>
          ))}
          <div className="ui-form-actions ui-form-actions--start">
            <Button icon={Check} loading={review.isPending} onClick={() => review.mutate('approved')} variant="primary">
              {t.ops.approve}
            </Button>
            <Button disabled={review.isPending} icon={X} onClick={() => review.mutate('rejected')} variant="outline">
              {t.ops.reject}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ── 审计 / 数据源 / 成本 / 评测 / 删除请求 ─────────────────────────────

export function OpsAuditPage() {
  const logs = useQuery({ queryKey: ['ops-audit'], queryFn: () => opsApi.audit('?limit=200') })
  return (
    <OpsPage title={t.ops.audit}>
      <QueryView query={logs}>
        {(rows) => (
          <DataTable head={[t.ops.colAction, t.ops.colTarget, t.ops.colTime]}>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>
                  <span className="mono">{a.action}</span>
                  {a.on_behalf ? (
                    <>
                      {' '}
                      <Tag tone="warning">{t.ops.onBehalf}</Tag>
                    </>
                  ) : null}
                </td>
                <td className="muted">{[a.target_type, a.target_id.slice(0, 8)].filter(Boolean).join(' · ') || '—'}</td>
                <td className="muted">{shortTime(a.created_at)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </QueryView>
    </OpsPage>
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
    <OpsPage description={t.ops.days(7)} title={t.ops.sources}>
      <QueryView empty={{ title: t.ops.sources, desc: t.ops.days(7), icon: Database }} isEmpty={(rows) => rows.length === 0} query={sources}>
        {(rows) => (
          <DataTable head={[t.ops.colSource, t.ops.colRequests, t.ops.colSuccess, t.ops.colLatency, t.ops.colBlocked, t.ops.colLeads, t.ops.colValid, t.ops.colEnabled]}>
            {rows.map((s) => {
              const warn = !s.enabled || (s.success_rate !== null && s.success_rate < 0.5)
              return (
                <tr className={warn ? 'is-warn' : undefined} key={s.source_key}>
                  <td className="mono">{s.source_key}</td>
                  <td>{s.requests}</td>
                  <td>{pct(s.success_rate)}</td>
                  <td>{`${s.avg_ms}ms`}</td>
                  <td>{s.blocked}</td>
                  <td>{s.leads}</td>
                  <td>{pct(s.valid_rate)}</td>
                  <td>
                    <Switch checked={s.enabled} disabled={toggle.isPending} label={`${s.source_key} ${s.enabled ? t.ops.disable : t.ops.enable}`} onChange={(enabled) => toggle.mutate({ key: s.source_key, enabled })} />
                  </td>
                </tr>
              )
            })}
          </DataTable>
        )}
      </QueryView>
    </OpsPage>
  )
}

export function OpsCostsPage() {
  const costs = useQuery({ queryKey: ['ops-costs'], queryFn: () => opsApi.costs(30) })
  const micros = (n: number) => yuan(Math.round(n / 10_000))
  const usage = (u: Record<string, number>) => Object.entries(u).map(([k, v]) => `${k} ${v.toLocaleString('zh-CN')}`).join(' · ')
  return (
    <OpsPage title={t.ops.costs}>
      <QueryView query={costs}>
        {(data) => (
          <div className="stack-lg">
            <div className="grid-3 keep-2">
              <Stat hint={usage(data.totals) || undefined} label={`${t.ops.total}（${t.ops.days(data.days)}）`} value={micros(data.cost_micros)} />
            </div>
            <DataTable head={[t.ops.colCompany, t.ops.colUsage, t.ops.colCost]}>
              {data.companies.map((c) => (
                <tr key={c.company_id}>
                  <td>{c.name || c.company_id.slice(0, 8)}</td>
                  <td className="muted">{usage(c.usage)}</td>
                  <td>{micros(c.cost_micros)}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </QueryView>
    </OpsPage>
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
    <OpsPage title={t.ops.evals}>
      <QueryView query={evals}>
        {(data) => (
          <div className="stack-lg">
            <ListGroup title={t.ops.datasets}>
              {data.datasets.map((d) => (
                <ListRow
                  key={d}
                  title={<span className="mono">{d}</span>}
                  trailing={
                    <Button disabled={run.isPending} icon={Play} onClick={() => run.mutate(d)} size="sm" variant="outline">
                      {t.ops.runEval}
                    </Button>
                  }
                />
              ))}
            </ListGroup>
            <DataTable head={[t.ops.colDataset, t.ops.colAccuracy, t.ops.colTop20, t.ops.colDup, t.ops.colFake, t.ops.colTime]}>
              {data.runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="mono">{`${r.dataset}（${r.mode}）`}</span>
                    {r.status !== 'done' ? <div className="table__sub">{r.error || r.status}</div> : null}
                  </td>
                  <td>{r.status === 'done' ? pct(r.metrics.intent_accuracy ?? null) : '—'}</td>
                  <td>{r.status === 'done' ? pct(r.metrics.top20_valid_rate ?? null) : '—'}</td>
                  <td>{r.status === 'done' ? pct(r.metrics.duplicate_rate ?? null) : '—'}</td>
                  <td>{r.status === 'done' ? pct(r.metrics.fake_rate ?? null) : '—'}</td>
                  <td className="muted">{shortTime(r.created_at)}</td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </QueryView>
    </OpsPage>
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
    <OpsPage title={t.ops.dataRequests}>
      <QueryView empty={{ title: t.ops.dataRequests, desc: t.privacy.erasureDesc, icon: UserX }} isEmpty={(rows) => rows.length === 0} query={requests}>
        {(rows) => (
          <div className="ui-list">
            {rows.map((r) => (
              <ListRow
                data={{ 'request-id': r.id }}
                key={r.id}
                subtitle={r.note || shortTime(r.created_at)}
                title={r.email}
                trailing={
                  r.status === 'open' ? (
                    <>
                      <Button onClick={() => handle.mutate({ id: r.id, decision: 'done' })} size="sm" variant="primary">
                        {t.ops.handle}
                      </Button>
                      <Button onClick={() => handle.mutate({ id: r.id, decision: 'rejected' })} size="sm" variant="ghost">
                        {t.ops.rejectRequest}
                      </Button>
                    </>
                  ) : (
                    <Tag>{r.status}</Tag>
                  )
                }
              />
            ))}
          </div>
        )}
      </QueryView>
    </OpsPage>
  )
}
