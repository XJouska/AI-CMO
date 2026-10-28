// 路由守卫：未登录 → /login；已登录但没有企业 → /onboarding/company（运营人员 → /ops 运营工作台）。
import { Loading } from '@yb/generated/components'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { PageCenter } from '@/components/local/StackPage'
import { t } from '@/i18n'
import { useSession } from './session'

export function RequireAuth({ children, needCompany = true }: { children: ReactNode; needCompany?: boolean }) {
  const session = useSession()
  const location = useLocation()
  if (!session.token) return <Navigate replace state={{ from: location.pathname + location.search }} to="/login" />
  if (session.loading || !session.user) {
    return (
      <PageCenter>
        <Loading>{t.common.loading}</Loading>
      </PageCenter>
    )
  }
  if (needCompany && !session.company) return <Navigate replace to={session.user.is_staff ? '/ops' : '/onboarding/company'} />
  return <>{children}</>
}

/** 已登录用户访问登录 / 注册页时直接进入应用。 */
export function GuestOnly({ children }: { children: ReactNode }) {
  const session = useSession()
  if (session.token && session.user) {
    return <Navigate replace to={session.company ? '/assistant' : session.user.is_staff ? '/ops' : '/onboarding/company'} />
  }
  return <>{children}</>
}
