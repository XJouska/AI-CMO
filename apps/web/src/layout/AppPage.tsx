// 工作台页面容器：顶栏（手机菜单按钮、返回、标题、操作）+ 内容区（可带左侧二级导航）。
import { ArrowLeft, Menu } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BRAND } from '@/brand'
import { t } from '@/i18n'
import { cx, IconButton } from '@/ui'
import { useShellNav } from './AppLayout'

export interface AppPageProps {
  title: ReactNode
  /** 用于浏览器标题（title 不是纯文本时传入） */
  documentTitle?: string
  description?: ReactNode
  /** 返回目标：路径；true 表示返回上一页 */
  back?: string | true
  actions?: ReactNode
  /** 内容宽度：default 1120px，narrow 720px，full 铺满（页面自行布局） */
  width?: 'default' | 'narrow' | 'full'
  /** 标题下方的工具条（例如分类标签） */
  toolbar?: ReactNode
  className?: string
  children: ReactNode
}

export function AppPage({ title, documentTitle, description, back, actions, width = 'default', toolbar, className, children }: AppPageProps) {
  const navigate = useNavigate()
  const { openNav } = useShellNav()
  const docTitle = documentTitle ?? (typeof title === 'string' ? title : '')

  useEffect(() => {
    document.title = docTitle ? `${docTitle} · ${BRAND.name}` : BRAND.name
  }, [docTitle])

  return (
    <div className={cx('app-page', `app-page--${width}`, className)}>
      <header className="app-topbar">
        <div className="app-topbar__inner">
          <IconButton className="app-topbar__menu" icon={Menu} label={t.shell.menu} onClick={openNav} />
          {back ? (
            <IconButton
              className="app-topbar__back"
              icon={ArrowLeft}
              label={t.shell.back}
              onClick={() => (back === true ? navigate(-1) : navigate(back))}
            />
          ) : null}
          <div className="app-topbar__heading">
            <h1 className="app-topbar__title">{title}</h1>
            {description ? <p className="app-topbar__desc">{description}</p> : null}
          </div>
          {actions ? <div className="app-topbar__actions">{actions}</div> : null}
        </div>
        {toolbar ? <div className="app-topbar__toolbar">{toolbar}</div> : null}
      </header>
      <div className="app-page__body">
        <main className="app-page__content">{children}</main>
      </div>
    </div>
  )
}
