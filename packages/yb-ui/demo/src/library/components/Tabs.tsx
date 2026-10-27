import { useState } from 'react'
import type { RenderCtx } from '../context'
import { contentOr, str } from '../helpers'
import './tabs.css'

export function TabItemView({ ctx }: { ctx: RenderCtx }) {
  const selected = str(ctx.v('type'), 'selected') === 'selected'
  return <button type="button" role="tab" aria-selected={selected}
    className={`yb-tab-item ${ctx.className}`} data-selected={selected}
    onClick={() => ctx.onAction?.('select')}>
    {contentOr(ctx.children, selected ? 'Selected' : 'Unselected')}
  </button>
}

export function TabView({ ctx }: { ctx: RenderCtx }) {
  const [selected, setSelected] = useState(0)
  const items = Array.isArray(ctx.v('items')) ? ctx.v('items') as string[] : ['全部', '已安装', '未安装']
  return <div className={`yb-tab ${ctx.className}`} role="tablist"
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      const current = tabs.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click()
    }}>
    {ctx.renderSlot(ctx.v('slot'), ctx.children ?? items.map((label, index) =>
      <span className="yb-tab-cell" key={index}>
        {ctx.renderNamed('19839:16296', { type: selected === index ? 'selected' : 'unselected',
          onAction: () => { setSelected(index); ctx.onAction?.(`tab:${index}`) } }, label)}
      </span>))}
  </div>
}
