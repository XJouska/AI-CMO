// 工作台布局：左侧边栏（桌面，可折叠）+ 内容区。宽度 < 768px 时侧边栏收进抽屉，由页面顶栏的菜单按钮打开。
import { Building2, ChevronsUpDown, Globe, LogOut, MessageSquare, Moon, PanelLeftClose, PanelLeftOpen, ShieldCheck, Sun, Target, UserRound, type LucideIcon } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '@/api/endpoints'
import { useTheme } from '@/app/theme'
import { BRAND } from '@/brand'
import logoUrl from '@/brand/logo.svg'
import { t } from '@/i18n'
import { useLeadBadge } from '@/leads/badge'
import { useSession } from '@/session/session'
import { ChoiceMenu, ConfirmDialog, CountBadge, cx, Drawer, IconButton, useToast } from '@/ui'

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

const COLLAPSE_KEY = 'aicmo.sidebar.collapsed'

interface ShellNav {
  openNav: () => void
}

const ShellContext = createContext<ShellNav>({ openNav: () => {} })

export function useShellNav(): ShellNav {
  return useContext(ShellContext)
}

export function AppLayout() {
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })

  // 切换页面后关闭手机抽屉
  useEffect(() => setDrawerOpen(false), [location.pathname])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, value ? '0' : '1')
      } catch {
        // 忽略
      }
      return !value
    })
  }, [])

  const shell = useMemo(() => ({ openNav: () => setDrawerOpen(true) }), [])

  return (
    <ShellContext.Provider value={shell}>
      <div className={cx('app-shell', collapsed && 'is-collapsed')}>
        <aside className="app-sidebar">
          <SidebarContent collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
        </aside>
        <div className="app-main">
          <Outlet />
        </div>
      </div>
      <Drawer className="app-nav-drawer" label={t.shell.menu} onClose={() => setDrawerOpen(false)} open={drawerOpen} side="left" title={BRAND.name}>
        <SidebarContent collapsed={false} inDrawer />
      </Drawer>
    </ShellContext.Provider>
  )
}

function SidebarContent({ collapsed, inDrawer, onToggleCollapsed }: { collapsed: boolean; inDrawer?: boolean; onToggleCollapsed?: () => void }) {
  const session = useSession()
  const navigate = useNavigate()
  const toast = useToast()
  const { theme, toggle } = useTheme()
  const newLeads = useLeadBadge()
  const [switching, setSwitching] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const companies = session.user?.companies ?? []
  const isStaff = Boolean(session.user?.is_staff)

  const items: NavItem[] = [...MAIN_NAV, ...(isStaff ? [{ id: 'ops', path: '/ops', label: t.ops.section, icon: ShieldCheck }] : [])]

  return (
    <div className="sidebar">
      {inDrawer ? null : (
        <div className="sidebar__brand">
          <NavLink aria-label={BRAND.name} className="sidebar__logo" to="/assistant">
            <img alt="" height={28} src={logoUrl} width={28} />
            <span className="sidebar__label">{BRAND.name}</span>
          </NavLink>
          {onToggleCollapsed ? (
            <IconButton
              className="sidebar__collapse"
              icon={collapsed ? PanelLeftOpen : PanelLeftClose}
              label={collapsed ? t.shell.expand : t.shell.collapse}
              onClick={onToggleCollapsed}
              size="sm"
            />
          ) : null}
        </div>
      )}

      {companies.length ? (
        <button className="sidebar__company" onClick={() => setSwitching(true)} title={t.company.switchTitle} type="button">
          <span aria-hidden className="sidebar__company-icon">
            <Building2 size={16} />
          </span>
          <span className="sidebar__label sidebar__company-name">{session.company?.name_cn ?? t.company.switchTitle}</span>
          <ChevronsUpDown aria-hidden className="sidebar__label" size={14} />
        </button>
      ) : null}

      <nav aria-label={t.tabs.ariaLabel} className="sidebar__nav">
        {items.map((item) => (
          <NavLink className={({ isActive }) => cx('sidebar__link', isActive && 'is-active')} key={item.id} title={collapsed ? item.label : undefined} to={item.path}>
            <item.icon aria-hidden size={18} />
            <span className="sidebar__label">{item.label}</span>
            {item.id === 'leads' && newLeads > 0 ? (
              <span className="sidebar__badge">
                <CountBadge count={newLeads} label={t.shell.newLeads(newLeads)} />
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__footer">
        <button className="sidebar__link" onClick={toggle} title={collapsed ? t.shell.theme : undefined} type="button">
          {theme === 'dark' ? <Sun aria-hidden size={18} /> : <Moon aria-hidden size={18} />}
          <span className="sidebar__label">{theme === 'dark' ? t.shell.light : t.shell.dark}</span>
        </button>
        <div className="sidebar__user">
          <span aria-hidden className="sidebar__avatar">
            {(session.user?.name || session.user?.email || '?').slice(0, 1).toUpperCase()}
          </span>
          <span className="sidebar__label sidebar__user-text">
            <span className="sidebar__user-name">{session.user?.name || session.user?.email}</span>
            {session.user?.name ? <span className="sidebar__user-email">{session.user.email}</span> : null}
          </span>
          <IconButton className="sidebar__label" icon={LogOut} label={t.me.logout} onClick={() => setLoggingOut(true)} size="sm" />
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
    </div>
  )
}

/** 供页面使用的二级导航（设置中心、运营工作台的左栏）。 */
export function SubNav({ label, groups }: { label: string; groups: { title?: string; items: { path: string; label: string; icon?: LucideIcon; end?: boolean; badge?: ReactNode }[] }[] }) {
  return (
    <nav aria-label={label} className="subnav">
      {groups.map((group, index) => (
        <div className="subnav__group" key={group.title ?? index}>
          {group.title ? <div className="subnav__title">{group.title}</div> : null}
          {group.items.map((item) => (
            <NavLink className={({ isActive }) => cx('subnav__link', isActive && 'is-active')} end={item.end} key={item.path} to={item.path}>
              {item.icon ? <item.icon aria-hidden size={16} /> : null}
              <span>{item.label}</span>
              {item.badge}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}
