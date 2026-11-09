// 开通向导布局：只有顶部 Logo 和退出，内容居中，手机优先。
import { LogOut } from 'lucide-react'
import { Link, Outlet, useNavigate } from 'react-router-dom'
import { api } from '@/api/endpoints'
import { BRAND } from '@/brand'
import logoUrl from '@/brand/logo.svg'
import { useSession } from '@/session/session'
import { Button } from '@/ui'

export function StartLayout() {
  const session = useSession()
  const navigate = useNavigate()
  return (
    <div className="start-shell">
      <header className="start-shell__top">
        <Link aria-label={BRAND.name} className="site-logo" to={session.company ? '/home' : '/start'}>
          <img alt="" height={28} src={logoUrl} width={28} />
          <span>{BRAND.name}</span>
        </Link>
        {session.company ? (
          <Button onClick={() => navigate('/home')} size="sm" variant="ghost">
            回到首页
          </Button>
        ) : (
          <Button
            icon={LogOut}
            onClick={() => {
              void api.logout().catch(() => {})
              session.signOut()
              navigate('/login', { replace: true })
            }}
            size="sm"
            variant="ghost"
          >
            退出
          </Button>
        )}
      </header>
      <main className="start-shell__main">
        <Outlet />
      </main>
    </div>
  )
}
