// 设置中心：「我的」下所有页面共用左侧分组菜单（桌面常驻，窄屏变成横向标签）。
import { Bell, Building2, CreditCard, FileBarChart, FolderOpen, KeyRound, Mail, Package, Radar, ShieldCheck, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '@/i18n'
import { AppPage, type AppPageProps } from './AppPage'
import { SubNav } from './AppLayout'

export const SETTINGS_GROUPS = [
  {
    title: t.me.sectionCompany,
    items: [
      { path: '/me/profile', label: t.me.profile, icon: Building2 },
      { path: '/me/products', label: t.me.products, icon: Package },
      { path: '/me/assets', label: t.me.assets, icon: FolderOpen },
      { path: '/me/members', label: t.me.team, icon: Users },
    ],
  },
  {
    title: t.me.sectionGrowth,
    items: [
      { path: '/me/watches', label: t.me.monitoring, icon: Radar },
      { path: '/me/mail-accounts', label: t.me.mailAccounts, icon: Mail },
      { path: '/me/reports', label: t.me.reports, icon: FileBarChart },
    ],
  },
  {
    title: t.me.sectionAccount,
    items: [
      { path: '/me/billing', label: t.me.plan, icon: CreditCard },
      { path: '/me/notifications', label: t.me.notifications, icon: Bell },
      { path: '/me/security', label: t.me.security, icon: KeyRound },
      { path: '/me/privacy', label: t.me.privacy, icon: ShieldCheck },
    ],
  },
]

export function SettingsPage({ children, ...props }: Omit<AppPageProps, 'aside'> & { children: ReactNode }) {
  return (
    <AppPage {...props} aside={<SubNav groups={SETTINGS_GROUPS} label={t.me.settingsNav} />} width={props.width ?? 'default'}>
      {children}
    </AppPage>
  )
}
