import { boolish, contentOr, nodeFileId, str } from '../helpers'
import { Icon } from '../Icon'
import type { RenderCtx } from '../context'

export function StatusBarView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'iPhone')
  const iPad = type === 'iPad'
  return (
    <div className={`yb-status-bar ${ctx.className}`.trim()} data-type={type}>
      <span className="yb-status-time">
        {iPad ? (
          <>
            <span>9:41</span>
            <span>Tue Apr 1</span>
          </>
        ) : (
          '9:41'
        )}
      </span>
      <span aria-hidden className="yb-status-levels" />
    </div>
  )
}

export function NavBarTitleView({ ctx }: { ctx: RenderCtx }) {
  const dual = str(ctx.v('dualTitle'), 'False') === 'True'
  return (
    <div className={`yb-navbar-title ${dual ? 'is-dual' : ''} ${ctx.className}`.trim()}>
      <strong>{contentOr(ctx.children, dual ? '元宝' : '标题')}</strong>
      {dual ? (
        <span className="yb-navbar-subtitle">
          快速思考
          <span aria-hidden className="yb-navbar-subtitle-chevron" />
        </span>
      ) : null}
    </div>
  )
}

const BAR_NEW_ICONS = [
  { file: 'bar-new-read', label: '朗读' },
  { file: 'bar-new-call', label: '打电话' },
  { file: 'bar-new-tempchat', label: '临时对话' },
] as const

function BarNewGlyph({ file }: { file: string }) {
  return (
    <span
      aria-hidden
      className="yb-icon"
      style={{
        height: 24,
        WebkitMaskImage: `url("/icons/${file}.svg")`,
        maskImage: `url("/icons/${file}.svg")`,
        width: 24,
      }}
    />
  )
}

export function BarNewIconCluster({ onAction }: { onAction?: (action: string) => void }) {
  return (
    <div className="yb-navbar-btn-group" data-type="Multiple">
      {BAR_NEW_ICONS.map((item) => (
        <button
          aria-label={item.label}
          className="yb-navbar-btn-hit"
          key={item.file}
          onClick={() => onAction?.('nav-button')}
          type="button"
        >
          <BarNewGlyph file={item.file} />
        </button>
      ))}
    </div>
  )
}

export function NavBarButtonsView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'Single')
  const showLeft = ctx.v('showLeftIcon') === undefined ? true : boolish(ctx.v('showLeftIcon'))
  const showRight = boolish(ctx.v('showRightIcon'))

  if (type === 'Multiple') {
    return (
      <div className={`yb-navbar-btn-group ${ctx.className}`.trim()} data-type={type}>
        <span className="yb-navbar-btn-hit">
          {ctx.renderSlot(ctx.v('leftSlot'), <Icon name="Icon/Volume" size={24} />)}
        </span>
        <span className="yb-navbar-btn-hit">
          <Icon name="Icon/Call" size={24} />
        </span>
        <span className="yb-navbar-btn-hit">
          {showRight
            ? ctx.renderSlot(ctx.v('rightSlot'), <Icon name="Icon/TemporaryChat" size={24} />)
            : <Icon name="Icon/TemporaryChat" size={24} />}
        </span>
      </div>
    )
  }

  const labeled = type === 'Text' || type === 'Icon&Text'
  const backBadge = type === 'Back&Badge'

  return (
    <button
      className={`yb-navbar-btn ${labeled ? 'is-label' : ''} ${backBadge ? 'is-back-badge' : ''} ${ctx.className}`.trim()}
      data-type={type}
      onClick={() => ctx.onAction?.('nav-button')}
      type="button"
    >
      {type === 'Text' ? <span>{contentOr(ctx.children, '文字按钮')}</span> : null}
      {type === 'Icon&Text' ? (
        <>
          {showLeft ? ctx.renderSlot(ctx.v('leftSlot'), <Icon name="Icon/A" size={24} />) : null}
          <span>图标文字按钮</span>
          {showRight ? ctx.renderSlot(ctx.v('rightSlot'), <Icon name="Icon/A" size={24} />) : null}
        </>
      ) : null}
      {backBadge ? (
        <>
          <Icon name="Icon/chevron-left" size={24} />
          <b className="yb-navbar-count">3</b>
        </>
      ) : null}
      {type === 'Single'
        ? showLeft
          ? ctx.renderSlot(ctx.v('leftSlot'), <Icon name="Icon/A" size={24} />)
          : null
        : null}
    </button>
  )
}

