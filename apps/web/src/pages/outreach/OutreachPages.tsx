// 「我的 → 发信邮箱」与「我的 → 效果周报」。
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, FileBarChart, Mail, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MarkdownText } from '@/assistant/MarkdownText'
import { QueryView } from '@/components/QueryView'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { SettingsPage } from '@/layout/SettingsPage'
import { isEmail } from '@/lib/validation'
import { outreachApi, type MailAccountOut } from '@/outreach/api'
import { BulletList, Button, Card, CardHeader, ConfirmDialog, KeyValue, ListGroup, ListRow, PasswordField, Quote, Tag, TextField, useToast } from '@/ui'

// ── 发信邮箱 ───────────────────────────────────────────────────────────

export function MailAccountsPage() {
  const navigate = useNavigate()
  const accounts = useQuery({ queryKey: ['mail-accounts'], queryFn: outreachApi.mailAccounts })
  const count = accounts.data?.length ?? 0
  return (
    <SettingsPage
      actions={
        count > 0 && count < 3 ? (
          <Button icon={Plus} onClick={() => navigate('/me/mail-accounts/new')} variant="outline">
            {t.outreach.mailAdd}
          </Button>
        ) : null
      }
      title={t.outreach.mailTitle}
    >
      <QueryView
        empty={{ title: t.outreach.mailEmptyTitle, desc: t.outreach.mailEmptyDesc, action: t.outreach.mailAdd, onAction: () => navigate('/me/mail-accounts/new'), icon: Mail }}
        isEmpty={(items) => items.length === 0}
        query={accounts}
      >
        {(items) => (
          <div className="stack">
            {items.map((account) => (
              <MailAccountItem account={account} key={account.id} />
            ))}
          </div>
        )}
      </QueryView>
    </SettingsPage>
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
    <Card data-account-id={account.id}>
      <CardHeader
        actions={
          <Button icon={Trash2} loading={remove.isPending} onClick={() => setDeleting(true)} size="sm" variant="danger-ghost">
            {t.outreach.mailDelete}
          </Button>
        }
        description={account.from_name || undefined}
        icon={Mail}
        title={account.from_address}
      />
      <div className="stack">
        <KeyValue
          items={[
            { label: t.outreach.mailHost, value: `${account.smtp_host}:${account.smtp_port}` },
            { label: t.outreach.mailLimit, value: t.outreach.mailSentToday(account.sent_today, account.daily_limit) },
          ]}
        />
        {dnsOk ? (
          <div className="row">
            <Tag tone="success">{t.outreach.mailDnsOk}</Tag>
          </div>
        ) : (
          <Quote tone="warning">
            <strong>{t.outreach.mailDnsTitle}</strong>
            <BulletList items={account.dns.hints ?? []} />
          </Quote>
        )}
      </div>
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
    </Card>
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
  const portInvalid = Boolean(form.smtp_port) && port !== 465 && port !== 587
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
    <SettingsPage back="/me/mail-accounts" title={t.outreach.mailAdd}>
      <Card padding="lg">
        <form
          className="ui-form-stack"
          onSubmit={(event) => {
            event.preventDefault()
            if (valid && !create.isPending) create.mutate()
          }}
        >
          <div className="ui-form-grid">
            <TextField autoComplete="off" label={t.outreach.mailFrom} maxLength={254} onChange={set('from_address')} placeholder="sales@your-factory.com" value={form.from_address} />
            <TextField autoComplete="off" label={t.outreach.mailFromName} maxLength={120} onChange={set('from_name')} placeholder="Sales Team" value={form.from_name} />
            <TextField autoComplete="off" label={t.outreach.mailHost} maxLength={253} onChange={set('smtp_host')} placeholder="smtp.exmail.qq.com" value={form.smtp_host} />
            <TextField
              error={portInvalid ? t.outreach.invalidPort : undefined}
              hint={t.outreach.portHint}
              inputMode="numeric"
              label={t.outreach.mailPort}
              maxLength={3}
              onChange={(v) => set('smtp_port')(v.replace(/\D/g, ''))}
              placeholder="465"
              value={form.smtp_port}
            />
            <TextField autoComplete="off" label={t.outreach.mailUser} maxLength={254} onChange={set('username')} placeholder="sales@your-factory.com" value={form.username} />
            <PasswordField autoComplete="new-password" hint={t.outreach.mailPasswordHint} label={t.outreach.mailPassword} maxLength={512} onChange={set('password')} value={form.password} />
            <TextField inputMode="numeric" label={t.outreach.mailLimit} maxLength={3} onChange={(v) => set('daily_limit')(v.replace(/\D/g, ''))} placeholder="30" value={form.daily_limit} />
          </div>
          <div className="ui-form-actions">
            <Button onClick={() => navigate('/me/mail-accounts')} variant="ghost">
              {t.common.cancel}
            </Button>
            <Button disabled={!valid} loading={create.isPending} type="submit" variant="primary">
              {t.outreach.mailAdd}
            </Button>
          </div>
        </form>
      </Card>
    </SettingsPage>
  )
}

// ── 效果周报 ───────────────────────────────────────────────────────────

export function ReportsPage() {
  const navigate = useNavigate()
  const reports = useQuery({ queryKey: ['reports'], queryFn: outreachApi.reports })
  return (
    <SettingsPage title={t.outreach.reportsTitle}>
      <div className="stack-lg">
        <div className="ui-list">
          <ListRow icon={CalendarRange} onClick={() => navigate('/me/reports/current')} title={t.outreach.reportThisWeek} />
        </div>
        <QueryView empty={{ title: t.outreach.reportsEmptyTitle, desc: t.outreach.reportsEmptyDesc, icon: FileBarChart }} isEmpty={(items) => items.length === 0} query={reports}>
          {(items) => (
            <ListGroup title={t.outreach.reportsHistory}>
              {items.map((r) => (
                <ListRow
                  icon={FileBarChart}
                  key={r.id}
                  onClick={() => navigate(`/me/reports/${r.id}`)}
                  subtitle={t.outreach.reportStats(Number(r.stats.new_leads ?? 0), Number(r.stats.contacted ?? 0))}
                  title={t.outreach.reportWeek(r.week_start)}
                />
              ))}
            </ListGroup>
          )}
        </QueryView>
      </div>
    </SettingsPage>
  )
}

export function ReportDetailPage() {
  const { id = '' } = useParams()
  const report = useQuery({ queryKey: ['report', id], queryFn: () => (id === 'current' ? outreachApi.preview() : outreachApi.report(id)) })
  return (
    <SettingsPage back="/me/reports" title={t.outreach.reportsTitle}>
      <QueryView query={report}>
        {(data) => (
          <Card className="report-body" padding="lg">
            <MarkdownText text={data.markdown} />
          </Card>
        )}
      </QueryView>
    </SettingsPage>
  )
}
