import { useEffect, useState } from 'react'
import { boolish, contentImageSrc, contentOr, isEmptySlot, str } from '../helpers'
import { Icon } from '../Icon'
import type { RenderCtx } from '../context'
import { SwitchGraphic } from './SwitchGraphic'

const LIST_TYPES = new Set(['settings', 'smallFile', 'largeFile'])
const SETTINGS_STATES = new Set(['primary', 'secondary', 'withsubtitle'])
const SETTINGS_CELLS = new Set(['items', 'Radio', 'swtich'])

function clampListType(value: string) {
  return LIST_TYPES.has(value) ? value : 'settings'
}

function clampSettingsState(value: string) {
  return SETTINGS_STATES.has(value) ? value : 'primary'
}

function clampSettingsCell(value: string) {
  if (value === 'switch') return 'swtich'
  return SETTINGS_CELLS.has(value) ? value : 'items'
}

function defaultCellForState(state: string) {
  if (state === 'withsubtitle') return 'swtich'
  if (state === 'secondary') return 'items'
  return 'Radio'
}

function SettingsSwitch({
  defaultOn = true,
  onAction,
}: {
  defaultOn?: boolean
  onAction?: (action: string) => void
}) {
  const [on, setOn] = useState(defaultOn)
  return (
    <button
      aria-checked={on}
      className="yb-switch"
      data-checked={on}
      data-disabled={false}
      onClick={(event) => {
        event.stopPropagation()
        setOn((current) => !current)
        onAction?.('toggle')
      }}
      role="switch"
      type="button"
    >
      <SwitchGraphic checked={on} />
    </button>
  )
}

const FULL_WIDTH_TYPES = [
  '单行列表-常规',
  '单行列表-带开关',
  '双行列表-常规',
  '双行列表-带开关',
  '三行列表-常规',
  '三行列表-带开关',
  '居中按钮',
  '居中按钮-敏感操作',
] as const

function clampFullWidthType(value: string) {
  return (FULL_WIDTH_TYPES as readonly string[]).includes(value) ? value : '单行列表-常规'
}

function FullWidthTrailing({ ctx, showDot }: { ctx: RenderCtx; showDot: boolean }) {
  const trailingRaw = ctx.values.trailing
  const trailing = typeof trailingRaw === 'string' ? trailingRaw : str(ctx.v('trailing'), '描述文本')
  const trailingKind = str(ctx.v('trailingKind'), 'chevron')
  const avatarKind = str(ctx.v('avatarKind'), 'default')
  const iconName = trailingKind === 'more' ? 'Icon/More' : 'Icon/chevron-right'
  const showChevron = trailingKind === 'more' || trailingKind === 'chevron' || trailingKind === 'avatar'
  if (trailingKind === 'chevron') {
    return ctx.renderNamed('19766:24788', { type: '常规描述', showDot }, trailing)
  }
  return (
    <div className="yb-fullwidth-trailing">
      {trailingKind === 'avatar' ? (
        <span className="yb-fullwidth-avatar" data-kind={avatarKind}>
          <img alt="" src={contentImageSrc(ctx.v('imageSrc'), '/images/profile-avatar-default.png')} />
        </span>
      ) : null}
      {trailingKind === 'avatar' ? null : trailing ? <span className="yb-fullwidth-trailing-label">{trailing}</span> : null}
      {showDot ? ctx.renderNamed('Badge / Dot') : null}
      {showChevron ? (
        <button
          aria-label={trailingKind === 'more' ? '更多' : '下一级'}
          className="yb-fullwidth-trailing-icon"
          onClick={(event) => {
            event.stopPropagation()
            ctx.onAction?.(trailingKind === 'more' ? 'more' : 'open')
          }}
          type="button"
        >
          <Icon className="yb-list-chevron" decorative name={iconName} size={16} />
        </button>
      ) : null}
    </div>
  )
}

