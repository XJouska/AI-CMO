// 「我的 → 发信邮箱」与「我的 → 效果周报」。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, FormSingleLine, ListSectionTitle, Markdown, SettingsFullWidthItem } from '@yb/generated/components'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MarkdownText } from '@/assistant/MarkdownText'
import { QueryView } from '@/components/local/QueryView'
import { SecureTextField } from '@/components/local/SecureTextField'
import { StackPage } from '@/components/local/StackPage'
import { ConfirmDialog } from '@/feedback/overlays'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { isEmail } from '@/lib/validation'
import { outreachApi, type MailAccountOut } from '@/outreach/api'

// ── 发信邮箱 ───────────────────────────────────────────────────────────

export function MailAccountsPage() {
  const navigate = useNavigate()
  const accounts = useQuery({ queryKey: ['mail-accounts'], queryFn: outreachApi.mailAccounts })
  return (
    <StackPage backTo="/me" title={t.outreach.mailTitle}>
      <QueryView
        empty={{ title: t.outreach.mailEmptyTitle, desc: t.outreach.mailEmptyDesc, action: t.outreach.mailAdd, onAction: () => navigate('/me/mail-accounts/new') }}
        isEmpty={(items) => items.length === 0}
        query={accounts}
      >
        {(items) => (
          <>
            {items.map((account) => (
              <MailAccountItem account={account} key={account.id} />
            ))}
            {items.length < 3 ? (
              <div className="form-actions content-inset">
                <Button onAction={(a) => a === 'press' && navigate('/me/mail-accounts/new')} size="M" type="Secondary">
                  {t.outreach.mailAdd}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </QueryView>
    </StackPage>
  )
}

function MailAccountItem({ account }: { account: MailAccountOut }) {
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const remove = useMutation({
    mutationFn: () => outreachApi.deleteMailAccount(account.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mail-accounts'] })
      toast.show(t.outreach.mailDeleted)
    },
    onError: showError,
  })
  const dnsOk = account.dns.spf && account.dns.dmarc
  return (
    <section data-account-id={account.id}>
      <ListSectionTitle>{account.from_address}</ListSectionTitle>
      <SettingsFullWidthItem subtitle={`${account.smtp_host}:${account.smtp_port}`} trailing={t.outreach.mailSentToday(account.sent_today, account.daily_limit)} trailingKind="none" type="双行列表-常规">
        {account.from_name || account.from_address}
      </SettingsFullWidthItem>
      {dnsOk ? (
        <SettingsFullWidthItem trailing=" " trailingKind="none" type="单行列表-常规">
          {t.outreach.mailDnsOk}
        </SettingsFullWidthItem>
      ) : (
        <div className="content-inset">
          <Markdown items={account.dns.hints ?? []} variant="UL" />
        </div>
      )}
      <SettingsFullWidthItem onAction={(a) => a === 'open' && setDeleting(true)} trailing=" " trailingKind="chevron" type="单行列表-常规">
        {t.outreach.mailDelete}
      </SettingsFullWidthItem>
      <ConfirmDialog
        body={t.outreach.mailDeleteConfirm}
        cancelLabel={t.common.cancel}
        confirmLabel={t.outreach.mailDelete}
        danger
        onCancel={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false)
          remove.mutate()
        }}
        open={deleting}
        title={t.outreach.mailDelete}
      />
    </section>
  )
}

export function MailAccountNewPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const showError = useErrorToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ from_address: '', from_name: '', smtp_host: '', smtp_port: '465', username: '', password: '', daily_limit: '30' })
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }))
  const port = Number(form.smtp_port)
  const valid = isEmail(form.from_address.trim()) && form.smtp_host.trim().length >= 3 && (port === 465 || port === 587) && form.username.trim() && form.password
  const create = useMutation({
    mutationFn: () =>
      outreachApi.createMailAccount({
        from_address: form.from_address.trim(),
        from_name: form.from_name.trim(),
        smtp_host: form.smtp_host.trim(),
        smtp_port: port as 465 | 587,
        username: form.username.trim(),
        password: form.password,
        daily_limit: Math.max(1, Math.min(500, Number(form.daily_limit) || 30)),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mail-accounts'] })
      toast.show(t.outreach.mailBound)
      navigate('/me/mail-accounts', { replace: true })
    },
    onError: showError,
  })
  return (
    <StackPage backTo="/me/mail-accounts" title={t.outreach.mailAdd}>
      <div className="form-stack">
        <FormSingleLine align="left" label={t.outreach.mailFrom} maxLength={254} onChange={set('from_address')} placeholder="sales@your-factory.com" value={form.from_address} />
        <FormSingleLine align="left" label={t.outreach.mailFromName} maxLength={120} onChange={set('from_name')} placeholder="Sales Team" value={form.from_name} />
        <FormSingleLine align="left" label={t.outreach.mailHost} maxLength={253} onChange={set('smtp_host')} placeholder="smtp.exmail.qq.com" value={form.smtp_host} />
        <FormSingleLine align="left" label={`${t.outreach.mailPort}（${t.outreach.portHint}）`} maxLength={3} onChange={(v) => set('smtp_port')(v.replace(/\D/g, ''))} placeholder="465" value={form.smtp_port} />
        <FormSingleLine align="left" label={t.outreach.mailUser} maxLength={254} onChange={set('username')} placeholder="sales@your-factory.com" value={form.username} />
        <SecureTextField autoComplete="off" label={t.outreach.mailPassword} maxLength={512} onChange={set('password')} placeholder={t.outreach.mailPasswordHint} value={form.password} />
        <FormSingleLine align="left" label={t.outreach.mailLimit} maxLength={3} onChange={(v) => set('daily_limit')(v.replace(/\D/g, ''))} placeholder="30" value={form.daily_limit} />
        {form.smtp_port && port !== 465 && port !== 587 ? (
          <Markdown variant="Body">
            <p>{t.outreach.invalidPort}</p>
          </Markdown>
        ) : null}
        <div className="form-actions">
          <Button onAction={(a) => a === 'press' && valid && !create.isPending && create.mutate()} size="L" state={valid && !create.isPending ? 'Default' : 'Disable'} type="Primary">
            {t.outreach.mailAdd}
          </Button>
        </div>
      </div>
    </StackPage>
  )
}