function navBarBackground(
  barType: string,
  primaryBg: boolean,
  secondaryBg: boolean,
  themeBg: boolean,
  whiteBgH5: boolean,
) {
  if (barType.includes('Fixed')) {
    if (whiteBgH5) return 'h5'
    if (themeBg) return 'primary'
    return 'none'
  }
  if (secondaryBg) return 'secondary'
  if (primaryBg) return 'primary'
  return 'none'
}

export function NavBarView({ ctx }: { ctx: RenderCtx }) {
  const barType = str(ctx.v('barType'), 'Agent')
  const titleOn = ctx.v('title') === undefined ? true : boolish(ctx.v('title'))
  const leftOn = ctx.v('leftButton') === undefined ? true : boolish(ctx.v('leftButton'))
  const rightOn = ctx.v('rightButton') === undefined ? true : boolish(ctx.v('rightButton'))
  const divider = barType.includes('Fixed') && (ctx.v('divider') === undefined ? true : boolish(ctx.v('divider')))
  const agent = barType.startsWith('Agent') || barType === 'Bar new icon'
  const iPad = barType.includes('iPad')
  const redDot = boolish(ctx.v('redDot'))
  const badgeNumber = boolish(ctx.v('badgeNumber'))
  const primaryBg = ctx.v('primaryBg') === undefined ? true : boolish(ctx.v('primaryBg'))
  const secondaryBg = boolish(ctx.v('secondaryBg'))
  const themeBg = ctx.v('themeBg') === undefined ? true : boolish(ctx.v('themeBg'))
  const whiteBgH5 = boolish(ctx.v('whiteBGH5'))
  const bg = navBarBackground(barType, primaryBg, secondaryBg, themeBg, whiteBgH5)
  const title = contentOr(ctx.children, agent ? '元宝' : '标题')

  return (
    <header
      className={`yb-navbar ${divider ? 'has-divider' : ''} ${barType === 'Bar new icon' ? 'is-new-icon' : ''} ${ctx.className}`.trim()}
      data-bar-type={barType}
      data-bg={bg}
      data-device={iPad ? 'ipad' : 'iphone'}
    >
      {bg !== 'none' ? (
        <div aria-hidden className="yb-navbar-plate">
          <div className="yb-navbar-plate-status" />
          <div className="yb-navbar-plate-title" />
        </div>
      ) : null}
      {ctx.renderNamed('.StatusBar', { type: iPad ? 'iPad' : 'iPhone' })}
      <div className={`yb-navbar-row ${agent ? 'is-agent' : 'is-page'}`}>
        {leftOn ? (
          <div className="yb-navbar-left">
            {ctx.renderSlot(
              ctx.v('leftSlot'),
              <button aria-label={agent ? '打开侧边栏菜单' : '返回'} className="yb-navbar-btn" onClick={() => ctx.onAction?.('back')} type="button">
                <Icon name={agent ? 'Icon/sidebar-menu' : 'Icon/chevron-left'} size={24} />
              </button>,
            )}
            {redDot ? <i className="yb-navbar-reddot" /> : null}
            {badgeNumber ? <b className="yb-navbar-badge">2</b> : null}
            {agent && titleOn
              ? ctx.renderSlot(
                  ctx.v('middleSlot'),
                  ctx.renderNamed('.NavBar / Title', { dualTitle: 'True' }, title),
                )
              : null}
          </div>
        ) : (
          <span />
        )}

        {!agent && titleOn
          ? ctx.renderSlot(
              ctx.v('middleSlot'),
              ctx.renderNamed('.NavBar / Title', { dualTitle: 'False' }, title),
            )
          : null}

        {rightOn ? (
          <div className="yb-navbar-right">
            {agent
              ? ctx.renderSlot(
                  ctx.v('rightSlot'),
                  barType === 'Bar new icon' ? (
                    <BarNewIconCluster onAction={ctx.onAction} />
                  ) : (
                    ctx.renderNamed('NavBar / Buttons', { type: 'Multiple' })
                  ),
                )
              : ctx.renderSlot(
                  ctx.v('rightSlot'),
                  <button aria-label="更多" className="yb-navbar-btn" type="button">
                    <Icon name="Icon/More" size={24} />
                  </button>,
                )}
          </div>
        ) : (
          <span />
        )}
      </div>
    </header>
  )
}

const TAB_ITEMS = [
  { id: 'Tab 1', label: '问元宝', type: 'AskYuanbao' },
  { id: 'Tab 2', label: '派', type: 'Pai' },
  { id: 'Tab 3', label: '发现', type: 'Discovery' },
  { id: 'Tab 4', label: '我们', type: 'We' },
] as const

