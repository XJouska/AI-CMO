import { useCallback, useState, type PointerEvent, type ReactNode } from 'react'
import type { RenderCtx } from '../context'
import { str } from '../helpers'
import './published-keyboard.css'

const ROW1 = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'] as const
const ROW2 = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'] as const
const ROW3 = ['z', 'x', 'c', 'v', 'b', 'n', 'm'] as const
const SUGGESTIONS = ['"introduced"', 'introduce', 'introduces'] as const

/** The published system keyboard is illustrative, not a second input engine. */
export function PublishedKeyboardView({ ctx }: { ctx: RenderCtx }) {
  if (str(ctx.v('property1'), 'Keyboard') === 'Numpad') {
    const hints = ['', 'ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQRS', 'TUV', 'WXYZ']
    return <div className={`yb-numpad ${ctx.className}`} role="img" aria-label="系统数字键盘">
      <div className="yb-numpad-grid" aria-hidden>
        {hints.map((hint, i) => <span className="yb-numpad-key" key={i}><span>{i + 1}</span><small>{hint}</small></span>)}
        <span /><span className="yb-numpad-key"><span>0</span></span>
        <span className="yb-numpad-delete" />
      </div>
    </div>
  }
  const key = (text: string) => <span className="yb-ime-key" key={text}><span className="yb-ime-glyph">{text}</span></span>
  return <div className={`yb-keyboard yb-system-keyboard ${ctx.className}`} role="img" aria-label="系统字母键盘">
    <div aria-hidden className="yb-ime-glass" />
    <div className="yb-ime-suggest" aria-hidden>
      {SUGGESTIONS.map((word, i) => <span className="yb-ime-suggest-item" key={word}>
        {!!i && <span className="yb-ime-suggest-rule" />}
        <span className="yb-ime-suggest-hit">{word}</span>
      </span>)}
    </div>
    <div className="yb-ime-rows" aria-hidden>
      <div className="yb-ime-row is-10">{ROW1.map(key)}</div>
      <div className="yb-ime-row is-9">{ROW2.map(key)}</div>
      <div className="yb-ime-row is-7">
        <span className="yb-ime-key is-mod" />
        <div className="yb-ime-letters">{ROW3.map(key)}</div>
        <span className="yb-ime-key is-mod" />
      </div>
      <div className="yb-ime-row is-bottom">
        <span className="yb-ime-key is-wide"><span className="yb-ime-glyph is-abc">ABC</span></span>
        <span className="yb-ime-key is-space" />
        <span className="yb-ime-key is-return"><ImeIcon height={18} width={20} src="/icons/keyboard-return.svg" /></span>
      </div>
    </div>
    <div className="yb-ime-footer" aria-hidden>
      <ImeIcon className="yb-ime-footer-mark" height={26.92} width={26.92} src="/icons/keyboard-emoji.svg" />
      <ImeIcon className="yb-ime-footer-mark is-mic" height={28.21} width={18.87} src="/icons/keyboard-mic.svg" />
    </div>
  </div>
}

function ImeIcon({
  src,
  width,
  height,
  className,
}: {
  src: string
  width: number
  height: number
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={`yb-icon ${className ?? ''}`.trim()}
      style={{
        height,
        width,
        WebkitMaskImage: `url("${src}")`,
        maskImage: `url("${src}")`,
      }}
    />
  )
}

function ImeKey({
  action,
  ariaLabel,
  className,
  edge,
  popup,
  pressed,
  onPressChange,
  onAction,
  children,
}: {
  action: string
  ariaLabel: string
  className?: string
  edge?: 'start' | 'end'
  popup?: string
  pressed: boolean
  onPressChange: (action: string, next: boolean) => void
  onAction?: (action: string) => void
  children?: ReactNode
}) {
  const endPress = useCallback(() => {
    onPressChange(action, false)
  }, [action, onPressChange])

  return (
    <button
      aria-label={ariaLabel}
      className={`yb-ime-key ${className ?? ''} ${pressed ? 'is-pressed' : ''}`.trim()}
      onClick={() => onAction?.(action)}
      onPointerCancel={endPress}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        onPressChange(action, true)
      }}
      onPointerUp={endPress}
      type="button"
    >
      {popup && pressed ? (
        <span className={`yb-ime-pop ${edge ? `is-${edge}` : ''}`.trim()}>
          {popup}
        </span>
      ) : null}
      {children}
    </button>
  )
}

