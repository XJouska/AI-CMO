// 「我的」中的：套餐与用量、通知列表、通知设置、账号安全、数据与隐私；公开的隐私政策 / 用户协议 / 联系人删除请求页。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCircle2, Download, FileJson, FileSpreadsheet, FileText, Settings2, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MarkdownText as PolicyMarkdown } from '@/assistant/MarkdownText'
import { QueryView } from '@/components/QueryView'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { SettingsPage } from '@/layout/SettingsPage'
import { api } from '@/api/endpoints'
import { isEmail, passwordProblem } from '@/lib/validation'
import { billingApi, complianceApi, notificationsApi, usageText, yuan, type PrefsOut } from '@/ops/api'
import { shortTime } from '@/outreach/api'
import { useSession } from '@/session/session'
import { Button, Card, CardHeader, ConfirmDialog, cx, ListGroup, ListRow, PasswordField, Progress, Quote, Switch, Tag, Text, TextArea, TextField, useToast } from '@/ui'

// ── 套餐与用量 ─────────────────────────────────────────────────────────

export function BillingPage() {
  const session = useSession()
  const usage = useQuery({ queryKey: ['billing-usage', session.company?.id], queryFn: billingApi.usage })
  const plans = useQuery({ queryKey: ['billing-plans'], queryFn: billingApi.plans })
  const invoices = useQuery({ queryKey: ['billing-invoices', session.company?.id], queryFn: billingApi.invoices })
  return (
    <SettingsPage title={t.billing.title}>
      <QueryView query={usage}>
        {(data) => (
          <div className="stack-lg">
            <Card padding="lg">
              <CardHeader
                actions={<Tag tone={data.status === 'active' ? 'success' : 'danger'}>{t.billing.status[data.status]}</Tag>}
                description={data.ends_at ? t.billing.validUntil(data.ends_at.slice(0, 10)) : data.plan.description}
                title={data.plan.name}
              />
              <div className="usage-grid">
                {data.usage.map((item) => {
                  const full = item.limit >= 0 && item.used >= item.limit
                  return (
                    <div className={cx('usage-item', full && 'is-full')} data-full={full || undefined} data-kind={item.kind} key={item.kind}>
                      <div className="row-between">
                        <span>{item.label}</span>
                        <span className="usage-item__value">{usageText(item)}</span>
                      </div>
                      {item.limit > 0 ? <Progress label={item.label} value={(item.used / item.limit) * 100} /> : null}
                    </div>
                  )
                })}
              </div>
            </Card>

            {plans.data?.length ? (
              <section>
                <div className="ui-section-title">
                  <h2>{t.billing.plansTitle}</h2>
                </div>
                <div className="grid-3 plan-grid">
                  {plans.data.map((plan) => {
                    const current = plan.key === data.plan.key
                    return (
                      <Card className={cx('plan-card', current && 'is-current')} key={plan.key}>
                        <div className="row-between">
                          <strong>{plan.name}</strong>
                          {current ? <Tag icon={CheckCircle2} tone="accent">{t.assistant.current}</Tag> : null}
                        </div>
                        <div className="plan-card__price">{`${yuan(plan.price_cents)} ${plan.period === 'year' ? t.billing.perYear : t.billing.perMonth}`}</div>
                        <p className="secondary small">{[plan.description, plan.setup_fee_cents ? t.billing.setupFee(yuan(plan.setup_fee_cents)) : ''].filter(Boolean).join(' · ')}</p>
                      </Card>
                    )
                  })}
                </div>
              </section>
            ) : null}

            <Quote tone="accent">{`${t.billing.contact}。${t.billing.contactDesc}`}</Quote>

            {invoices.data?.length ? (
              <ListGroup title={t.billing.invoicesTitle}>
                {invoices.data.map((inv) => (
                  <ListRow
                    icon={FileText}
                    key={inv.id}
                    subtitle={[inv.period_start, inv.period_end].filter(Boolean).join(' – ') || inv.created_at.slice(0, 10)}
                    title={inv.number}
                    value={`${yuan(inv.amount_cents)} · ${t.billing.invoiceStatus[inv.status]}`}
                  />
                ))}
              </ListGroup>
            ) : null}
          </div>
        )}
      </QueryView>
    </SettingsPage>
  )
}

// ── 通知列表 ───────────────────────────────────────────────────────────

