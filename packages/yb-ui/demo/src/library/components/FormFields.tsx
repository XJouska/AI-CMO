import { Fragment, useContext, createContext, useId, useState } from 'react'
import type { RenderCtx } from '../context'
import { str } from '../helpers'
import './form-fields.css'

const FocusGroup = createContext<{ active: string | null; setActive: (id: string | null) => void } | null>(null)

export function FormFieldsView({ ctx }: { ctx: RenderCtx }) {
  const [active, setActive] = useState<string | null>(null)
  const rows = Array.isArray(ctx.v('items')) ? ctx.v('items') as Record<string, unknown>[] : [{ cursor: 'On' }, { cursor: 'Off' }, { cursor: 'Off' }]
  return <FocusGroup.Provider value={{ active, setActive }}>
    <div className={`yb-form-fields ${ctx.className}`}>
      {ctx.children ?? rows.map((row, index) => <Fragment key={index}>
        {ctx.renderNamed('20865:4141', row)}
      </Fragment>)}
    </div>
  </FocusGroup.Provider>
}

export function FormFieldsItemView({ ctx }: { ctx: RenderCtx }) {
  const id = useId()
  const group = useContext(FocusGroup)
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')
  const value = typeof ctx.v('value') === 'string' ? String(ctx.v('value')) : draft
  const cursor = !focused && !value && str(ctx.v('cursor'), 'On') === 'On' && !group?.active
  return <label className={`yb-form-fields-item ${ctx.className}`} htmlFor={id}>
    <span className="yb-form-fields-title">{str(ctx.v('title'), '标题')}</span>
    <span className="yb-form-fields-input">
      <input id={id} value={value} placeholder={str(ctx.v('placeholder'), '请输入内容')}
        maxLength={typeof ctx.v('maxLength') === 'number' ? Number(ctx.v('maxLength')) : undefined}
        onFocus={() => { setFocused(true); group?.setActive(id); ctx.onAction?.('focus') }}
        onBlur={() => { setFocused(false); group?.setActive(null); ctx.onAction?.('blur') }}
        onChange={event => {
          setDraft(event.target.value)
          const change = ctx.v('onChange')
          if (typeof change === 'function') change(event.target.value)
        }} />
      {cursor && <i aria-hidden className="yb-form-fields-cursor" />}
    </span>
  </label>
}
