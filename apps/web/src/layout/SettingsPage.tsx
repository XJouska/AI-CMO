// 「我的」下的设置页：与其他页面相同的单列布局，顶栏左侧返回「我的」。
// 分组配置也用于「我的」概览页的入口卡片。
import { Bell, Building2, CreditCard, FileBarChart, FolderOpen, KeyRound, Mail, Package, Radar, ShieldCheck, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { t } from '@/i18n'
import { AppPage, type AppPageProps } from './AppPage'

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

export function SettingsPage({ children, back, width = 'narrow', ...props }: AppPageProps & { children: ReactNode }) {
  // 客户从「我的资料」进入账号页（/account/*），运营从工厂信息（/me）进入
  const { pathname } = useLocation()
  const target = back ?? (pathname.startsWith('/account') ? '/materials' : '/me')
  return (
    <AppPage {...props} back={target} width={width}>
      {children}
    </AppPage>
  )
}
