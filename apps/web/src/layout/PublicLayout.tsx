// 公开页面布局：顶部导航 + 页脚。用于营销首页、隐私政策、用户协议、数据删除请求。
import { Menu, Moon, Sun, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useTheme } from '@/app/theme'
import { BRAND } from '@/brand'
import logoUrl from '@/brand/logo.svg'
import { t } from '@/i18n'
import { useSession } from '@/session/session'
import { Button, IconButton } from '@/ui'

export function PublicLayout() {
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const { theme, toggle } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const signedIn = Boolean(session.token)

  useEffect(() => setMenuOpen(false), [location.pathname, location.hash])

  const anchors = [
    { href: '/#example', label: t.home.nav.features },
    { href: '/#how', label: t.home.nav.how },
    { href: '/#faq', label: t.home.nav.faq },
  ]

  return (
    <div className="site">
      <header className="site-header">
        <div className="site-container site-header__inner">
          <Link aria-label={BRAND.name} className="site-logo" to="/">
            <img alt="" height={28} src={logoUrl} width={28} />
            <span>{BRAND.name}</span>
          </Link>
          <nav aria-label={t.home.nav.label} className={menuOpen ? 'site-nav is-open' : 'site-nav'}>
            {anchors.map((a) => (
              <a className="site-nav__link" href={a.href} key={a.href}>
                {a.label}
              </a>
            ))}
            <div className="site-nav__actions">
              {signedIn ? (
                <Button onClick={() => navigate('/home')} variant="primary">
                  {t.home.enterApp}
                </Button>
              ) : (
                <>
                  <Button onClick={() => navigate('/login')} variant="ghost">
                    {t.auth.login}
                  </Button>
                  <Button onClick={() => navigate('/register')} variant="primary">
                    {t.home.start}
                  </Button>
                </>
              )}
            </div>
          </nav>
          <div className="site-header__tools">
            <IconButton icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? t.shell.light : t.shell.dark} onClick={toggle} />
            <IconButton className="site-header__menu" icon={menuOpen ? X : Menu} label={t.shell.menu} onClick={() => setMenuOpen((v) => !v)} />
          </div>
        </div>
      </header>
      <main className="site-main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="site-container site-footer__inner">
          <div className="site-footer__brand">
            <span className="site-logo">
              <img alt="" height={24} src={logoUrl} width={24} />
              <span>{BRAND.name}</span>
            </span>
            <p>{BRAND.tagline}</p>
          </div>
          <nav aria-label={t.home.footer.label} className="site-footer__links">
            <NavLink to="/privacy">{t.privacy.privacyPolicy}</NavLink>
            <NavLink to="/terms">{t.privacy.terms}</NavLink>
            <NavLink to="/data-request">{t.privacy.erasureTitle}</NavLink>
          </nav>
          <p className="site-footer__copy">{t.home.footer.copyright(new Date().getFullYear())}</p>
        </div>
      </footer>
    </div>
  )
}
