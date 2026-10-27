// 二级页面布局：顶部返回导航固定，中间内容滚动，底部可选固定操作区（主按钮）。
// 只负责布局分区，导航与按钮均为正式组件。
import type { ReactNode } from 'react'
import { NavBar } from '@yb/generated/components'
import { useNavigate } from 'react-router-dom'

interface StackPageProps {
  title: string
  surface?: 'primary' | 'secondary'
  /** 返回目标；不传时返回上一页 */
  backTo?: string
  /** 不显示返回按钮（例如登录页） */
  noBack?: boolean
  right?: ReactNode
  footer?: ReactNode
  children: ReactNode
}

export function StackPage({ title, surface = 'secondary', backTo, noBack, right, footer, children }: StackPageProps) {
  const navigate = useNavigate()
  return (
    <div className="page" data-surface={surface}>
      <div className="page-nav">
        <NavBar
          barType="Fixed Color Bg"
          divider={false}
          leftButton={!noBack}
          onAction={(action) => {
            if (action !== 'back') return
            if (backTo) navigate(backTo)
            else navigate(-1)
          }}
          rightButton={Boolean(right)}
          rightSlot={right}
          themeBg={false}
        >
          {title}
        </NavBar>
      </div>
      <main className="page-body">{children}</main>
      {footer ? <div className="page-footer">{footer}</div> : null}
    </div>
  )
}

/** 页面级加载态：正式 Loading 相对整屏居中。 */
export function PageCenter({ children }: { children: ReactNode }) {
  return <div className="page-empty">{children}</div>
}
