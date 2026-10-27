import { useLayoutEffect, type RefObject } from 'react'

export const HOST_CONTRAST_CLASS = 'yb-host-contrast'

const SKIP_SELECTOR = '[data-skip-contrast], [role="toolbar"], .yb-navbar, .yb-tabbar, .yb-switch, .yb-tab'

function parseColor(input: string): [number, number, number, number] | null {
  const value = input.trim().toLowerCase()
  if (!value || value === 'transparent') return [0, 0, 0, 0]
  const rgb = value.match(/^rgba?\((.+)\)$/)
  if (!rgb) return null
  const parts = rgb[1]
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean)
  if (parts.length < 3) return null
  const channel = (part: string, index: number) => {
    if (part.endsWith('%')) return (parseFloat(part) / 100) * (index === 3 ? 1 : 255)
    const parsed = parseFloat(part)
    return index === 3 && parsed > 1 ? parsed / 255 : parsed
  }
  return [
    channel(parts[0], 0),
    channel(parts[1], 1),
    channel(parts[2], 2),
    parts[3] === undefined ? 1 : channel(parts[3], 3),
  ]
}

function isTransparent(input: string) {
  const parsed = parseColor(input)
  return !parsed || parsed[3] < 0.01
}

function colorsMatch(left: string, right: string) {
  const a = parseColor(left)
  const b = parseColor(right)
  if (!a || !b || a[3] < 0.01 || b[3] < 0.01) return false
  return Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2 && Math.abs(a[2] - b[2]) <= 2
}

function hasOwnOutline(style: CSSStyleDeclaration) {
  if (style.boxShadow && style.boxShadow !== 'none') return true
  const widths = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
  const styles = [style.borderTopStyle, style.borderRightStyle, style.borderBottomStyle, style.borderLeftStyle]
  return widths.some((width, index) => parseFloat(width || '0') > 0 && styles[index] !== 'none')
}

function isVisible(el: Element, style: CSSStyleDeclaration) {
  if (style.display === 'none' || style.visibility === 'hidden') return false
  const rect = el.getBoundingClientRect()
  return rect.width >= 1 && rect.height >= 1
}

function visit(node: Element, canvasBg: string) {
  for (const child of Array.from(node.children)) {
    if (child.matches(SKIP_SELECTOR)) continue
    const style = getComputedStyle(child)
    if (!isVisible(child, style)) continue
    if (hasOwnOutline(style)) continue
    if (!isTransparent(style.backgroundColor) && colorsMatch(style.backgroundColor, canvasBg)) {
      child.classList.add(HOST_CONTRAST_CLASS)
      continue
    }
    visit(child, canvasBg)
  }
}

export function applyHostContrast(root: HTMLElement, canvas: HTMLElement = root) {
  root.querySelectorAll(`.${HOST_CONTRAST_CLASS}`).forEach((node) => {
    node.classList.remove(HOST_CONTRAST_CLASS)
  })
  visit(root, getComputedStyle(canvas).backgroundColor)
}

export function clearHostContrast(root: HTMLElement) {
  root.querySelectorAll(`.${HOST_CONTRAST_CLASS}`).forEach((node) => {
    node.classList.remove(HOST_CONTRAST_CLASS)
  })
}

export function useHostContrast<T extends HTMLElement>(
  rootRef: RefObject<T | null>,
  canvasRef?: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const canvas = canvasRef?.current ?? root
    let ignore = false
    let frame = 0

    const apply = () => {
      if (ignore) return
      ignore = true
      applyHostContrast(root, canvas)
      frame = window.requestAnimationFrame(() => {
        ignore = false
      })
    }

    apply()
    const mutations = new MutationObserver((records) => {
      const relevant = records.some((record) => {
        if (record.type === 'childList') return true
        if (record.attributeName !== 'class') return true
        const previous = (record.oldValue ?? '').split(/\s+/).filter((name) => name && name !== HOST_CONTRAST_CLASS)
        const next = ((record.target as Element).getAttribute('class') ?? '')
          .split(/\s+/)
          .filter((name) => name && name !== HOST_CONTRAST_CLASS)
        return previous.join(' ') !== next.join(' ')
      })
      if (relevant) apply()
    })
    mutations.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-canvas'],
    })
    const resize = new ResizeObserver(apply)
    resize.observe(root)
    if (canvas !== root) resize.observe(canvas)

    return () => {
      mutations.disconnect()
      resize.disconnect()
      window.cancelAnimationFrame(frame)
      clearHostContrast(root)
    }
  }, [canvasRef, rootRef])
}