export function SettingsFullWidthItemView({ ctx }: { ctx: RenderCtx }) {
  const type = clampFullWidthType(str(ctx.v('type'), '单行列表-常规'))
  const showDot = boolish(ctx.v('showDot'))
  const withSwitch = type.endsWith('带开关')
  const centered = type.startsWith('居中按钮')
  const danger = type === '居中按钮-敏感操作'
  const lines = type.startsWith('三行') ? 3 : type.startsWith('双行') ? 2 : 1
  const title = contentOr(ctx.children, centered ? '按钮标题' : '列表标题')
  const subtitle = str(ctx.v('subtitle'), '标题下描述文本')
  const subtitle2 = str(ctx.v('subtitle2'), '其他文本内容')
  const trailingKind = str(ctx.v('trailingKind'), 'chevron')
  const rowOpen = !withSwitch && trailingKind !== 'none'

  if (centered) {
    return (
      <button
        className={`yb-fullwidth-item is-center ${ctx.className}`.trim()}
        data-type={type}
        onClick={() => ctx.onAction?.('press')}
        type="button"
      >
        <span className="yb-fullwidth-item-inner">
          <span className={`yb-fullwidth-center-label${danger ? ' is-danger' : ''}`}>{title}</span>
        </span>
        {showDot ? <i className="yb-fullwidth-item-dot" /> : null}
      </button>
    )
  }

  return (
    <div
      className={`yb-fullwidth-item ${ctx.className}`.trim()}
      data-type={type}
      onClick={() => {
        if (rowOpen) ctx.onAction?.('open')
      }}
      role={rowOpen ? 'button' : undefined}
      tabIndex={rowOpen ? 0 : undefined}
      onKeyDown={event => {
        if (event.target === event.currentTarget && rowOpen && ['Enter', ' '].includes(event.key)) {
          event.preventDefault()
          ctx.onAction?.('open')
        }
      }}
    >
      <div className="yb-fullwidth-item-inner">
        <div className="yb-fullwidth-copy">
          {ctx.renderNamed('19766:24963', { type: '常规' }, title)}
          {lines === 2 ? <span className="yb-fullwidth-sub">{subtitle}</span> : null}
          {lines === 3 ? (
            <div className="yb-fullwidth-subs">
              <span className="yb-fullwidth-sub">{subtitle}</span>
              <span className="yb-fullwidth-sub">{subtitle2}</span>
            </div>
          ) : null}
        </div>
        {withSwitch ? (
          <span className="yb-fullwidth-switch">
            {ctx.renderNamed('19766:24805', { state: 'off' })}
          </span>
        ) : (
          <FullWidthTrailing ctx={ctx} showDot={showDot} />
        )}
      </div>
    </div>
  )
}

function FileGlyph({ ctx }: { ctx: RenderCtx }) {
  if (!isEmptySlot(ctx.v('icon'))) return ctx.renderSlot(ctx.v('icon'))
  return ctx.renderNamed('2850:10220', { file: 'PDF' })
}

export function ListView({ ctx }: { ctx: RenderCtx }) {
  const type = clampListType(str(ctx.v('type'), 'settings'))
  const showHeader = ctx.v('showHeader') === undefined ? true : boolish(ctx.v('showHeader'))
  const fileIcon = type === 'largeFile' ? 'right' : 'left'
  const fileRow = () => ctx.renderNamed('File/items', { icon2: fileIcon, showTime: true }, '列表标题')

  if (type === 'smallFile' || type === 'largeFile') {
    const middle =
      type === 'largeFile'
        ? ctx.renderSlot(ctx.v('leftSlot'), fileRow())
        : ctx.renderSlot(ctx.v('rightSlot'), fileRow())
    return (
      <div className={`yb-list yb-list-files ${ctx.className}`.trim()} data-type={type}>
        {fileRow()}
        {middle}
        {fileRow()}
      </div>
    )
  }

  const settingsBody = ctx.renderSlot(
    ctx.v('slot'),
    <>
      {ctx.renderNamed('Settings/items', { state: 'primary', __cell: 'items' }, '设置项')}
      {ctx.renderNamed('Settings/items', { state: 'primary', __cell: 'items' }, '设置项')}
      {ctx.renderNamed('Settings/items', { state: 'withsubtitle', __cell: 'swtich' }, '设置项')}
      {ctx.renderNamed(
        'Settings/items',
        { state: 'withsubtitle', __cell: 'swtich', __subtitle: '注意最后一行要隐藏分割线' },
        '设置项',
      )}
    </>,
  )

  return (
    <div className={`yb-list yb-list-settings ${ctx.className}`.trim()} data-type="settings">
      {showHeader ? <div className="yb-list-header">分组标题</div> : null}
      <div className="yb-list-card">{settingsBody}</div>
    </div>
  )
}

