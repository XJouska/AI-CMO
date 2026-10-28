// 「我的」概览：企业资料、获客工具、账户三组入口卡片；切换企业、退出登录。
import { useQuery } from '@tanstack/react-query'
import { Building2, LogOut, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/endpoints'
import { BRAND } from '@/brand'
import { t } from '@/i18n'
import { AppPage } from '@/layout/AppPage'
import { SETTINGS_GROUPS } from '@/layout/SettingsPage'
import { leadsApi } from '@/leads/api'
import { billingApi, notificationsApi } from '@/ops/api'
import { outreachApi } from '@/outreach/api'
import { useSession } from '@/session/session'
import { Button, Card, ChoiceMenu, ConfirmDialog, ListGroup, ListRow, Progress, useToast } from '@/ui'

export function MePage() {
  const navigate = useNavigate()
  const toast = useToast()
  const session = useSession()
  const [switching, setSwitching] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const profile = useQuery({ queryKey: ['profile', session.company?.id], queryFn: api.profile })
  const watches = useQuery({ queryKey: ['watches', session.company?.id], queryFn: leadsApi.watches })
  const mailAccounts = useQuery({ queryKey: ['mail-accounts'], queryFn: outreachApi.mailAccounts })
  const usage = useQuery({ queryKey: ['billing-usage', session.company?.id], queryFn: billingApi.usage })
  const notifications = useQuery({ queryKey: ['notifications', session.company?.id], queryFn: notificationsApi.list })
  const unread = notifications.data?.filter((n) => !n.read).length ?? 0
  const companies = session.user?.companies ?? []

  // 各入口右侧显示的状态
  const values: Record<string, string> = {
    '/me/profile': profile.data ? t.profile.completeness(profile.data.completeness) : t.common.loading,
    '/me/products': profile.data ? t.me.countValue(profile.data.product_count) : t.common.loading,
    '/me/watches': watches.data?.some((w) => w.is_active) ? t.leads.watchDaily : t.me.monitoringValue,
    '/me/mail-accounts': mailAccounts.data ? t.me.mailAccountsValue(mailAccounts.data.length) : t.common.loading,
    '/me/billing': usage.data ? `${usage.data.plan.name}${usage.data.status === 'expired' ? '（已到期）' : ''}` : t.common.loading,
    '/me/notifications': t.me.unread(unread),
  }

  return (
    <AppPage description={t.me.overviewDesc} title={t.me.title}>
      <div className="stack-lg">
        <Card className="me-company" padding="lg">
          <div className="me-company__main">
            <span aria-hidden className="me-company__icon">
              <Building2 size={22} />
            </span>
            <div className="me-company__text">
              <strong>{session.company?.name_cn}</strong>
              <span className="muted">{session.user?.email}</span>
            </div>
            <Button onClick={() => setSwitching(true)} variant="outline">
              {t.me.switchCompany}
            </Button>
          </div>
          {profile.data ? (
            <div className="me-company__progress">
              <div className="row-between">
                <span className="secondary">{t.profile.completeness(profile.data.completeness)}</span>
                <Button onClick={() => navigate('/me/profile')} size="sm" variant="link">
                  {t.me.profile}
                </Button>
              </div>
              <Progress label={t.profile.completeness(profile.data.completeness)} value={profile.data.completeness} />
            </div>
          ) : null}
        </Card>

        <div className="grid-3 me-groups">
          {SETTINGS_GROUPS.map((group) => (
            <ListGroup key={group.title} title={group.title}>
              {group.items.map((item) => (
                <ListRow icon={item.icon} key={item.path} onClick={() => navigate(item.path)} title={item.label} value={values[item.path]} />
              ))}
            </ListGroup>
          ))}
        </div>

        {session.user?.is_staff ? (
          <ListGroup title={t.ops.section}>
            <ListRow icon={ShieldCheck} onClick={() => navigate('/ops')} title={t.ops.section} />
          </ListGroup>
        ) : null}

        <div className="row-between me-foot">
          <span className="muted">{`${BRAND.name} ${BRAND.version}`}</span>
          <Button icon={LogOut} onClick={() => setLoggingOut(true)} variant="danger-ghost">
            {t.me.logout}
          </Button>
        </div>
      </div>

      <ChoiceMenu
        cancelLabel={t.common.cancel}
        items={[...companies.map((c) => ({ label: c.name_cn, current: c.id === session.company?.id })), { label: t.company.createTitle }]}
        onCancel={() => setSwitching(false)}
        onSelect={(index) => {
          setSwitching(false)
          const target = companies[index]
          if (!target) return navigate('/onboarding/company')
          if (target.id !== session.company?.id) {
            session.selectCompany(target.id)
            toast.show(t.company.switched(target.name_cn))
          }
        }}
        open={switching}
        title={t.company.switchTitle}
      />
      <ConfirmDialog
        cancelLabel={t.common.cancel}
        confirmLabel={t.me.logout}
        danger
        onCancel={() => setLoggingOut(false)}
        onConfirm={() => {
          setLoggingOut(false)
          void api.logout().catch(() => {})
          session.signOut()
          navigate('/login', { replace: true })
        }}
        open={loggingOut}
        title={t.me.logoutConfirm}
      />
    </AppPage>
  )
}
