// 登录 / 注册 / 邀请 / 建档流程布局：桌面左侧产品介绍，右侧表单卡片；手机只显示表单。
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { BRAND } from '@/brand'
import logoUrl from '@/brand/logo.svg'
import { t } from '@/i18n'
import { cx } from '@/ui'

export function AuthLayout() {
  return (
    <div className="auth">
      <aside className="auth__intro">
        <Link aria-label={BRAND.name} className="site-logo site-logo--inverse" to="/">
          <img alt="" height={28} src={logoUrl} width={28} />
          <span>{BRAND.name}</span>
        </Link>
        <div className="auth__pitch">
          <h2>{t.home.headline}</h2>
          <ul>
            {t.auth.points.map((point) => (
              <li key={point}>
                <Check aria-hidden size={16} />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="auth__foot">{t.home.footer.copyright(new Date().getFullYear())}</p>
      </aside>
      <div className="auth__panel">
        <Link aria-label={BRAND.name} className="site-logo auth__mobile-logo" to="/">
          <img alt="" height={28} src={logoUrl} width={28} />
          <span>{BRAND.name}</span>
        </Link>
        <Outlet />
      </div>
    </div>
  )
}

export interface AuthCardProps {
  title: ReactNode
  description?: ReactNode
  /** 宽卡片：建档流程、确认变更等内容较多的页面 */
  wide?: boolean
  /** 顶部步骤条 */
  steps?: { labels: readonly string[]; current: number }
  footer?: ReactNode
  back?: ReactNode
  children: ReactNode
}

export function AuthCard({ title, description, wide, steps, footer, back, children }: AuthCardProps) {
  return (
    <div className={cx('auth-card', wide && 'auth-card--wide')}>
      {back ? <div className="auth-card__back">{back}</div> : null}
      {steps ? <Steps current={steps.current} labels={steps.labels} /> : null}
      <div className="auth-card__head">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="auth-card__body">{children}</div>
      {footer ? <div className="auth-card__footer">{footer}</div> : null}
    </div>
  )
}

export function Steps({ labels, current }: { labels: readonly string[]; current: number }) {
  return (
    <ol aria-label={t.onboarding.stepsLabel} className="steps">
      {labels.map((label, index) => (
        <li aria-current={index === current ? 'step' : undefined} className={cx('steps__item', index < current && 'is-done', index === current && 'is-current')} key={label}>
          <span className="steps__dot">{index < current ? <Check aria-hidden size={12} strokeWidth={3} /> : index + 1}</span>
          <span className="steps__label">{label}</span>
        </li>
      ))}
    </ol>
  )
}