// ── 效果周报 ───────────────────────────────────────────────────────────

export function ReportsPage() {
  const navigate = useNavigate()
  const reports = useQuery({ queryKey: ['reports'], queryFn: outreachApi.reports })
  return (
    <StackPage backTo="/me" title={t.outreach.reportsTitle}>
      <SettingsFullWidthItem onAction={(a) => a === 'open' && navigate('/me/reports/current')} trailing=" " trailingKind="chevron" type="单行列表-常规">
        {t.outreach.reportThisWeek}
      </SettingsFullWidthItem>
      <QueryView empty={{ title: t.outreach.reportsEmptyTitle, desc: t.outreach.reportsEmptyDesc }} isEmpty={(items) => items.length === 0} query={reports}>
        {(items) => (
          <>
            <ListSectionTitle>{t.outreach.reportsTitle}</ListSectionTitle>
            {items.map((r) => (
              <SettingsFullWidthItem
                key={r.id}
                onAction={(a) => a === 'open' && navigate(`/me/reports/${r.id}`)}
                subtitle={`新增商机 ${Number(r.stats.new_leads ?? 0)} · 已联系 ${Number(r.stats.contacted ?? 0)}`}
                trailing=" "
                trailingKind="chevron"
                type="双行列表-常规"
              >
                {t.outreach.reportWeek(r.week_start)}
              </SettingsFullWidthItem>
            ))}
          </>
        )}
      </QueryView>
    </StackPage>
  )
}

export function ReportDetailPage() {
  const { id = '' } = useParams()
  const report = useQuery({ queryKey: ['report', id], queryFn: () => (id === 'current' ? outreachApi.preview() : outreachApi.report(id)) })
  return (
    <StackPage backTo="/me/reports" surface="primary" title={t.outreach.reportsTitle}>
      <QueryView query={report}>
        {(data) => (
          <div className="content-inset report-body">
            <MarkdownText text={data.markdown} />
          </div>
        )}
      </QueryView>
    </StackPage>
  )
}
