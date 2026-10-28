// 文本排版组件：标题、段落、列表、引用、分割线。内容一律作为 React 子节点渲染，不注入 HTML。
import type { ReactNode } from 'react'
import { cx } from './cx'

export function Heading({ level = 3, children, className }: { level?: 1 | 2 | 3 | 4; children: ReactNode; className?: string }) {
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4'
  return <Tag className={cx('ui-h', `ui-h${level}`, className)}>{children}</Tag>
}

export function Text({ children, tone, size, className }: { children: ReactNode; tone?: 'secondary' | 'muted'; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <p className={cx('ui-text', tone && `ui-text--${tone}`, size && `ui-text--${size}`, className)}>{children}</p>
}

export function BulletList({ items, className }: { items: readonly ReactNode[]; className?: string }) {
  return (
    <ul className={cx('ui-ul', className)}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  )
}

export function NumberList({ items, className }: { items: readonly ReactNode[]; className?: string }) {
  return (
    <ol className={cx('ui-ol', className)}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ol>
  )
}

export function Quote({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'warning' | 'accent'; className?: string }) {
  return <blockquote className={cx('ui-quote', `ui-quote--${tone}`, className)}>{children}</blockquote>
}

export function Divider() {
  return <hr className="ui-divider" />
}

export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ui-prose', className)}>{children}</div>
}