export function NotificationsPage() {
  const navigate = useNavigate()
  const session = useSession()
  const queryClient = useQueryClient()
  const list = useQuery({ queryKey: ['notifications', session.company?.id], queryFn: notificationsApi.list })
  const open = async (id: string, link: string) => {
    await notificationsApi.read(id).catch(() => undefined)
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    // 只允许站内相对路径
    if (link.startsWith('/') && !link.startsWith('//')) navigate(link)
  }
  return (
    <SettingsPage
      actions={
        <Button icon={Settings2} onClick={() => navigate('/me/notifications/settings')} variant="outline">
          {t.notifications.settingsEntry}
        </Button>
      }
      title={t.notifications.title}
    >
      <QueryView empty={{ title: t.notifications.empty, desc: t.notifications.emptyDesc, icon: Bell }} isEmpty={(items) => items.length === 0} query={list}>
        {(items) => (
          <div className="ui-list notification-list">
            {items.map((n) => (
              <ListRow
                data={{ 'notification-id': n.id, read: n.read || undefined }}
                dot={!n.read}
                key={n.id}
                onClick={() => void open(n.id, n.link)}
                subtitle={n.body || undefined}
                title={n.title}
                value={shortTime(n.created_at)}
              />
            ))}
          </div>
        )}
      </QueryView>
    </SettingsPage>
  )
}

// ── 通知设置 ───────────────────────────────────────────────────────────

export function NotificationSettingsPage() {
  const session = useSession()
  const prefs = useQuery({ queryKey: ['notification-prefs', session.company?.id], queryFn: notificationsApi.prefs })
  return (
    <SettingsPage back="/me/notifications" title={t.notifications.settingsTitle}>
      <QueryView query={prefs}>{(data) => <PrefsEditor data={data} />}</QueryView>
    </SettingsPage>
  )
}

