import { useEffect, useState } from 'react'
import { boolish, isEmptySlot, str } from '../helpers'
import { Icon } from '../Icon'
import type { RenderCtx } from '../context'
import iconVariants from '../icon-variants.json'

export function MaskView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'popup mask')
  return (
    <div
      className={`yb-mask ${ctx.className}`.trim()}
      data-type={type}
      onClick={() => ctx.onAction?.('mask')}
    />
  )
}

export function DividerView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'default')
  const direction = str(ctx.v('direction'), 'horizontal')
  const legal =
    (type === 'default' && (direction === 'horizontal' || direction === 'vertical')) ||
    ((type === 'withLabel' || type === 'PAI') && direction === 'horizontal')
  const resolvedType = legal ? type : 'default'
  const resolvedDirection = legal ? direction : 'horizontal'

  return (
    <div
      className={`yb-divider yb-divider-${resolvedType} yb-divider-${resolvedDirection} ${ctx.className}`.trim()}
      data-type={resolvedType}
      data-direction={resolvedDirection}
    >
      {resolvedType !== 'default' ? <span>{ctx.children ?? 'Label'}</span> : null}
    </div>
  )
}

export function IconAssetView({ ctx }: { ctx: RenderCtx }) {
  const spec = (iconVariants as Record<string, { properties: string[]; size: number; variants: Record<string, string> }>)[ctx.asset.nodeId]
  const variant = spec?.variants[spec.properties.map(prop => str(ctx.v(prop))).join('|')]
  const mark = spec
    ? <img alt="" aria-hidden src={`/figma-assets/${variant}.svg`} width={spec.size} height={spec.size}
        data-exact-icon-variant={variant} style={{ display: 'block', flex: 'none' }} />
    : <Icon decorative name={ctx.asset.name} nodeId={ctx.asset.nodeId} size={24} />
  if (boolish(ctx.v('decorative')) || spec) return mark
  const label = ctx.asset.name.replace(/^Icon\//i, '').replace(/^ICON\//, '')
  return (
    <button
      aria-label={label}
      className={`yb-icon-button ${ctx.className}`.trim()}
      onClick={() => ctx.onAction?.('press')}
      title={ctx.asset.name}
      type="button"
    >
      {mark}
    </button>
  )
}

export function MenuDividerView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'horiThin')
  return (
    <div className={`yb-menu-div ${ctx.className}`.trim()} data-type={type} role="separator">
      <i />
    </div>
  )
}

function usePressed(pressedProp: string, onAction?: (action: string) => void) {
  const [pressed, setPressed] = useState(pressedProp)
  useEffect(() => {
    setPressed(pressedProp)
  }, [pressedProp])
  function onPress() {
    setPressed((current) => (current === 'on' ? 'off' : 'on'))
    onAction?.('press')
  }
  return { onPress, pressed }
}

function MenuVerticalItemView({ ctx }: { ctx: RenderCtx }) {
  const { onPress, pressed } = usePressed(str(ctx.v('pressed'), 'off'), ctx.onAction)
  return (
    <button
      className={`yb-menu-vitem ${ctx.className}`.trim()}
      data-pressed={pressed}
      onClick={onPress}
      type="button"
    >
      <span className="yb-menu-vitem-icon">
        {isEmptySlot(ctx.v('icon')) ? <Icon decorative name="Icon/A" size={22} /> : ctx.renderSlot(ctx.v('icon'))}
      </span>
      <span className="yb-menu-vitem-label">{ctx.children ?? '选项'}</span>
    </button>
  )
}

function MenuHorizontalItemView({ ctx }: { ctx: RenderCtx }) {
  const { onPress, pressed } = usePressed(str(ctx.v('pressed'), 'off'), ctx.onAction)
  const check = boolish(ctx.v('check'))
  const entry = boolish(ctx.v('entry'))
  const desc = boolish(ctx.v('desc'))
  return (
    <button
      className={`yb-menu-hitem ${ctx.className}`.trim()}
      data-desc={desc ? 'true' : 'false'}
      data-pressed={pressed}
      onClick={onPress}
      type="button"
    >
      <span className="yb-menu-hitem-icon">
        {isEmptySlot(ctx.v('icon')) ? <Icon decorative name="Icon/A" size={22} /> : ctx.renderSlot(ctx.v('icon'))}
      </span>
      <span className="yb-menu-hitem-text">
        <strong>{ctx.children ?? '选项'}</strong>
        {desc ? <small>这里是副标题</small> : null}
      </span>
      {check ? ctx.renderNamed('Radio & CheckBox', { type: 'plain', state: 'checked', size: 'sm' }) : null}
      {entry ? <Icon className="yb-menu-hitem-entry" decorative name="Icon/chevron-right" size={16} /> : null}
    </button>
  )
}