const TAB_MODE_NODES: Record<string, string> = {
  'AskYuanbao:off': '5544:3302',
  'AskYuanbao:on': '5544:3309',
  'Last time:on': '5544:3316',
  'Pai:off': '5544:3319',
  'Pai:on': '5544:3329',
  'Discovery:off': '5544:3334',
  'Discovery:on': '5544:3340',
  'We:off': '5544:3347',
  'We:on': '5544:3353',
}

function tabBarTone(selected: string) {
  if (selected === 'Tab 2') return 'primary'
  if (selected === 'Tab 3' || selected === 'Tab 4') return 'secondary'
  return 'ask'
}

export function TabBarIconView({ ctx }: { ctx: RenderCtx }) {
  return (
    <span className={`yb-tabbar-icon ${ctx.className}`.trim()}>
      {ctx.renderNamed('.TabBar / Icons-Mode Options', {
        type: str(ctx.v('type'), 'AskYuanbao'),
        state: str(ctx.v('state'), 'off'),
      })}
      {boolish(ctx.v('redDot')) ? ctx.renderNamed('Badge / Dot') : null}
      {boolish(ctx.v('badge')) ? ctx.renderNamed('Badge / Number') : null}
    </span>
  )
}

export function TabBarModeIconView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'AskYuanbao')
  const state = type === 'Last time' ? 'on' : str(ctx.v('state'), 'off')
  const nodeId = TAB_MODE_NODES[`${type}:${state}`] ?? TAB_MODE_NODES['AskYuanbao:off']
  const src = `/icons/${nodeFileId(nodeId)}.svg`
  return (
    <span
      aria-hidden
      className={`yb-tabbar-mode-icon ${ctx.className}`.trim()}
      style={{
        WebkitMaskImage: `url("${src}")`,
        maskImage: `url("${src}")`,
      }}
    />
  )
}

export function TabBarView({ ctx }: { ctx: RenderCtx }) {
  const selected = str(ctx.v('selected'), 'Tab 1 & Input')
  const selectedId = selected.startsWith('Tab 1') ? 'Tab 1' : selected
  const withInput = selected === 'Tab 1 & Input'
  const tone = tabBarTone(selectedId)
  const agentType = str(ctx.v('__agentType'), 'Default')

  return (
    <div className={`yb-tabbar ${ctx.className}`.trim()} data-selected={selected} data-tone={tone}>
      {withInput ? ctx.renderNamed('Agent Input', { type: agentType }) : null}
      <div className="yb-tabbar-dock">
        <nav className="yb-tabbar-body">
          {TAB_ITEMS.map((item) => {
            const on = item.id === selectedId
            return (
              <button
                className={on ? 'is-on' : ''}
                key={item.id}
                onClick={() => ctx.onAction?.(`tab:${item.id}`)}
                type="button"
              >
                {ctx.renderNamed('.TabBar / Icon', {
                  type: item.type,
                  state: on ? 'on' : 'off',
                })}
                <span className="yb-tabbar-label">{item.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}

export function BrowserToolbarView({ ctx }: { ctx: RenderCtx }) {
  return (
    <div className={`yb-browser-toolbar ${ctx.className}`.trim()}>
      <div className="yb-browser-toolbar-body">
        <button
          aria-label="后退"
          className="yb-browser-hit"
          onClick={() => ctx.onAction?.('back')}
          type="button"
        >
          {ctx.renderNamed('.BrowserToolbar/icon', { direction: 'Left', disable: 'False' })}
        </button>
        <button aria-label="前进" className="yb-browser-hit" disabled type="button">
          {ctx.renderNamed('.BrowserToolbar/icon', { direction: 'Right', disable: 'True' })}
        </button>
      </div>
    </div>
  )
}

const BROWSER_ICON_NODES: Record<string, string> = {
  'Left:False': '10785:4051',
  'Left:True': '10785:4050',
  'Right:False': '10785:4053',
  'Right:True': '10785:4052',
}

export function BrowserToolbarIconView({ ctx }: { ctx: RenderCtx }) {
  const direction = str(ctx.v('direction'), 'Left')
  const disabled = str(ctx.v('disable'), 'False') === 'True'
  const nodeId = BROWSER_ICON_NODES[`${direction}:False`] ?? BROWSER_ICON_NODES['Left:False']
  const src = `/icons/${nodeFileId(nodeId)}.svg`
  const label = direction === 'Left' ? '后退' : '前进'
  return (
    <span
      aria-disabled={disabled || undefined}
      aria-label={label}
      className={`yb-browser-icon ${disabled ? 'is-disabled' : ''} ${ctx.className}`.trim()}
      style={{
        WebkitMaskImage: `url("${src}")`,
        maskImage: `url("${src}")`,
      }}
    />
  )
}
