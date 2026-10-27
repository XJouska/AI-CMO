import { BrandTabBar, type BrandTabInputProps, type BrandTabItem } from '@yb-ext/BrandTabBar'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { useLeadBadge } from '@/leads/badge'

// 图标沿用正式 TabBar 的四组图标（节点 5544:*，off / on 两态）。产品专属图标见 docs/ui-gaps.md「GAP-004」。
export const TABS: readonly (BrandTabItem & { path: string })[] = [
  { id: 'assistant', path: '/assistant', label: t.tabs.assistant, icon: '5544-3302', iconOn: '5544-3309', tone: 'ask' },
  { id: 'leads', path: '/leads', label: t.tabs.leads, icon: '5544-3319', iconOn: '5544-3329', tone: 'primary' },
  { id: 'site', path: '/site', label: t.tabs.site, icon: '5544-3334', iconOn: '5544-3340', tone: 'secondary' },
  { id: 'me', path: '/me', label: t.tabs.me, icon: '5544-3347', iconOn: '5544-3353', tone: 'secondary' },
]

export type PageSurface = 'primary' | 'secondary'

interface TabPageProps {
  nav: ReactNode
  surface: PageSurface
  input?: BrandTabInputProps
  children: ReactNode
}

/** Tab 页面布局：顶部导航栏固定，中间内容滚动，底部 TabBar 固定。 */
export function TabPage({ nav, surface, input, children }: TabPageProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const current = TABS.find((tab) => pathname.startsWith(tab.path)) ?? TABS[0]
  const newLeads = useLeadBadge()
  const items = TABS.map((tab) => (tab.id === 'leads' && newLeads > 0 ? { ...tab, badge: newLeads } : tab))

  return (
    <div className="page" data-surface={surface}>
      <div className="page-nav">{nav}</div>
      <main className="page-body">{children}</main>
      <div className="page-tabbar">
        <BrandTabBar
          ariaLabel={t.tabs.ariaLabel}
          input={input}
          items={items}
          onSelect={(id) => {
            const tab = TABS.find((item) => item.id === id)
            if (tab && tab.id !== current.id) navigate(tab.path)
          }}
          selectedId={current.id}
        />
      </div>
    </div>
  )
}
