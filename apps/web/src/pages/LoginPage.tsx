import { NavBar } from '@yb/generated/components'
import { t } from '@/i18n'

// 计划 01 只提供空壳，登录表单在计划 02 实现。
export function LoginPage() {
  return (
    <div className="page" data-surface="primary">
      <div className="page-nav">
        <NavBar barType="Fixed Color Bg" divider={false} leftButton={false} rightButton={false} themeBg>
          {t.login.title}
        </NavBar>
      </div>
      <main className="page-body" />
    </div>
  )
}
