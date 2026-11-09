// 运营工作台（staff）：客户列表 / 详情（代客操作、手工开通）、复核队列（两栏 + 键盘快捷键）、审计日志、数据源、成本、评测、联系人删除请求。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ClipboardCheck, Database, ListChecks, Play, Search, Users, UserX, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { QueryView } from '@/components/QueryView'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { AppPage, type AppPageProps } from '@/layout/AppPage'
import { opsApi, pct, usageText, yuan, type ReviewItem } from '@/ops/api'
import { shortTime } from '@/outreach/api'
import { serviceApi, type Layout, type ServiceTask, type SiteStyle } from '@/service/api'
import { useSession } from '@/session/session'
import { siteApi } from '@/site/api'
import { Button, Card, CardHeader, cx, Heading, KeyValue, ListGroup, ListRow, Quote, Select, Stat, Switch, Tabs, Tag, TextArea, TextField, useToast } from '@/ui'

function OpsPage({ children, ...props }: Omit<AppPageProps, 'aside'> & { children: ReactNode }) {
  const session = useSession()
  if (!session.user?.is_staff) return <Navigate replace to="/home" />
  return (
    <AppPage {...props}>{children}</AppPage>
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
  return <Navigate replace to="/ops/customers" />
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
      <QueryView
        empty={query ? { title: t.ops.noCustomersMatch, icon: Users } : { title: t.ops.noCustomersTitle, desc: t.ops.noCustomersDesc, icon: Users }}
        isEmpty={(rows) => rows.length === 0}
        query={customers}
      >
        {(rows) => (
          <DataTable head={[t.ops.colCompany, t.ops.colStage, t.ops.colWaiting, t.ops.colLeads, t.ops.colPending, t.ops.colActive]}>
            {rows.map((c) => (
              <tr className="is-clickable" data-company-id={c.id} key={c.id} onClick={() => navigate(`/ops/customers/${c.id}`)}>
                <td>
                  <div className="table__title">{c.name_cn}</div>
                  <div className="table__sub">{c.plan_status === 'expired' ? t.billing.status.expired : c.plan}</div>
                </td>
                <td>{t.ops.stages[c.stage] ?? c.stage}</td>
                <td>
                  {c.waiting_on === 'team' ? (
                    <Tag tone="warning">{c.open_tasks ? `${t.ops.waiting.team} · ${c.open_tasks}` : t.ops.waiting.team}</Tag>
                  ) : c.waiting_on === 'customer' ? (
                    <Tag>{t.ops.waiting.customer}</Tag>
                  ) : (
                    t.ops.waiting.none
                  )}
                </td>
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
  const styleCatalog = useQuery({ queryKey: ['site-styles'], queryFn: serviceApi.styles, staleTime: Infinity })
  const styleLabel = (key: string) => (key === 'own' ? '按工厂自己的风格' : styleCatalog.data?.layouts.find((l) => l.key === key)?.label ?? key)
  // 刚点了「生成网站」：后台任务完成前定时刷新
  const [generating, setGenerating] = useState(false)
  const bench = useQuery({
    queryKey: ['ops-workbench', id],
    queryFn: () => serviceApi.workbench(id),
    refetchInterval: (q) => (generating || q.state.data?.site?.task_status === 'running' ? 3000 : false),
  })
  const siteTask = bench.data?.site?.task_status
  useEffect(() => {
    if (generating && siteTask && siteTask !== 'running') setGenerating(false)
  }, [generating, siteTask])
  const [form, setForm] = useState({ plan_key: 'growth', ends_at: '', amount: '', note: '' })
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }))
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['ops-customer', id] })
    void queryClient.invalidateQueries({ queryKey: ['ops-workbench', id] })
    void queryClient.invalidateQueries({ queryKey: ['ops-customers'] })
  }
  const joined = Boolean(detail.data?.customer.operator_joined)
  /** 进入企业（如未进入）并切换为当前企业，然后跳转到代操作工具页。 */
  async function operate(path: string) {
    try {
      if (!joined) {
        await opsApi.join(id)
        await session.refresh()
        refresh()
      }
      session.selectCompany(id)
      navigate(path)
    } catch (error) {
      showError(error)
    }
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
  const generate = useMutation({
    mutationFn: async () => {
      if (!joined) {
        await opsApi.join(id)
        await session.refresh()
      }
      session.selectCompany(id)
      return siteApi.generate()
    },
    onSuccess: () => {
      setGenerating(true)
      refresh()
    },
    onError: showError,
  })
  const requestReview = useMutation({
    mutationFn: () => serviceApi.requestReview(id),
    onSuccess: (data) => {
      queryClient.setQueryData(['ops-workbench', id], data)
      refresh()
      toast.show(t.ops.wbSentReview)
    },
    onError: showError,
  })
  const startBuyers = useMutation({
    mutationFn: () => serviceApi.startBuyers(id),
    onSuccess: (data) => {
      queryClient.setQueryData(['ops-workbench', id], data)
      refresh()
      toast.show(t.ops.wbBuyersStarted)
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
      <QueryView query={bench}>
        {(wb) => {
          const label = (key: string) => wb.categories.find((c) => c.key === key)?.label ?? key
          const running = generating || wb.site?.task_status === 'running'
          return (
            <div className="split">
              <div className="stack-lg">
                <Card>
                  <CardHeader description={`${t.ops.stages[wb.stage] ?? wb.stage} · ${t.ops.waiting[wb.waiting_on]}`} title={t.ops.wbSteps} />
                  <ol className="wb-steps">
                    {wb.steps.map((s, i) => (
                      <li className={cx('wb-steps__item', s.done && 'is-done')} key={s.key}>
                        <span aria-hidden className="wb-steps__dot">{s.done ? <Check size={14} /> : i + 1}</span>
                        <span>{s.label}</span>
                        <span className="sr-only">{s.done ? t.ops.wbStepDone : t.ops.wbStepTodo}</span>
                      </li>
                    ))}
                  </ol>
                </Card>

                <Card data-step="materials">
                  <CardHeader
                    description={wb.missing.length ? t.ops.wbMissing(wb.missing.map(label).join('、')) : t.ops.wbAllMaterials}
                    title={`1. ${t.ops.wbMaterials}`}
                  />
                  <KeyValue items={wb.categories.map((c) => ({ label: c.label, value: String(wb.materials[c.key] ?? 0) }))} />
                  <KeyValue
                    items={[
                      { label: t.ops.wbStyle, value: wb.style_choice ? styleLabel(wb.style_choice) : '—' },
                      { label: t.ops.wbLinks, value: wb.links.length ? wb.links.map((l) => <ExternalText key={l} url={l} />) : '—' },
                      { label: t.ops.wbNote, value: wb.note || '—' },
                    ]}
                  />
                  <div className="row-wrap">
                    <Button onClick={() => void operate('/me/assets')} size="sm" variant="secondary">
                      {t.ops.wbMaterials}
                    </Button>
                  </div>
                </Card>

                <Card data-step="organize">
                  <CardHeader description={t.ops.wbOrganizeDesc(wb.completeness, wb.products)} title={`2. ${t.ops.wbOrganize}`} />
                  <div className="row-wrap">
                    <Button onClick={() => void operate('/onboarding/files')} size="sm" variant="primary">
                      {t.ops.wbOrganizeAction}
                    </Button>
                    <Button onClick={() => void operate('/me/profile')} size="sm" variant="secondary">
                      {t.ops.wbOrganizeManual}
                    </Button>
                  </div>
                </Card>

                <Card data-step="site">
                  <CardHeader
                    description={running ? t.ops.wbTaskBusy : wb.site?.task_error || (wb.site?.has_draft ? undefined : t.ops.wbSiteNone)}
                    title={`3. ${t.ops.wbSite}`}
                  />
                  <div className="row-wrap">
                    <Button disabled={running} loading={generate.isPending || running} onClick={() => generate.mutate()} size="sm" variant={wb.site?.has_draft ? 'secondary' : 'primary'}>
                      {wb.site?.has_draft ? t.ops.wbRegenerate : t.ops.wbGenerate}
                    </Button>
                    {wb.site?.has_draft ? (
                      <>
                        <Button onClick={() => void operate('/site/preview')} size="sm" variant="secondary">
                          {t.ops.wbPreview}
                        </Button>
                        <Button onClick={() => void operate('/site')} size="sm" variant="ghost">
                          {t.ops.wbEditSite}
                        </Button>
                      </>
                    ) : null}
                  </div>
                  <StyleEditor companyId={id} style={wb.site?.style} />
                </Card>

                <Card data-step="review">
                  <CardHeader title={`4. ${t.ops.wbSendReview}`} description={wb.stage === 'review' ? t.ops.stages.review : undefined} />
                  <Button disabled={!wb.site?.has_draft} loading={requestReview.isPending} onClick={() => requestReview.mutate()} size="sm" variant="primary">
                    {t.ops.wbSendReview}
                  </Button>
                </Card>

                <Card data-step="buyers">
                  <CardHeader description={t.ops.wbBuyersStat(wb.leads_pending, wb.leads_approved)} title={`5. ${t.ops.wbBuyers}`} />
                  <div className="row-wrap">
                    <Button disabled={wb.watch_active} loading={startBuyers.isPending} onClick={() => startBuyers.mutate()} size="sm" variant={wb.watch_active ? 'secondary' : 'primary'}>
                      {wb.watch_active ? t.ops.wbBuyersStarted : t.ops.wbStartBuyers}
                    </Button>
                    <Button onClick={() => navigate('/ops/review')} size="sm" variant="secondary">
                      {t.ops.wbReviewBuyers}
                    </Button>
                    <Button onClick={() => void operate('/me/watches')} size="sm" variant="ghost">
                      {t.ops.toolLeads}
                    </Button>
                  </div>
                </Card>

                <ListGroup title={t.ops.wbTasks}>
                  {wb.tasks.length ? (
                    wb.tasks.map((task) => <TaskRow key={task.id} task={task} />)
                  ) : (
                    <ListRow title={t.ops.tasksEmpty} />
                  )}
                </ListGroup>
              </div>
              <aside className="split__side">
                <Card>
                  <CardHeader title={t.ops.operate} />
                  <div className="stack">
                    {joined ? (
                      <>
                        <Button block onClick={() => void operate('/home')} variant="primary">
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
                {detail.data ? (
                  <Card>
                    <CardHeader description={t.ops.customerMeta(detail.data.customer)} title={detail.data.usage.plan.name} />
                    <KeyValue items={detail.data.usage.usage.map((u) => ({ label: u.label, value: usageText(u) }))} />
                  </Card>
                ) : null}
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
                {detail.data ? (
                  <ListGroup title={t.ops.audit}>
                    {detail.data.recent_audit.length ? (
                      detail.data.recent_audit.slice(0, 8).map((a) => <ListRow key={a.id} subtitle={a.on_behalf ? t.ops.onBehalf : a.target_type || undefined} title={a.action} value={shortTime(a.created_at)} />)
                    ) : (
                      <ListRow title="—" />
                    )}
                  </ListGroup>
                ) : null}
              </aside>
            </div>
          )
        }}
      </QueryView>
    </OpsPage>
  )
}

function ExternalText({ url }: { url: string }) {
  const safe = /^https?:\/\//i.test(url) ? url : null
  return safe ? (
    <a className="block-link" href={safe} rel="noopener noreferrer" target="_blank">
      {url}
    </a>
  ) : (
    <span>{url}</span>
  )
}

function StyleEditor({ companyId, style }: { companyId: string; style?: Partial<SiteStyle> }) {
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const catalog = useQuery({ queryKey: ['site-styles'], queryFn: serviceApi.styles, staleTime: Infinity })
  const [draft, setDraft] = useState<SiteStyle | null>(null)
  useEffect(() => {
    if (catalog.data && !draft) {
      const layout = (style?.layout ?? catalog.data.layouts[0]?.key ?? 'precision') as Layout
      const preset = catalog.data.layouts.find((l) => l.key === layout)
      setDraft({
        layout,
        palette: { primary: style?.palette?.primary ?? preset?.primary ?? '#0f4c81', accent: style?.palette?.accent ?? preset?.accent ?? '#00a3e0' },
        font: style?.font ?? 'sans',
        radius: style?.radius ?? 'small',
        image: style?.image ?? 'plain',
      })
    }
  }, [catalog.data, draft, style])
  const save = useMutation({
    mutationFn: (s: SiteStyle) => serviceApi.setStyle(companyId, { layout: s.layout, primary: s.palette.primary, accent: s.palette.accent, font: s.font, radius: s.radius, image: s.image }),
    onSuccess: (data) => {
      queryClient.setQueryData(['ops-workbench', companyId], data)
      void queryClient.invalidateQueries({ queryKey: ['site-preview'] })
      toast.show(t.ops.wbStyleSaved)
    },
    onError: showError,
  })
  if (!catalog.data || !draft) return null
  const update = (patch: Partial<SiteStyle>) => setDraft({ ...draft, ...patch })
  return (
    <div className="style-editor">
      <p className="style-editor__title">{t.ops.wbStyleTitle}</p>
      <div className="style-editor__grid">
        <Select
          label={t.ops.wbLayout}
          onChange={(v) => {
            const preset = catalog.data?.layouts.find((l) => l.key === v)
            update({ layout: v as Layout, palette: preset ? { primary: preset.primary, accent: preset.accent } : draft.palette })
          }}
          options={catalog.data.layouts.map((l) => ({ value: l.key, label: l.label }))}
          value={draft.layout}
        />
        <label className="color-field">
          <span>{t.ops.wbPrimary}</span>
          <input onChange={(e) => update({ palette: { ...draft.palette, primary: e.target.value } })} type="color" value={draft.palette.primary} />
        </label>
        <label className="color-field">
          <span>{t.ops.wbAccent}</span>
          <input onChange={(e) => update({ palette: { ...draft.palette, accent: e.target.value } })} type="color" value={draft.palette.accent} />
        </label>
        <Select label={t.ops.wbFont} onChange={(v) => update({ font: v as SiteStyle['font'] })} options={catalog.data.fonts.map((f) => ({ value: f, label: t.ops.fonts[f] ?? f }))} value={draft.font} />
        <Select label={t.ops.wbRadius} onChange={(v) => update({ radius: v as SiteStyle['radius'] })} options={catalog.data.radii.map((r) => ({ value: r, label: t.ops.radii[r] ?? r }))} value={draft.radius} />
        <Select label={t.ops.wbImage} onChange={(v) => update({ image: v as SiteStyle['image'] })} options={catalog.data.images.map((i) => ({ value: i, label: t.ops.images[i] ?? i }))} value={draft.image} />
      </div>
      <Button loading={save.isPending} onClick={() => save.mutate(draft)} size="sm" variant="secondary">
        {t.ops.wbSaveStyle}
      </Button>
    </div>
  )
}

function TaskRow({ task, showCompany }: { task: ServiceTask; showCompany?: boolean }) {
  const navigate = useNavigate()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: (status: ServiceTask['status']) => serviceApi.updateTask(task.id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops-tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['ops-workbench', task.company_id] })
      void queryClient.invalidateQueries({ queryKey: ['ops-customers'] })
    },
    onError: showError,
  })
  const open = task.status === 'open' || task.status === 'doing'
  return (
    <div className="task-row" data-task-id={task.id} data-status={task.status}>
      <div className="task-row__main">
        <div className="task-row__title">
          <Tag tone={task.kind === 'revise_site' ? 'warning' : 'accent'}>{task.kind_label}</Tag>
          {showCompany ? (
            <button className="link-button" onClick={() => navigate(`/ops/customers/${task.company_id}`)} type="button">
              {task.company_name}
            </button>
          ) : null}
          {task.status === 'doing' ? <Tag>{t.ops.taskDoing}</Tag> : null}
        </div>
        {task.note ? <p className="task-row__note">{task.note}</p> : null}
        <p className="task-row__meta">{t.ops.taskAge(shortTime(task.created_at))}{task.asset_ids.length ? ` · 附图 ${task.asset_ids.length} 张` : ''}</p>
      </div>
      <div className="task-row__actions">
        {open ? (
          <>
            {task.status === 'open' ? (
              <Button loading={update.isPending} onClick={() => update.mutate('doing')} size="sm" variant="secondary">
                {t.ops.taskStart}
              </Button>
            ) : null}
            <Button loading={update.isPending} onClick={() => update.mutate('done')} size="sm" variant="primary">
              {t.ops.taskFinish}
            </Button>
          </>
        ) : (
          <Button loading={update.isPending} onClick={() => update.mutate('open')} size="sm" variant="ghost">
            {t.ops.taskReopen}
          </Button>
        )}
      </div>
    </div>
  )
}

// ── 待办任务 ───────────────────────────────────────────────────────────

export function OpsTasksPage() {
  const [tab, setTab] = useState<'open' | 'done'>('open')
  const tasks = useQuery({ queryKey: ['ops-tasks', tab], queryFn: () => serviceApi.tasks(tab) })
  return (
    <OpsPage
      title={t.ops.tasks}
      toolbar={<Tabs items={[{ value: 'open', label: t.ops.taskTabs.open }, { value: 'done', label: t.ops.taskTabs.done }]} label={t.ops.tasks} onChange={setTab} value={tab} variant="underline" />}
    >
      <QueryView empty={{ title: t.ops.tasksEmpty, desc: t.ops.tasksEmptyDesc, icon: ListChecks }} isEmpty={(rows) => rows.length === 0} query={tasks}>
        {(rows) => (
          <div className="task-list">
            {rows.map((task) => (
              <TaskRow key={task.id} showCompany task={task} />
            ))}
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
      <QueryView empty={{ title: t.ops.noDataRequests, desc: t.ops.noDataRequestsDesc, icon: UserX }} isEmpty={(rows) => rows.length === 0} query={requests}>
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
