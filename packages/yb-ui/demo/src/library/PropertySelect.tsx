import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

interface Props {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}

export function PropertySelect({ label, value, options, onChange }: Props) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [portalTarget, setPortalTarget] = useState<Element | null>(null)
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null)
  const [active, setActive] = useState(0)
  const open = Boolean(position)

  function show() {
    setPortalTarget(trigger.current!.closest('.catalog-app'))
    const rect = trigger.current!.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    setPosition({
      left: rect.left,
      width: rect.width,
      ...(below >= 220 || below >= above ? { top: rect.bottom + 5 } : { bottom: window.innerHeight - rect.top + 5 }),
      maxHeight: Math.min(280, Math.max(below, above)),
    })
    setActive(Math.max(0, options.findIndex((option) => option.value === value)))
  }

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setPosition(null)
    }
    const closeOnScroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) setPosition(null)
    }
    const close = () => setPosition(null)
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  useEffect(() => {
    if (open) menu.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function choose(index: number) {
    if (options[index]) onChange(options[index].value)
    setPosition(null)
    trigger.current?.focus()
  }

  return (
    <>
      <button
        ref={trigger}
        className="property-select-trigger"
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => open ? setPosition(null) : show()}
        onBlur={() => setPosition(null)}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) {
            event.preventDefault()
            if (event.key === 'Escape') setPosition(null)
            else if (!open) show()
            else if (event.key === 'Enter' || event.key === ' ') choose(active)
            else setActive((index) => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
          } else if (event.key.length === 1) {
            const index = options.findIndex((option, index) => index > active && option.label.toLowerCase().startsWith(event.key.toLowerCase()))
            if (index >= 0) setActive(index)
          }
        }}
      >
        <span>{options.find((option) => option.value === value)?.label ?? value}</span>
        <Icon decorative name="Icon/chevron-down" size={14} />
      </button>
      {position && portalTarget && createPortal(
        <div ref={menu} id={id} role="listbox" aria-label={label} className="property-select-menu" style={position}>
          {options.map((option, index) => (
            <div
              id={`${id}-${index}`}
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={active === index ? 'active' : ''}
              onPointerMove={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <Icon decorative name="Icon/done" size={14} />}
            </div>
          ))}
        </div>,
        portalTarget,
      )}
    </>
  )
}
