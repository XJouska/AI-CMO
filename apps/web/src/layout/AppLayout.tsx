// 工作台布局：左侧边栏（桌面，可折叠）+ 内容区。宽度 < 768px 时侧边栏收进抽屉，由页面顶栏的菜单按钮打开。
import { Building2, ChevronsUpDown, KeyRound, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Sun } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '@/api/endpoints'
import { useTheme } from '@/app/theme'
import { BRAND } from '@/brand'
import logoUrl from '@/brand/logo.svg'
import { t } from '@/i18n'
import { useLeadBadge } from '@/leads/badge'
import { useSession } from '@/session/session'
import { ChoiceMenu, ConfirmDialog, CountBadge, cx, Drawer, IconButton, useToast } from '@/ui'
import { MAIN_NAV, OPERATOR_NAV, OPS_NAV, type NavItem } from './nav'

export { MAIN_NAV, OPERATOR_NAV, OPS_NAV, type NavItem } from './nav'

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

  const hasCompany = Boolean(session.company)
  // 客户的四个入口都属于某个企业；没有企业时（例如尚未进入客户企业的运营人员）不显示，避免点击后被跳回。
  // 运营进入企业代操作时，额外显示一组高级工具（客户看不到）。
  const groups: { title?: string; items: readonly NavItem[] }[] = [
    ...(hasCompany ? [{ items: MAIN_NAV }] : []),
    ...(hasCompany && isStaff ? [{ title: t.ops.operatorGroup, items: OPERATOR_NAV }] : []),
    ...(isStaff ? [{ title: t.ops.group, items: OPS_NAV }] : []),
  ]
  const home = hasCompany ? '/home' : isStaff ? '/ops/customers' : '/start'

  return (
    <div className="sidebar">
      {inDrawer ? null : (
        <div className="sidebar__brand">
          <NavLink aria-label={BRAND.name} className="sidebar__logo" end to={home}>
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
        {groups.map((group, index) => (
          <div className="sidebar__group" key={group.title ?? index}>
            {group.title ? <div className="sidebar__group-title sidebar__label">{group.title}</div> : null}
            {group.items.map((item) => (
              <NavLink className={({ isActive }) => cx('sidebar__link', isActive && 'is-active')} key={item.id} title={collapsed ? item.label : undefined} to={item.path}>
                <item.icon aria-hidden size={18} />
                <span className="sidebar__label">{item.label}</span>
                {item.id === 'buyers' && newLeads > 0 ? (
                  <span className="sidebar__badge">
                    <CountBadge count={newLeads} label={t.shell.newLeads(newLeads)} />
                  </span>
                ) : null}
              </NavLink>
            ))}
          </div>
        ))}
        {!hasCompany && isStaff ? <p className="sidebar__hint sidebar__label">{t.shell.noCompanyHint}</p> : null}
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
          <IconButton className="sidebar__label" icon={KeyRound} label={t.me.security} onClick={() => navigate('/account/security')} size="sm" />
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
          if (!target) return navigate('/start')
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
