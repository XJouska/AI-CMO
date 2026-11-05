// 导航配置：主菜单与运营菜单。侧边栏是全站唯一的导航列，页面内不再放二级导航列。
import { Check, Coins, Database, FlaskConical, Globe, History, MessageSquare, Target, UserRound, Users, UserX, type LucideIcon } from 'lucide-react'
import { t } from '@/i18n'

export interface NavItem {
  id: string
  path: string
  label: string
  icon: LucideIcon
}

export const MAIN_NAV: readonly NavItem[] = [
  { id: 'assistant', path: '/assistant', label: t.tabs.assistant, icon: MessageSquare },
  { id: 'leads', path: '/leads', label: t.tabs.leads, icon: Target },
  { id: 'site', path: '/site', label: t.tabs.site, icon: Globe },
  { id: 'me', path: '/me', label: t.tabs.me, icon: UserRound },
]

/** 运营人员可见；在侧边栏中作为单独一组显示。 */
export const OPS_NAV: readonly NavItem[] = [
  { id: 'ops-customers', path: '/ops/customers', label: t.ops.customers, icon: Users },
  { id: 'ops-review', path: '/ops/review', label: t.ops.review, icon: Check },
  { id: 'ops-audit', path: '/ops/audit', label: t.ops.audit, icon: History },
  { id: 'ops-sources', path: '/ops/sources', label: t.ops.sources, icon: Database },
  { id: 'ops-costs', path: '/ops/costs', label: t.ops.costs, icon: Coins },
  { id: 'ops-evals', path: '/ops/evals', label: t.ops.evals, icon: FlaskConical },
  { id: 'ops-data-requests', path: '/ops/data-requests', label: t.ops.dataRequests, icon: UserX },
]