export function SettingsItemsView({ ctx }: { ctx: RenderCtx }) {
  const state = clampSettingsState(str(ctx.v('state'), 'primary'))
  const cell = clampSettingsCell(str(ctx.v('__cell'), defaultCellForState(state)))
  const title = contentOr(ctx.children, state === 'secondary' ? '副设置项' : '设置项')
  const subtitle = str(ctx.v('__subtitle'), '这里是副文案')

  return (
    <div className={`yb-list-row yb-list-row-${state} ${ctx.className}`.trim()} data-state={state}>
      <div className="yb-list-cell">
        {state === 'secondary' ? (
          <div className="yb-list-secondary">
            <span aria-hidden className="yb-list-secondary-mark">
              -
            </span>
            <span className="yb-list-title">{title}</span>
          </div>
        ) : (
          <span className="yb-list-title">{title}</span>
        )}
        {state === 'withsubtitle' ? <span className="yb-list-subtitle">{subtitle}</span> : null}
      </div>
      {ctx.renderNamed('.Settings/items/cell', { items: cell })}
    </div>
  )
}

export function SettingsCellView({ ctx }: { ctx: RenderCtx }) {
  const items = clampSettingsCell(str(ctx.v('items'), 'items'))
  if (items === 'swtich') {
    return (
      <span className={`yb-list-cell-switch ${ctx.className}`.trim()}>
        <SettingsSwitch onAction={ctx.onAction} />
      </span>
    )
  }
  if (items === 'Radio') {
    return (
      <span className={`yb-list-cell-radio ${ctx.className}`.trim()}>
        {ctx.renderNamed('Radio & CheckBox', { type: 'plain', state: 'checked', size: 'lg' })}
      </span>
    )
  }
  return (
    <span className={`yb-list-trailing ${ctx.className}`.trim()}>
      <span className="yb-list-trailing-label">选项</span>
      {ctx.renderNamed('Badge / Dot')}
      <Icon className="yb-list-chevron" decorative name="Icon/chevron-right" size={16} />
    </span>
  )
}

export function FileItemsView({ ctx }: { ctx: RenderCtx }) {
  const iconSide = str(ctx.v('icon2'), 'left') === 'right' ? 'right' : 'left'
  const showTime = ctx.v('showTime') === undefined ? true : boolish(ctx.v('showTime'))
  const title = contentOr(ctx.children, '列表标题')
  const icon = <FileGlyph ctx={ctx} />
  const des = isEmptySlot(ctx.v('des')) ? (
    <span className="yb-file-des">
      {iconSide === 'right' ? '这是副文案，超长会缩略，控制在一行一行一行一行' : '这是副文案，可以填入各类信息，如果超长会缩略123'}
    </span>
  ) : (
    ctx.renderSlot(ctx.v('des'))
  )

  if (iconSide === 'right') {
    return (
      <div className={`yb-file-row ${ctx.className}`.trim()} data-icon="right">
        <div className="yb-file-row-main">
          <div className="yb-file-heading">
            <span className="yb-file-title">{title}</span>
            {des}
          </div>
          {showTime ? <span className="yb-file-time">2025.04.24</span> : null}
        </div>
        <div className="yb-file-icon-lg">{icon}</div>
      </div>
    )
  }

  return (
    <div className={`yb-file-row ${ctx.className}`.trim()} data-icon="left">
      <div className="yb-file-icon">{icon}</div>
      <div className="yb-file-row-main">
        <div className="yb-file-heading">
          <span className="yb-file-title">{title}</span>
          {showTime ? <span className="yb-file-time">10:50</span> : null}
        </div>
        {des}
      </div>
    </div>
  )
}

