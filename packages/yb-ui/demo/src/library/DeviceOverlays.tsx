import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './device-overlays.css'

const Root = createContext<HTMLElement | null | undefined>(undefined)
const inertLocks = new WeakMap<HTMLElement, { count: number; original: boolean }>()

/** Mount once inside the device canvas, outside scrolling/transformed content. */
export function DeviceOverlayProvider({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  return (
    <Root.Provider value={root}>
      {children}
      <div className="yb-device-overlays" ref={setRoot} />
    </Root.Provider>
  )
}

function useRoot() {
  const root = useContext(Root)
  if (root === undefined) throw new Error('Overlay requires HostCanvas or DeviceOverlayProvider')
  return root
}

export function ModalLayer({ children, mask, kind, label, onClose }: {
  children: ReactNode
  mask: ReactNode
  kind: 'dialog' | 'sheet'
  label: string
  onClose: () => void
}) {
  const root = useRoot()
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const element = panel.current
    if (!root || !element) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const siblings = [...(root.parentElement?.children ?? [])].filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node !== root,
    )
    siblings.forEach(node => {
      const lock = inertLocks.get(node) ?? { count: 0, original: node.inert }
      lock.count++
      inertLocks.set(node, lock)
      node.inert = true
    })
    element.focus()
    function keydown(event: KeyboardEvent) {
      const panels = root!.querySelectorAll('[data-modal-panel]')
      if (panels[panels.length - 1] !== element) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close.current()
      }
      if (event.key === 'Tab') {
        const controls = [...element!.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        )].filter(node => node.getClientRects().length > 0 && !node.closest('[inert]'))
        const index = controls.indexOf(document.activeElement as HTMLElement)
        event.preventDefault()
        if (!controls.length) element!.focus()
        else controls[index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus()
      }
    }
    document.addEventListener('keydown', keydown, true)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      siblings.forEach(node => {
        const lock = inertLocks.get(node)!
        if (--lock.count === 0) {
          node.inert = lock.original
          inertLocks.delete(node)
        }
      })
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus()
    }
  }, [root])
  if (!root) return null
  return createPortal(
    <div className={`yb-modal-layer is-${kind}`}>
      <div className="yb-modal-mask">{mask}</div>
      <div aria-label={label} aria-modal="true" className="yb-modal-panel"
        data-modal-panel ref={panel} role="dialog" tabIndex={-1}>
        {children}
      </div>
    </div>, root,
  )
}

/** Lifecycle stays with the task: do not replace Sheet children with Loading. */
export function FeedbackLayer({ children, kind }: {
  children: ReactNode
  kind: 'toast' | 'loading'
}) {
  const root = useRoot()
  if (!root) return null
  return createPortal(
    <div className={`yb-feedback-layer is-${kind}`} data-feedback-kind={kind}>
      <div className="yb-feedback-content" role="status" aria-live="polite">{children}</div>
    </div>, root,
  )
}