export function KeyboardView({ ctx }: { ctx: RenderCtx }) {
  const [pressed, setPressed] = useState<string | null>(null)
  const [shifted, setShifted] = useState(false)

  const onPressChange = useCallback((action: string, next: boolean) => {
    setPressed((current) => {
      if (next) return action
      return current === action ? null : current
    })
  }, [])

  const onAction = useCallback(
    (action: string) => {
      if (action === 'key:shift') setShifted((current) => !current)
      ctx.onAction?.(action)
    },
    [ctx],
  )

  function letter(label: string, edge?: 'start' | 'end') {
    const shown = shifted ? label.toUpperCase() : label
    const action = `key:${label}`
    return (
      <ImeKey
        action={action}
        ariaLabel={shown}
        className={shifted ? 'is-upper' : undefined}
        edge={edge}
        key={label}
        onAction={onAction}
        onPressChange={onPressChange}
        popup={shown}
        pressed={pressed === action}
      >
        <span className="yb-ime-glyph">{shown}</span>
      </ImeKey>
    )
  }

  return (
    <div
      className={`yb-keyboard ${shifted ? 'is-shifted' : ''} ${ctx.className}`.trim()}
      data-slot="slot-keyboard"
    >
      <div aria-hidden className="yb-ime-glass" />
      <div className="yb-ime-suggest">
        {SUGGESTIONS.map((word, index) => {
          const action = `suggest:${word}`
          return (
            <span className="yb-ime-suggest-item" key={word}>
              {index ? <span aria-hidden className="yb-ime-suggest-rule" /> : null}
              <button
                className={`yb-ime-suggest-hit ${pressed === action ? 'is-pressed' : ''}`.trim()}
                onClick={() => onAction(action)}
                onPointerCancel={() => onPressChange(action, false)}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  onPressChange(action, true)
                }}
                onPointerUp={() => onPressChange(action, false)}
                type="button"
              >
                {word}
              </button>
            </span>
          )
        })}
      </div>
      <div className="yb-ime-rows">
        <div className="yb-ime-row is-10">
          {ROW1.map((label, index) =>
            letter(label, index === 0 ? 'start' : index === ROW1.length - 1 ? 'end' : undefined),
          )}
        </div>
        <div className="yb-ime-row is-9">
          {ROW2.map((label) => letter(label))}
        </div>
        <div className="yb-ime-row is-7">
          <ImeKey
            action="key:shift"
            ariaLabel="Shift"
            className={`is-mod ${shifted ? 'is-on' : ''}`.trim()}
            onAction={onAction}
            onPressChange={onPressChange}
            pressed={pressed === 'key:shift'}
          >
            <ImeIcon className="yb-ime-mark" height={18} src="/icons/keyboard-shift.svg" width={18} />
          </ImeKey>
          <div className="yb-ime-letters">{ROW3.map((label) => letter(label))}</div>
          <ImeKey
            action="key:delete"
            ariaLabel="Delete"
            className="is-mod"
            onAction={onAction}
            onPressChange={onPressChange}
            pressed={pressed === 'key:delete'}
          >
            <ImeIcon className="yb-ime-mark" height={18} src="/icons/keyboard-delete.svg" width={18} />
          </ImeKey>
        </div>
        <div className="yb-ime-row is-bottom">
          <ImeKey
            action="key:abc"
            ariaLabel="ABC"
            className="is-wide"
            onAction={onAction}
            onPressChange={onPressChange}
            pressed={pressed === 'key:abc'}
          >
            <span className="yb-ime-glyph is-abc">ABC</span>
          </ImeKey>
          <ImeKey
            action="key:space"
            ariaLabel="Space"
            className="is-space"
            onAction={onAction}
            onPressChange={onPressChange}
            pressed={pressed === 'key:space'}
          />
          <ImeKey
            action="key:return"
            ariaLabel="Return"
            className="is-return"
            onAction={onAction}
            onPressChange={onPressChange}
            pressed={pressed === 'key:return'}
          >
            <ImeIcon className="yb-ime-mark is-return" height={18} src="/icons/keyboard-return.svg" width={20} />
          </ImeKey>
        </div>
      </div>
      <div className="yb-ime-footer">
        <button
          aria-label="Emoji"
          className={`yb-ime-footer-hit ${pressed === 'key:emoji' ? 'is-pressed' : ''}`.trim()}
          onClick={() => onAction('key:emoji')}
          onPointerCancel={() => onPressChange('key:emoji', false)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            onPressChange('key:emoji', true)
          }}
          onPointerUp={() => onPressChange('key:emoji', false)}
          type="button"
        >
          <ImeIcon className="yb-ime-footer-mark" height={26.92} src="/icons/keyboard-emoji.svg" width={26.92} />
        </button>
        <button
          aria-label="Microphone"
          className={`yb-ime-footer-hit ${pressed === 'key:mic' ? 'is-pressed' : ''}`.trim()}
          onClick={() => onAction('key:mic')}
          onPointerCancel={() => onPressChange('key:mic', false)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            onPressChange('key:mic', true)
          }}
          onPointerUp={() => onPressChange('key:mic', false)}
          type="button"
        >
          <ImeIcon className="yb-ime-footer-mark is-mic" height={28.21} src="/icons/keyboard-mic.svg" width={18.87} />
        </button>
      </div>
    </div>
  )
}