const FILE_TYPES = [
  'Audio',
  'Code',
  'Excel',
  'Link',
  'PDF',
  'PPT',
  'Picture',
  'Text',
  'Unknow',
  'Video',
  'Word',
  'zip',
  'markdown',
] as const

const STATUS_PUBLIC = new Set([
  'error',
  'loading',
  'refresh',
  'Variant6',
  'Variant5',
  'Variant7',
  'icon',
  'Variant8',
])

const FILE_STATES = new Set(['icon', 'loading', 'error', 'refresh'])

function clampFileType(value: string) {
  return (FILE_TYPES as readonly string[]).includes(value) ? value : 'Word'
}

function clampFileState(value: string) {
  if (value === 'Default') return 'icon'
  if (value === 'State5') return 'error'
  if (value === 'reload') return 'refresh'
  return FILE_STATES.has(value) ? value : 'icon'
}

function clampCard(value: string) {
  return value === 'Output' ? 'Output' : 'File'
}

function clampPressed(value: string) {
  return value === 'on' ? 'on' : 'off'
}

function clampStatus(value: string) {
  if (value === 'State5') return 'error'
  if (STATUS_PUBLIC.has(value)) return value
  if (value === 'icon' || value === 'error' || value === 'loading' || value === 'refresh') return value
  return 'icon'
}

export function FileView({ ctx }: { ctx: RenderCtx }) {
  const file = clampFileType(str(ctx.v('file'), 'Word'))
  const state = clampFileState(str(ctx.v('state'), 'icon'))
  const showTypeGlyph = state === 'icon' && file !== 'zip'
  const showZip = state === 'icon' && file === 'zip'
  return (
    <div className={`yb-file-thumb ${ctx.className}`.trim()} data-file={file} data-state={state}>
      <span className="yb-file-sheet" />
      <span className="yb-file-fold" />
      {showZip ? <span className="yb-file-zip" /> : null}
      {showTypeGlyph ? <span className="yb-file-glyph" /> : null}
      {state === 'loading' ? <span className="yb-file-state" data-kind="loading" /> : null}
      {state === 'refresh' ? <span className="yb-file-state" data-kind="refresh" /> : null}
      {state === 'error' ? (
        <span className="yb-file-state" data-kind="error">
          <span className="yb-file-state-mark" />
        </span>
      ) : null}
    </div>
  )
}