export function MenuItemView({ ctx }: { ctx: RenderCtx }) {
  if (ctx.asset.name.includes('vertical')) return <MenuVerticalItemView ctx={ctx} />
  return <MenuHorizontalItemView ctx={ctx} />
}

function MenuHorizontalView({ ctx }: { ctx: RenderCtx }) {
  const showHeader = boolish(ctx.v('showHeaderItem'))
  const showGroup = boolish(ctx.v('showGroupItem'))
  const header = showHeader
    ? (isEmptySlot(ctx.v('headerItems')) ? (
        <div className="yb-menu-h-header">
          <div className="yb-menu-h-icons">
            {ctx.renderNamed('menu/vertical/item')}
            {ctx.renderNamed('menu/divider', { type: 'vertical' })}
            {ctx.renderNamed('menu/vertical/item')}
          </div>
          {ctx.renderNamed('menu/divider', { type: 'horiBold' })}
        </div>
      ) : (
        ctx.renderSlot(ctx.v('headerItems'))
      ))
    : null

  const defaults = isEmptySlot(ctx.v('defaultItems')) ? (
    <>
      {ctx.renderNamed('menu/horizontal/item')}
      {ctx.renderNamed('menu/horizontal/item')}
      {ctx.renderNamed('menu/horizontal/item')}
    </>
  ) : (
    ctx.renderSlot(ctx.v('defaultItems'))
  )

  const group = showGroup
    ? (isEmptySlot(ctx.v('groupItem')) ? (
        <>
          {ctx.renderNamed('menu/divider', { type: 'horiThin' })}
          {ctx.renderNamed('menu/horizontal/item')}
        </>
      ) : (
        ctx.renderSlot(ctx.v('groupItem'))
      ))
    : null

  return (
    <div className={`yb-menu-h ${ctx.className}`.trim()}>
      {header}
      <div className="yb-menu-h-list">{defaults}</div>
      {group ? <div className="yb-menu-h-group">{group}</div> : null}
    </div>
  )
}

function MenuVerticalView({ ctx }: { ctx: RenderCtx }) {
  const direction = str(ctx.v('direction'), 'up')
  const showGroup = boolish(ctx.v('showGroupItems'))
  const defaults = isEmptySlot(ctx.v('defaultItems')) ? (
    <>
      {ctx.renderNamed('menu/vertical/item')}
      {ctx.renderNamed('menu/vertical/item')}
      {ctx.renderNamed('menu/vertical/item')}
    </>
  ) : (
    ctx.renderSlot(ctx.v('defaultItems'))
  )
  const group = showGroup
    ? (isEmptySlot(ctx.v('groupItems')) ? (
        <>
          {ctx.renderNamed('menu/divider', { type: 'vertical' })}
          {ctx.renderNamed('menu/vertical/item')}
        </>
      ) : (
        ctx.renderSlot(ctx.v('groupItems'))
      ))
    : null
  const caret = (
    <div className="yb-menu-v-arrow">
      <span className="yb-menu-v-caret" />
    </div>
  )
  return (
    <div className={`yb-menu-v ${ctx.className}`.trim()} data-direction={direction}>
      {direction === 'down' ? caret : null}
      <div className="yb-menu-v-card">
        <div className="yb-menu-v-defaults">{defaults}</div>
        {group}
      </div>
      {direction === 'up' ? caret : null}
    </div>
  )
}

export function MenuView({ ctx }: { ctx: RenderCtx }) {
  if (ctx.asset.name.includes('vertical')) return <MenuVerticalView ctx={ctx} />
  return <MenuHorizontalView ctx={ctx} />
}
