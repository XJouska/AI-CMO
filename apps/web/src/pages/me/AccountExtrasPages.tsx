// 「我的」中的：套餐与用量、通知列表、通知设置、数据与隐私；公开的隐私政策 / 用户协议 / 联系人删除请求页。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, FormDoubleLine, FormSingleLine, ListSectionTitle, Markdown, SettingsFullWidthItem, Switch } from '@yb/generated/components'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MarkdownText as PolicyMarkdown } from '@/assistant/MarkdownText'
import { QueryView } from '@/components/local/QueryView'
import { StackPage } from '@/components/local/StackPage'
import { ConfirmDialog } from '@/feedback/overlays'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { isEmail } from '@/lib/validation'
import { billingApi, complianceApi, notificationsApi, usageText, yuan, type PrefsOut } from '@/ops/api'
import { shortTime } from '@/outreach/api'
import { useSession } from '@/session/session'

// ── 套餐与用量 ─────────────────────────────────────────────────────────

export function BillingPage() {
  const session = useSession()
  const usage = useQuery({ queryKey: ['billing-usage', session.company?.id], queryFn: billingApi.usage })
  const plans = useQuery({ queryKey: ['billing-plans'], queryFn: billingApi.plans })
  const invoices = useQuery({ queryKey: ['billing-invoices', session.company?.id], queryFn: billingApi.invoices })
  return (
    <StackPage backTo="/me" title={t.billing.title}>
      <QueryView query={usage}>
        {(data) => (
          <>
            <ListSectionTitle>{t.billing.current}</ListSectionTitle>
            <SettingsFullWidthItem
              subtitle={data.ends_at ? t.billing.validUntil(data.ends_at.slice(0, 10)) : data.plan.description}
              trailing={t.billing.status[data.status]}
              trailingKind="none"
              type="双行列表-常规"
            >
              {data.plan.name}
            </SettingsFullWidthItem>
            <ListSectionTitle>{t.billing.usageTitle}</ListSectionTitle>
            {data.usage.map((item) => (
              <div className="usage-row" data-kind={item.kind} data-full={item.limit >= 0 && item.used >= item.limit ? true : undefined} key={item.kind}>
                <SettingsFullWidthItem showDot={item.limit > 0 && item.used >= item.limit} trailing={usageText(item)} trailingKind="none" type="单行列表-常规">
                  {item.label}
                </SettingsFullWidthItem>
              </div>
            ))}
            {plans.data?.length ? (
              <>
                <ListSectionTitle>{t.billing.plansTitle}</ListSectionTitle>
                {plans.data.map((plan) => (
                  <SettingsFullWidthItem
                    key={plan.key}
                    subtitle={[plan.description, plan.setup_fee_cents ? t.billing.setupFee(yuan(plan.setup_fee_cents)) : ''].filter(Boolean).join(' · ')}
                    trailing={`${yuan(plan.price_cents)} ${plan.period === 'year' ? t.billing.perYear : t.billing.perMonth}`}
                    trailingKind="none"
                    type="双行列表-常规"
                  >
                    {plan.key === data.plan.key ? `${plan.name} ✓` : plan.name}
                  </SettingsFullWidthItem>
                ))}
              </>
            ) : null}
            <div className="content-inset">
              <Markdown quoteText={<p>{`${t.billing.contact}。${t.billing.contactDesc}`}</p>} variant="Quote" />
            </div>
            {invoices.data?.length ? (
              <>
                <ListSectionTitle>{t.billing.invoicesTitle}</ListSectionTitle>
                {invoices.data.map((inv) => (
                  <SettingsFullWidthItem
                    key={inv.id}
                    subtitle={[inv.period_start, inv.period_end].filter(Boolean).join(' – ') || inv.created_at.slice(0, 10)}
                    trailing={`${yuan(inv.amount_cents)} · ${t.billing.invoiceStatus[inv.status]}`}
                    trailingKind="none"
                    type="双行列表-常规"
                  >
                    {inv.number}
                  </SettingsFullWidthItem>
                ))}
              </>
            ) : null}
          </>
        )}
      </QueryView>
    </StackPage>
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
    <StackPage
      backTo="/me"
      right={
        <Button onAction={(a) => a === 'press' && navigate('/me/notifications/settings')} size="S" type="Text">
          {t.notifications.settingsEntry}
        </Button>
      }
      title={t.notifications.title}
    >
      <QueryView empty={{ title: t.notifications.empty, desc: t.notifications.emptyDesc }} isEmpty={(items) => items.length === 0} query={list}>
        {(items) => (
          <div className="notification-list">
            {items.map((n) => (
              <div data-notification-id={n.id} data-read={n.read || undefined} key={n.id}>
                <SettingsFullWidthItem
                  onAction={(a) => a === 'open' && void open(n.id, n.link)}
                  showDot={!n.read}
                  subtitle={n.body || ' '}
                  trailing={shortTime(n.created_at)}
                  trailingKind="chevron"
                  type="双行列表-常规"
                >
                  {n.title}
                </SettingsFullWidthItem>
              </div>
            ))}
          </div>
        )}
      </QueryView>
    </StackPage>
  )
}

// ── 通知设置 ───────────────────────────────────────────────────────────