function PrefsEditor({ data }: { data: PrefsOut }) {
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const session = useSession()
  const [webhook, setWebhook] = useState('')
  const canManage = session.company?.role === 'owner' || session.company?.role === 'operator'
  const apply = (next: PrefsOut) => queryClient.setQueryData(['notification-prefs', session.company?.id], next)
  const toggle = useMutation({
    mutationFn: (v: { group: string; channel: 'email' | 'wecom'; enabled: boolean }) => notificationsApi.setPref(v.group, v.channel, v.enabled),
    onSuccess: apply,
    onError: showError,
  })
  const wecom = useMutation({
    mutationFn: (url: string) => notificationsApi.setWecom(url),
    onSuccess: (next, url) => {
      apply(next)
      setWebhook('')
      toast.show(url ? t.notifications.wecomSaved : t.notifications.wecomRemoved)
    },
    onError: showError,
  })
  const channels: ('email' | 'wecom')[] = data.wecom_configured ? ['email', 'wecom'] : ['email']
  return (
    <div className="stack-lg">
      <Text tone="secondary">{t.notifications.emailHint(data.email)}</Text>
      {channels.map((channel) => {
        const channelLabel = channel === 'email' ? t.notifications.email : t.notifications.wecom
        return (
          <section data-channel={channel} key={channel}>
            <ListGroup title={channelLabel}>
              {data.groups.map((group) => (
                <ListRow
                  data={{ group: group.key }}
                  key={group.key}
                  title={group.label}
                  trailing={
                    <Switch
                      checked={group[channel]}
                      disabled={toggle.isPending}
                      label={`${group.label} · ${channelLabel}`}
                      onChange={(enabled) => toggle.mutate({ group: group.key, channel, enabled })}
                    />
                  }
                />
              ))}
            </ListGroup>
          </section>
        )
      })}
      {canManage ? (
        <Card>
          <CardHeader
            actions={<Tag tone={data.wecom_configured ? 'success' : 'neutral'}>{data.wecom_configured ? t.notifications.wecomConfigured : t.notifications.wecomNotConfigured}</Tag>}
            title={t.notifications.wecomTitle}
          />
          <div className="stack">
            <TextField label={t.notifications.wecomLabel} maxLength={300} onChange={setWebhook} placeholder={t.notifications.wecomPlaceholder} value={webhook} />
            <div className="ui-form-actions">
              {data.wecom_configured ? (
                <Button disabled={wecom.isPending} onClick={() => wecom.mutate('')} variant="danger-ghost">
                  {t.notifications.wecomRemove}
                </Button>
              ) : null}
              <Button disabled={!webhook.trim()} loading={wecom.isPending} onClick={() => wecom.mutate(webhook.trim())} variant="primary">
                {t.common.save}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  )
}

// ── 数据与隐私 ─────────────────────────────────────────────────────────

export function PrivacySettingsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const showError = useErrorToast()
  const session = useSession()
  const [confirming, setConfirming] = useState(false)
  const [name, setName] = useState('')
  const company = session.company
  const owner = company?.role === 'owner'
  const exporter = useMutation({ mutationFn: complianceApi.download, onError: showError })
  const remove = useMutation({
    mutationFn: () => complianceApi.deleteCompany(name.trim()),
    onSuccess: async () => {
      toast.show(t.privacy.deleted)
      await session.refresh()
      navigate('/me', { replace: true })
    },
    onError: showError,
  })
  const nameMatches = Boolean(company) && name.trim() === company?.name_cn
  return (
    <SettingsPage title={t.privacy.dataTitle}>
      <div className="stack-lg">
        {owner || company?.role === 'operator' ? (
          <ListGroup title={t.privacy.exportTitle}>
            <ListRow icon={FileJson} onClick={() => !exporter.isPending && exporter.mutate('json')} title={t.privacy.exportJson} trailing={exporter.isPending ? <Tag>{t.privacy.exporting}</Tag> : <Download aria-hidden size={16} />} chevron={false} />
            <ListRow icon={FileSpreadsheet} onClick={() => !exporter.isPending && exporter.mutate('csv')} title={t.privacy.exportCsv} trailing={<Download aria-hidden size={16} />} chevron={false} />
          </ListGroup>
        ) : null}
        <ListGroup title={t.privacy.policiesTitle}>
          <ListRow onClick={() => navigate('/privacy')} title={t.privacy.privacyPolicy} />
          <ListRow onClick={() => navigate('/terms')} title={t.privacy.terms} />
        </ListGroup>
        {owner && company ? (
          <Card className="danger-zone">
            <CardHeader description={t.privacy.deleteDesc} icon={ShieldAlert} title={t.privacy.deleteTitle} />
            <div className="stack">
              <TextField label={t.privacy.deleteLabel(company.name_cn)} maxLength={100} onChange={setName} placeholder={company.name_cn} value={name} />
              <div className="ui-form-actions">
                <Button disabled={!nameMatches} loading={remove.isPending} onClick={() => nameMatches && setConfirming(true)} variant="danger">
                  {t.privacy.deleteTitle}
                </Button>
              </div>
            </div>
            <ConfirmDialog
              body={t.privacy.deleteDesc}
              cancelLabel={t.common.cancel}
              confirmLabel={t.privacy.deleteConfirm}
              danger
              onCancel={() => setConfirming(false)}
              onConfirm={() => {
                setConfirming(false)
                remove.mutate()
              }}
              open={confirming}
              title={t.privacy.deleteTitle}
            />
          </Card>
        ) : null}
      </div>
    </SettingsPage>
  )
}

// ── 账号安全 ───────────────────────────────────────────────────────────

export function SecurityPage() {
  const toast = useToast()
  const showError = useErrorToast()
  const session = useSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const mismatch = confirm !== '' && confirm !== next
  const complete = current !== '' && next !== '' && confirm !== '' && !mismatch
  const change = useMutation({
    mutationFn: () => api.changePassword({ current_password: current, new_password: next }),
    onSuccess: () => {
      setCurrent('')
      setNext('')
      setConfirm('')
      toast.show(t.security.changed)
    },
    onError: showError,
  })
  function submit() {
    if (!complete || change.isPending) return
    const problem = passwordProblem(next)
    if (problem === 'tooShort') return toast.show(t.auth.passwordTooShort)
    if (problem === 'needMix') return toast.show(t.auth.passwordNeedMix)
    change.mutate()
  }
  return (
    <SettingsPage description={t.security.desc} title={t.security.title} width="narrow">
      <Card padding="lg">
        <form
          className="ui-form-stack"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <TextField autoComplete="username" disabled label={t.security.account} onChange={() => {}} value={session.user?.email ?? ''} />
          <PasswordField autoComplete="current-password" label={t.security.current} maxLength={128} onChange={setCurrent} value={current} />
          <PasswordField autoComplete="new-password" hint={t.auth.newPasswordPlaceholder} label={t.security.newPassword} maxLength={128} onChange={setNext} value={next} />
          <PasswordField autoComplete="new-password" error={mismatch ? t.security.mismatch : undefined} label={t.security.confirm} maxLength={128} onChange={setConfirm} value={confirm} />
          <div className="ui-form-actions">
            <Button disabled={!complete} loading={change.isPending} type="submit" variant="primary">
              {t.security.submit}
            </Button>
          </div>
        </form>
      </Card>
    </SettingsPage>
  )
}

// ── 公开页面 ───────────────────────────────────────────────────────────

const PRIVACY_MD = `### 隐私政策

更新日期：2026-10-28

#### 我们收集的信息

1. 账号信息：邮箱、称呼、登录记录（IP 只保存不可逆的哈希值）
2. 企业资料：你主动填写或上传的企业档案、产品、资质文件与图片
3. 业务数据：官网内容、询盘、商机、跟进记录、开发信
4. 公开商业信息：从公开招标网站、公开网页中整理的采购需求与企业公开联系方式

#### 我们如何使用

1. 为你生成官网、筛选海外商机、撰写开发信
2. 统计用量用于套餐计费；不出售任何个人信息
3. 发信邮箱的密码 / 授权码加密保存，仅用于你确认后的代发

#### 你的权利

1. 在「我的 → 数据与隐私」导出全部企业数据，或注销企业（数据永久删除）
2. 被我们整理了公开联系方式的个人，可以在 /data-request 提交删除请求
3. 所有营销邮件都附有退订链接

#### 数据保留

登录记录 30 天；任务与数据源请求记录 30–90 天；用量记录 400 天；审计日志长期保留且不含明文个人信息。`

const TERMS_MD = `### 用户协议

更新日期：2026-10-28

1. 你应保证提交的企业资料真实、有权使用，不包含他人的商业秘密
2. AI 生成的官网与开发信发布或发送前须经你确认；平台会提示可能与档案不一致的内容，但最终内容由你负责
3. 不得利用平台发送垃圾邮件、冒充他人或从事违法活动；我们有权暂停违规账号
4. 套餐按签约内容提供，用量超出限额时相应功能暂停，续费或升级后恢复
5. 商机信息来自公开渠道，平台不保证每一条商机都能成交`

export function PolicyPage({ kind }: { kind: 'privacy' | 'terms' }) {
  return (
    <div className="site-container legal">
      <article className="legal__body">
        <PolicyMarkdown text={kind === 'privacy' ? PRIVACY_MD : TERMS_MD} />
        {kind === 'privacy' ? (
          <p>
            <Link to="/data-request">{t.privacy.erasureTitle}</Link>
          </p>
        ) : null}
      </article>
    </div>
  )
}

export function DataRequestPage() {
  const toast = useToast()
  const showError = useErrorToast()
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [done, setDone] = useState(false)
  const submit = useMutation({
    mutationFn: () => complianceApi.requestErasure(email.trim(), note.trim()),
    onSuccess: () => {
      setDone(true)
      toast.show(t.privacy.erasureDone)
    },
    onError: showError,
  })
  const valid = isEmail(email.trim())
  return (
    <div className="site-container legal">
      <Card className="legal__form" padding="lg">
        <div className="stack">
          <h1 className="ui-h ui-h2">{t.privacy.erasureTitle}</h1>
          <Text tone="secondary">{done ? t.privacy.erasureDone : t.privacy.erasureDesc}</Text>
          {!done ? (
            <form
              className="ui-form-stack"
              onSubmit={(event) => {
                event.preventDefault()
                if (valid && !submit.isPending) submit.mutate()
              }}
            >
              <TextField inputMode="email" label={t.privacy.erasureEmail} maxLength={254} onChange={setEmail} placeholder="name@company.com" value={email} />
              <TextArea label={t.privacy.erasureNote} maxLength={1000} onChange={setNote} placeholder={t.privacy.erasureNote} value={note} />
              <Button disabled={!valid} loading={submit.isPending} size="lg" type="submit" variant="primary">
                {t.privacy.erasureSubmit}
              </Button>
            </form>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
