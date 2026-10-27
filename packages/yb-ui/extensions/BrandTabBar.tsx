// 本地扩展：可配置 Tab 的底部导航。
//
// 原因：正式 TabBar 的四个 Tab 文案和图标写死为设计包品牌（见 demo/src/library/components/Navigation.tsx
// 的 TAB_ITEMS），没有公开属性可以修改。本组件只复用正式 TabBar 的 DOM 结构与 CSS 类名
// （yb-tabbar / yb-tabbar-dock / yb-tabbar-body / yb-tabbar-icon / yb-tabbar-mode-icon / yb-tabbar-label），
// 输入框直接使用正式 AgentInput，徽标使用正式 BadgeDot / BadgeNumber，不新增任何视觉样式。
// 登记位置：docs/ui-gaps.md「GAP-001」。
import type { KeyboardEvent } from 'react'
import { AgentInput, BadgeDot, BadgeNumber } from '../demo/src/generated/components'

export type BrandTabTone = 'ask' | 'primary' | 'secondary'

export interface BrandTabItem {
  id: string
  label: string
  /** 设计包 public/icons 下的未选中图标文件名（不含扩展名），以遮罩方式着色 */
  icon: string
  /** 选中态图标文件名；不传时沿用 icon */
  iconOn?: string
  /** 该 Tab 页面背景对应的底栏色调：ask=对话页，primary=白底页，secondary=灰底页 */
  tone: BrandTabTone
  badge?: number
  dot?: boolean
}

export type BrandTabInputState = 'idle' | 'generating'

export interface BrandTabInputProps {
  value: string
  placeholder: string
  state: BrandTabInputState
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
}

export interface BrandTabBarProps {
  items: readonly BrandTabItem[]
  selectedId: string
  onSelect: (id: string) => void
  /** 传入时在底栏上方显示正式 AgentInput（对应正式 TabBar 的 "Tab 1 & Input" 变体） */
  input?: BrandTabInputProps
  ariaLabel?: string
}

function maskStyle(icon: string) {
  const src = `/icons/${icon}.svg`
  return { WebkitMaskImage: `url("${src}")`, maskImage: `url("${src}")` }
}

export function BrandTabBar({ items, selectedId, onSelect, input, ariaLabel = '主导航' }: BrandTabBarProps) {
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selectedId))
  const tone = items[selectedIndex]?.tone ?? 'ask'
  const dataSelected = input ? 'Tab 1 & Input' : `Tab ${selectedIndex + 1}`

  function onInputAction(action: string) {
    if (!input) return
    if (action === 'send') input.onSend()
    if (action === 'stop') input.onStop()
  }

  // 正式 AgentInput 的原生输入框不处理回车；在底栏根节点上补充回车发送，不改变组件外观。
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!input || event.key !== 'Enter' || event.nativeEvent.isComposing) return
    const target = event.target as HTMLElement
    if (!target.classList.contains('yb-agent-native')) return
    event.preventDefault()
    if (input.state === 'idle') input.onSend()
  }

  return (
    <div className="yb-tabbar brand-tabbar" data-selected={dataSelected} data-tone={tone} onKeyDown={onKeyDown}>
      {input ? (
        <AgentInput
          leftBtn={false}
          onAction={onInputAction}
          onChange={input.onChange}
          placeholder={input.placeholder}
          rightType={input.state === 'generating' ? 'Stop & Plus' : 'Send Only'}
          type={input.state === 'generating' ? 'Stopped' : 'Default'}
          value={input.value}
        />
      ) : null}
      <div className="yb-tabbar-dock">
        <nav aria-label={ariaLabel} className="yb-tabbar-body">
          {items.map((item) => {
            const on = item.id === selectedId
            return (
              <button
                aria-current={on ? 'page' : undefined}
                className={on ? 'is-on' : ''}
                key={item.id}
                onClick={() => onSelect(item.id)}
                type="button"
              >
                <span className="yb-tabbar-icon">
                  <span aria-hidden className="yb-tabbar-mode-icon" style={maskStyle(on ? (item.iconOn ?? item.icon) : item.icon)} />
                  {item.dot ? <BadgeDot /> : null}
                  {item.badge ? <BadgeNumber>{String(item.badge)}</BadgeNumber> : null}
                </span>
                <span className="yb-tabbar-label">{item.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