export function CardView({ ctx }: { ctx: RenderCtx }) {
  const card = clampCard(str(ctx.v('card'), 'File'))
  const pressedProp = clampPressed(str(ctx.v('pressed'), 'off'))
  const close = card === 'File' && boolish(ctx.v('close'))
  const file = clampFileType(str(ctx.v('file'), 'PDF'))
  const fileState = clampFileState(str(ctx.v('state'), 'icon'))
  const [pressed, setPressed] = useState(pressedProp)

  useEffect(() => {
    setPressed(pressedProp)
  }, [pressedProp])

  function onPressStart(event: { currentTarget: HTMLElement; pointerId: number }) {
    event.currentTarget.setPointerCapture(event.pointerId)
    setPressed('on')
    ctx.onAction?.('press')
  }

  function onPressEnd(event: { currentTarget: HTMLElement; pointerId: number }) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setPressed('off')
    ctx.onAction?.('press-end')
  }

  const pressBind = {
    onPointerCancel: onPressEnd,
    onPointerDown: onPressStart,
    onPointerUp: onPressEnd,
  }

  if (card === 'Output') {
    const content = (
      <>
        <div className="yb-card-output-title">
          <div className="yb-card-output-title-main">
            <span className="yb-card-left-slot">
              {ctx.renderSlot(ctx.v('leftSlot'), <Icon decorative name="Icon/A" nodeId="64:2291" size={20} />)}
            </span>
            <strong>{contentOr(ctx.children, '标题')}</strong>
          </div>
          <Icon decorative name="Icon/chevron-right" size={16} />
        </div>
        <div className="yb-card-output-sub">
          <div className="yb-card-output-sub-inner">
            {ctx.renderSlot(ctx.v('content'), <span>副标题</span>)}
          </div>
        </div>
      </>
    )
    if (ctx.onAction) {
      return (
        <button
          className={`yb-card yb-card-output ${ctx.className}`.trim()}
          data-card="Output"
          data-pressed={pressed}
          type="button"
          {...pressBind}
        >
          {content}
        </button>
      )
    }
    return (
      <article
        className={`yb-card yb-card-output ${ctx.className}`.trim()}
        data-card="Output"
        data-pressed={pressed}
        {...pressBind}
      >
        {content}
      </article>
    )
  }

  return (
    <article
      className={`yb-card yb-card-file ${ctx.className}`.trim()}
      data-card="File"
      data-pressed={pressed}
      {...pressBind}
    >
      <div className="yb-card-file-body">
        {ctx.renderNamed('2850:10220', { file, state: fileState })}
        <div className="yb-card-file-text">
          <strong>{contentOr(ctx.children, '文件名')}</strong>
          <div className="yb-card-file-meta">
            <span>{file}</span>
            <span>12MB</span>
          </div>
        </div>
      </div>
      {close ? (
        <button
          aria-label="关闭"
          className="yb-card-close"
          onClick={(event) => {
            event.stopPropagation()
            ctx.onAction?.('close')
          }}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          <Icon decorative name="Icon/close-lg" size={12} />
        </button>
      ) : null}
    </article>
  )
}

export function StatusView({ ctx }: { ctx: RenderCtx }) {
  const state = clampFileState(clampStatus(str(ctx.v('state'), str(ctx.v('type'), str(ctx.v('property1'), 'icon')))))
  return (
    <span className={`yb-status ${ctx.className}`.trim()} data-state={state}>
      {state === 'icon' ? <span className="yb-status-glyph" /> : null}
      {state === 'loading' ? <span className="yb-file-state" data-kind="loading" /> : null}
      {state === 'refresh' ? <span className="yb-file-state" data-kind="refresh" /> : null}
      {state === 'error' ? (
        <span className="yb-file-state" data-kind="error">
          <span className="yb-file-state-mark" />
        </span>
      ) : null}
    </span>
  )
}

export function TagView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'Default')
  const showIcon = type === 'Default' && (ctx.v('showIcon') === undefined || boolish(ctx.v('showIcon')))
  const text =
    type === 'Role' ? '派主' : type === 'Badge' ? '限时' : type === 'Bot' ? ctx.renderSlot(ctx.v('slot'), 'BOT') : '常规图标'
  return (
    <span className={`yb-tag yb-tag-${type.toLowerCase()} ${ctx.className}`.trim()}>
      {showIcon ? <Icon decorative name="Icon/A" nodeId="64:2291" size={16} /> : null}
      <span>{ctx.children ?? text}</span>
    </span>
  )
}

export function BadgeDotView({ ctx }: { ctx: RenderCtx }) {
  return <i className={`yb-badge-dot ${ctx.className}`.trim()} />
}

export function BadgeNumberView({ ctx }: { ctx: RenderCtx }) {
  return <b className={`yb-badge-number ${ctx.className}`.trim()}>{contentOr(ctx.children, '2')}</b>
}

const EMPTY_ILLUS_TYPES = new Set(['placeholder', 'networkError', 'noContent'])

function clampEmptyIllusType(value: string) {
  return EMPTY_ILLUS_TYPES.has(value) ? value : 'placeholder'
}