export function NotificationSettingsPage() {
  const session = useSession()
  const prefs = useQuery({ queryKey: ['notification-prefs', session.company?.id], queryFn: notificationsApi.prefs })
  return (
    <StackPage backTo="/me/notifications" title={t.notifications.settingsTitle}>
      <QueryView query={prefs}>{(data) => <PrefsEditor data={data} />}</QueryView>
    </StackPage>
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
    <>
      <div className="content-inset">
        <Markdown variant="Body">
          <p>{t.notifications.emailHint(data.email)}</p>
        </Markdown>
      </div>
      {channels.map((channel) => (
        <section data-channel={channel} key={channel}>
          <ListSectionTitle>{channel === 'email' ? t.notifications.email : t.notifications.wecom}</ListSectionTitle>
          {data.groups.map((group) => (
            <div className="pref-row" data-group={group.key} key={group.key}>
              <SettingsFullWidthItem trailing=" " trailingKind="none" type="单行列表-常规">
                {group.label}
              </SettingsFullWidthItem>
              <span className="pref-switch" aria-label={`${group.label} · ${channel === 'email' ? t.notifications.email : t.notifications.wecom}`}>
                <Switch
                  disabled={toggle.isPending ? 'true' : 'false'}
                  onAction={(a) => a === 'toggle' && !toggle.isPending && toggle.mutate({ group: group.key, channel, enabled: !group[channel] })}
                  turnOn={group[channel] ? 'true' : 'false'}
                />
              </span>
            </div>
          ))}
        </section>
      ))}
      {canManage ? (
        <section>
          <ListSectionTitle>{t.notifications.wecomTitle}</ListSectionTitle>
          <SettingsFullWidthItem trailing={data.wecom_configured ? t.notifications.wecomConfigured : t.notifications.wecomNotConfigured} trailingKind="none" type="单行列表-常规">
            {t.notifications.wecom}
          </SettingsFullWidthItem>
          <div className="form-stack">
            <FormSingleLine align="left" label={t.notifications.wecomLabel} maxLength={300} onChange={setWebhook} placeholder={t.notifications.wecomPlaceholder} value={webhook} />
            <div className="form-actions">
              <Button onAction={(a) => a === 'press' && webhook.trim() && !wecom.isPending && wecom.mutate(webhook.trim())} size="M" state={webhook.trim() && !wecom.isPending ? 'Default' : 'Disable'} type="Secondary">
                {t.common.save}
              </Button>
              {data.wecom_configured ? (
                <Button onAction={(a) => a === 'press' && !wecom.isPending && wecom.mutate('')} size="M" type="Text">
                  {t.notifications.wecomRemove}
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </>
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
  return (
    <StackPage backTo="/me" title={t.privacy.dataTitle}>
      {owner || company?.role === 'operator' ? (
        <>
          <SettingsFullWidthItem onAction={(a) => a === 'open' && !exporter.isPending && exporter.mutate('json')} trailing={exporter.isPending ? t.privacy.exporting : ' '} trailingKind="chevron" type="单行列表-常规">
            {t.privacy.exportJson}
          </SettingsFullWidthItem>
          <SettingsFullWidthItem onAction={(a) => a === 'open' && !exporter.isPending && exporter.mutate('csv')} trailing=" " trailingKind="chevron" type="单行列表-常规">
            {t.privacy.exportCsv}
          </SettingsFullWidthItem>
        </>
      ) : null}
      <SettingsFullWidthItem onAction={(a) => a === 'open' && navigate('/privacy')} trailing=" " trailingKind="chevron" type="单行列表-常规">
        {t.privacy.privacyPolicy}
      </SettingsFullWidthItem>
      <SettingsFullWidthItem onAction={(a) => a === 'open' && navigate('/terms')} trailing=" " trailingKind="chevron" type="单行列表-常规">
        {t.privacy.terms}
      </SettingsFullWidthItem>
      {owner && company ? (
        <section>
          <ListSectionTitle>{t.privacy.deleteTitle}</ListSectionTitle>
          <div className="content-inset">
            <Markdown variant="Body">
              <p>{t.privacy.deleteDesc}</p>
            </Markdown>
          </div>
          <div className="form-stack">
            <FormSingleLine align="left" label={t.privacy.deleteLabel(company.name_cn)} maxLength={100} onChange={setName} placeholder={company.name_cn} value={name} />
          </div>
          <SettingsFullWidthItem onAction={(a) => a === 'press' && name.trim() === company.name_cn && setConfirming(true)} type="居中按钮-敏感操作">
            {t.privacy.deleteTitle}
          </SettingsFullWidthItem>
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
        </section>
      ) : null}
    </StackPage>
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
  const navigate = useNavigate()
  return (
    <StackPage noBack={false} surface="primary" title={kind === 'privacy' ? t.privacy.privacyPolicy : t.privacy.terms}>
      <div className="content-inset report-body">
        <PolicyMarkdown text={kind === 'privacy' ? PRIVACY_MD : TERMS_MD} />
      </div>
      {kind === 'privacy' ? (
        <SettingsFullWidthItem onAction={(a) => a === 'open' && navigate('/data-request')} trailing=" " trailingKind="chevron" type="单行列表-常规">
          {t.privacy.erasureTitle}
        </SettingsFullWidthItem>
      ) : null}
    </StackPage>
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
    <StackPage surface="primary" title={t.privacy.erasureTitle}>
      <div className="content-inset">
        <Markdown variant="Body">
          <p>{done ? t.privacy.erasureDone : t.privacy.erasureDesc}</p>
        </Markdown>
      </div>
      {!done ? (
        <div className="form-stack">
          <FormSingleLine align="left" label={t.privacy.erasureEmail} maxLength={254} onChange={setEmail} placeholder="name@company.com" value={email} />
          <FormDoubleLine label={t.privacy.erasureNote} maxLength={1000} onChange={setNote} placeholder={t.privacy.erasureNote} value={note} />
          <div className="form-actions">
            <Button onAction={(a) => a === 'press' && valid && !submit.isPending && submit.mutate()} size="L" state={valid && !submit.isPending ? 'Default' : 'Disable'} type="Primary">
              {t.privacy.erasureSubmit}
            </Button>
          </div>
        </div>
      ) : null}
    </StackPage>
  )
}
