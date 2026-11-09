// 导航配置。侧边栏是全站唯一的导航列。
// - 客户（工厂老板）：首页 / 我的网站 / 海外买家 / 我的资料，四个入口各自回答「这是什么、进行到哪、我要做什么」
// - 运营：客户与待办、买家审核、渠道、花费、记录、删除请求；进入某家企业代操作时，另有一组「代操作工具」
import {
  ClipboardList,
  Coins,
  Database,
  FolderOpen,
  Globe,
  History,
  Home,
  ListChecks,
  MessageSquare,
  Package,
  Radar,
  Settings2,
  UserCheck,
  Users,
  UserX,
  type LucideIcon,
} from 'lucide-react'
import { t } from '@/i18n'
import { cust } from '@/i18n/customer'

export interface NavItem {
  id: string
  path: string
  label: string
  icon: LucideIcon
}

export const MAIN_NAV: readonly NavItem[] = [
  { id: 'home', path: '/home', label: cust.nav.home, icon: Home },
  { id: 'site', path: '/my-site', label: cust.nav.site, icon: Globe },
  { id: 'buyers', path: '/buyers', label: cust.nav.buyers, icon: UserCheck },
  { id: 'materials', path: '/materials', label: cust.nav.materials, icon: FolderOpen },
]

/** 运营人员可见；在侧边栏中作为单独一组显示。 */
export const OPS_NAV: readonly NavItem[] = [
  { id: 'ops-customers', path: '/ops/customers', label: t.ops.customers, icon: Users },
  { id: 'ops-tasks', path: '/ops/tasks', label: t.ops.tasks, icon: ListChecks },
  { id: 'ops-review', path: '/ops/review', label: t.ops.review, icon: ClipboardList },
  { id: 'ops-sources', path: '/ops/sources', label: t.ops.sources, icon: Database },
  { id: 'ops-costs', path: '/ops/costs', label: t.ops.costs, icon: Coins },
  { id: 'ops-audit', path: '/ops/audit', label: t.ops.audit, icon: History },
  { id: 'ops-data-requests', path: '/ops/data-requests', label: t.ops.dataRequests, icon: UserX },
]

/** 运营进入某家企业代操作时可用的高级工具（客户看不到）。 */
export const OPERATOR_NAV: readonly NavItem[] = [
  { id: 'op-assistant', path: '/assistant', label: t.ops.toolAssistant, icon: MessageSquare },
  { id: 'op-site', path: '/site', label: t.ops.toolSite, icon: Settings2 },
  { id: 'op-leads', path: '/leads', label: t.ops.toolLeads, icon: Radar },
  { id: 'op-profile', path: '/me', label: t.ops.toolProfile, icon: Package },
]