export function EmptyPageView({ ctx }: { ctx: RenderCtx }) {
  const showDesc = ctx.v('description') === undefined ? true : boolish(ctx.v('description'))
  const showButton = ctx.v('button') === undefined ? true : boolish(ctx.v('button'))
  const illus = clampEmptyIllusType(str(ctx.v('illus'), str(ctx.v('type'), 'placeholder')))
  return (
    <div
      className={`yb-empty ${ctx.className}`.trim()}
      data-button={showButton ? 'true' : 'false'}
      data-description={showDesc ? 'true' : 'false'}
      data-illus={illus}
    >
      <div className="yb-empty-content">
        {ctx.renderNamed('emptyPage/illus', { type: illus })}
        <div className="yb-empty-text">
          <strong>{contentOr(ctx.children, 'Title')}</strong>
          {showDesc ? <p>{str(ctx.v('descText'), 'Description')}</p> : null}
        </div>
      </div>
      {showButton
        ? ctx.renderNamed(
            'Button 按钮',
            { type: 'Outline', size: 'S', state: 'Default' },
            str(ctx.v('buttonLabel'), '描边按钮'),
          )
        : null}
    </div>
  )
}

export function EmptyIllusView({ ctx }: { ctx: RenderCtx }) {
  const type = clampEmptyIllusType(str(ctx.v('type'), 'placeholder'))
  if (type === 'networkError' || type === 'noContent') {
    const src = type === 'networkError' ? '/icons/empty-network-error.svg' : '/icons/empty-no-content.svg'
    return (
      <img
        alt=""
        className={`yb-empty-illus yb-empty-illus-img ${ctx.className}`.trim()}
        data-type={type}
        height={64}
        src={src}
        width={64}
      />
    )
  }
  return <div className={`yb-empty-illus yb-empty-illus-placeholder ${ctx.className}`.trim()} data-type="placeholder" />
}

const HISTORY_SAMPLES = ['电影', '哈哈哈', '腾大', '元宝', '霸王茶姬', '疯狂动物城', 'AI', '设计方案']

function HistoryItemRow({
  className,
  text,
  onDelete,
  onSelect,
}: {
  className?: string
  text: string
  onDelete?: () => void
  onSelect?: () => void
}) {
  return (
    <div className={`yb-history-item ${className ?? ''}`.trim()}>
      <button className="yb-history-item-main" onClick={onSelect} type="button">
        <Icon decorative name="Icon/Clock" size={16} />
        <span>{text}</span>
      </button>
      <button aria-label="删除" className="yb-history-item-remove" onClick={onDelete} type="button">
        <Icon decorative name="Icon/close-sm" size={12} />
      </button>
    </div>
  )
}

export function HistoryItemView({ ctx }: { ctx: RenderCtx }) {
  const text = typeof ctx.children === 'string' && ctx.children ? ctx.children : '电影'
  return (
    <HistoryItemRow
      className={ctx.className}
      onDelete={() => ctx.onAction?.('delete')}
      onSelect={() => ctx.onAction?.('item')}
      text={text}
    />
  )
}

export function HistoryItemsView({ ctx }: { ctx: RenderCtx }) {
  const resultOn = str(ctx.v('result'), 'true') === 'true'
  const showClear = ctx.v('clear') === undefined ? true : boolish(ctx.v('clear'))
  const [removed, setRemoved] = useState<string[]>([])
  const [cleared, setCleared] = useState(false)

  useEffect(() => {
    setRemoved([])
    setCleared(false)
  }, [resultOn])

  if (!resultOn) {
    return (
      <div className={`yb-history-items is-empty ${ctx.className}`.trim()}>
        <p className="yb-history-empty">
          没有找到“<b>元宝</b>”相关内容
        </p>
      </div>
    )
  }

  const items = HISTORY_SAMPLES.filter((item) => !cleared && !removed.includes(item))

  return (
    <div className={`yb-history-items ${ctx.className}`.trim()}>
      <div className="yb-history-list">
        {items.map((item) => (
          <HistoryItemRow
            key={item}
            onDelete={() => setRemoved((current) => [...current, item])}
            onSelect={() => ctx.onAction?.('item')}
            text={item}
          />
        ))}
      </div>
      {showClear ? (
        <button
          className="yb-history-clear"
          onClick={() => {
            setCleared(true)
            ctx.onAction?.('clear-all')
          }}
          type="button"
        >
          清空所有记录
        </button>
      ) : null}
    </div>
  )
}
