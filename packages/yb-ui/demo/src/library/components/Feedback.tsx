import { Fragment, useState } from 'react'
import { boolish, contentImageSrc, contentOr, str } from '../helpers'
import { Icon } from '../Icon'
import type { RenderCtx } from '../context'

const DIALOG_BODY = {
  singleText: '这里是单行文案，居中对齐',
  multiText: '这里是多行说明，用于解释原因和后果。',
  overflowText:
    '超长协议正文，最高 248px，溢出后滚动查看。请仔细阅读服务协议与隐私政策。继续使用即表示你已理解相关条款。',
  middleCheckbox: '我已阅读并同意',
  leftCheckbox: '我已知晓，下次不再弹出',
} as const

const SHEET_TABS = ['派相册', '本地相册', 'IP角色'] as const

const FEATURE_FOCUS = ['1', '2', '3', '4'] as const

const FEATURE_CLOSE_PATH =
  'M 8.295523248916396 0.19526216710355063 C 8.55588372595067 -0.06495674888984102 8.97792526990448 -0.0650438511499433 9.238231645785866 0.19526216710355063 C 9.49835684340314 0.45558282823243124 9.498390361083977 0.8776707843394331 9.238231645785866 1.1379706037094526 L 5.659455362918827 4.7167469660493575 L 9.238231645785866 8.295523248916396 C 9.498269701406604 8.555898269484976 9.49847714545262 8.977985510336193 9.238231645785866 9.238231645785866 C 8.977985510336193 9.49847714545262 8.555898269484976 9.498269701406604 8.295523248916396 9.238231645785866 L 4.7167469660493575 5.659455362918827 L 1.1379706037094526 9.238231645785866 C 0.8776707843394331 9.498390361083977 0.45558282823243124 9.49835684340314 0.19526216710355063 9.238231645785866 C -0.0650438511499433 8.97792526990448 -0.06495674888984102 8.55588372595067 0.19526216710355063 8.295523248916396 L 3.7740385691798877 4.7167469660493575 L 0.19526216710355063 1.1379706037094526 C -0.0650874022799944 0.87762107406234 -0.0650874022799944 0.45561169675066315 0.19526216710355063 0.19526216710355063 C 0.45561169675066315 -0.0650874022799944 0.87762107406234 -0.0650874022799944 1.1379706037094526 0.19526216710355063 L 4.7167469660493575 3.7740385691798877 L 8.295523248916396 0.19526216710355063 Z'

const SHARE_DIALOGUE_ROWS = [
  ['元宝派', '微信好友', '朋友圈', 'QQ好友', 'QQ空间', '企业微信', '新浪微博', '更多'],
  ['生成分享图', '复制链接', '转为文档', '收藏'],
] as const

const SHARE_FILE_ITEMS = ['本地保存', '转存图片', '元宝派', '微信好友', 'QQ好友', '企业微信', '更多'] as const

const SHARE_GLYPHS: Record<string, { src: string; tone: 'tertiary' | 'quaternary' | 'brand' }> = {
  元宝派: { src: '/icons/share-pai.svg', tone: 'tertiary' },
  微信好友: { src: '/icons/share-wechat.svg', tone: 'brand' },
  朋友圈: { src: '/icons/share-moments.svg', tone: 'brand' },
  QQ好友: { src: '/icons/share-qq.svg', tone: 'tertiary' },
  QQ空间: { src: '/icons/share-qzone.svg', tone: 'brand' },
  企业微信: { src: '/icons/share-wecom.svg', tone: 'brand' },
  新浪微博: { src: '/icons/share-weibo.svg', tone: 'brand' },
  更多: { src: '/icons/share-more.svg', tone: 'quaternary' },
  生成分享图: { src: '/icons/share-image.svg', tone: 'tertiary' },
  转存图片: { src: '/icons/share-image.svg', tone: 'tertiary' },
  复制链接: { src: '/icons/share-link.svg', tone: 'tertiary' },
  转为文档: { src: '/icons/share-doc.svg', tone: 'tertiary' },
  收藏: { src: '/icons/share-collect.svg', tone: 'tertiary' },
  本地保存: { src: '/icons/share-download.svg', tone: 'tertiary' },
}

function ShareGlyph({ label }: { label: string }) {
  const glyph = SHARE_GLYPHS[label] ?? { src: '/icons/share-pai.svg', tone: 'tertiary' as const }
  if (glyph.tone === 'brand') {
    return <img alt="" className="yb-sharesheet-glyph is-img" height={24} src={glyph.src} width={24} />
  }
  return (
    <span
      aria-hidden
      className={`yb-sharesheet-glyph is-mask is-${glyph.tone}`}
      style={{
        WebkitMaskImage: `url("${glyph.src}")`,
        maskImage: `url("${glyph.src}")`,
      }}
    />
  )
}

function FeatureCloseMark() {
  return (
    <svg aria-hidden className="yb-featuresheet-close-mark" fill="none" height={16} viewBox="0 0 16 16" width={16}>
      <g fill="currentColor" transform="translate(3.28 3.28)">
        <path d={FEATURE_CLOSE_PATH} />
      </g>
    </svg>
  )
}

function clampFeatureFocus(value: string) {
  return FEATURE_FOCUS.includes(value as (typeof FEATURE_FOCUS)[number]) ? value : '1'
}

function clampFeatureText(value: string) {
  return value === 'singleLine' ? 'singleLine' : 'multiLine'
}

function clampFeatureNum(value: string) {
  return value === '2' ? '2' : '1'
}

function clampShareKind(value: string) {
  return value === 'File Share' ? 'File Share' : 'Dialogue Share'
}

function clampDialogBody(type: string) {
  return type in DIALOG_BODY ? type : 'singleText'
}

function clampSheetNav(type: string, position: string) {
  if (type === 'tabCard') return { type: 'tabCard', position: 'middle' }
  if (position === 'middle') return { type: 'default', position: 'middle' }
  return { type: 'default', position: 'left' }
}

function clampSheetButtons(type: string) {
  if (type === '1Btn' || type === '2BtnVertical' || type === '2BtnHorizantal') return type
  return '2BtnHorizantal'
}

function clampActionState(state: string) {
  if (state === 'Pressed' || state === 'Disable') return state
  return 'Default'
}

export function DialogView({ ctx }: { ctx: RenderCtx }) {
  const titleOn = ctx.v('titleSwitch') === undefined ? true : boolish(ctx.v('titleSwitch'))
  const bodyOn = ctx.v('bodySwitch') === undefined ? true : boolish(ctx.v('bodySwitch'))
  const picOn = boolish(ctx.v('picIconSwitch'))
  const bodyText = ctx.v('bodyText')
  return (
    <section className={`yb-dialog ${ctx.className}`.trim()}>
      <div className="yb-dialog-content">
        {picOn ? (
          <div className="yb-dialog-media">
            {ctx.renderSlot(ctx.v('picIconSlot'), <Icon decorative name="Icon/A" size={32} />)}
          </div>
        ) : null}
        <div className="yb-dialog-text">
          {titleOn ? <h2>{contentOr(ctx.children, '这里是标题')}</h2> : null}
          {bodyOn
            ? ctx.renderSlot(
                ctx.v('bodySlot'),
                ctx.renderNamed(
                  '.dialog/body',
                  { type: str(ctx.v('bodyType'), 'singleText') },
                  typeof bodyText === 'string' && bodyText ? bodyText : undefined,
                ),
              )
            : null}
        </div>
      </div>
      {ctx.renderNamed('443:2123', {
        num: '2',
        secondaryLabel: str(ctx.v('secondaryLabel'), '次要按钮'),
        primaryLabel: str(ctx.v('primaryLabel'), '主要按钮'),
        primaryType: str(ctx.v('primaryType'), 'Primary'),
      })}
    </section>
  )
}

export function DialogBodyView({ ctx }: { ctx: RenderCtx }) {
  const type = clampDialogBody(str(ctx.v('type'), 'singleText'))
  const checked = type.includes('Checkbox')
  return (
    <div className={`yb-dialog-body ${ctx.className}`.trim()} data-type={type}>
      {checked
        ? ctx.renderNamed('Radio & CheckBox', { type: 'circled', size: 'sm', state: 'unchecked' })
        : null}
      <p>{contentOr(ctx.children, DIALOG_BODY[type as keyof typeof DIALOG_BODY])}</p>
    </div>
  )
}

export function ButtonGroupView({ ctx }: { ctx: RenderCtx }) {
  const sheetType = str(ctx.v('type'), '')
  if (ctx.asset.nodeId === '3149:24142' || sheetType.startsWith('1Btn') || sheetType.startsWith('2Btn')) {
    const type = clampSheetButtons(sheetType || '2BtnHorizantal')
    const secondaryLabel = str(ctx.v('secondaryLabel'), '次要按钮')
    const primaryLabel = str(ctx.v('primaryLabel'), str(ctx.v('buttonLabel'), type === '1Btn' ? '次要按钮' : '主要按钮'))
    return (
      <div className={`yb-sheet-buttons ${ctx.className}`.trim()} data-type={type}>
        {type === '1Btn'
          ? ctx.renderNamed('Button 按钮', { type: 'Secondary', size: 'L', state: 'Default' }, primaryLabel)
          : type === '2BtnVertical'
            ? (
              <>
                {ctx.renderNamed('Button 按钮', { type: 'Primary', size: 'L', state: 'Default' }, primaryLabel)}
                {ctx.renderNamed('Button 按钮', { type: 'Text', size: 'L', state: 'Default' }, str(ctx.v('textLabel'), '文字按钮'))}
              </>
            )
            : (
              <>
                {ctx.renderNamed('Button 按钮', { type: 'Secondary', size: 'L', state: 'Default' }, secondaryLabel)}
                {ctx.renderNamed('Button 按钮', { type: 'Primary', size: 'L', state: 'Default' }, primaryLabel)}
              </>
            )}
      </div>
    )
  }

  const num = str(ctx.v('num'), ctx.asset.nodeId === '3677:33977' ? '1' : '2')
  if (ctx.asset.nodeId === '3677:33977') {
    const count = num === '2' ? '2' : '1'
    return (
      <div className={`yb-feature-btns ${ctx.className}`.trim()} data-num={count}>
        {count === '2'
          ? ctx.renderNamed('Button 按钮', { type: 'Secondary', size: 'L', state: 'Default' }, '次要按钮')
          : null}
        {ctx.renderNamed('Button 按钮', { type: 'Primary', size: 'L', state: 'Default' }, '主要按钮')}
      </div>
    )
  }
  const slot = ctx.renderSlot(ctx.v('buttonGroup'))
  return (
    <div className={`yb-button-group ${ctx.className}`.trim()} data-num={num}>
      {num === '1'
        ? ctx.renderNamed('Button 按钮', { type: 'Secondary', size: 'M', state: 'Default' })
        : num === 'multi'
          ? slot ?? (
            <>
              {ctx.renderNamed('Button 按钮', { type: 'Secondary', size: 'M', state: 'Default' })}
              {ctx.renderNamed('Button 按钮', { type: 'Secondary', size: 'M', state: 'Default' })}
            </>
          )
          : (
            <>
              {ctx.renderNamed(
                'Button 按钮',
                {
                  type: 'Secondary',
                  size: 'M',
                  state: 'Default',
                  onAction: () => ctx.onAction?.('dialog-cancel'),
                },
                str(ctx.v('secondaryLabel'), '次要按钮'),
              )}
              {ctx.renderNamed(
                'Button 按钮',
                {
                  type: str(ctx.v('primaryType'), 'Primary'),
                  size: 'M',
                  state: 'Default',
                  onAction: () => ctx.onAction?.('dialog-confirm'),
                },
                str(ctx.v('primaryLabel'), '主要按钮'),
              )}
            </>
          )}
    </div>
  )
}

export function BottomSheetView({ ctx }: { ctx: RenderCtx }) {
  const handle = ctx.v('handle') === undefined ? true : boolish(ctx.v('handle'))
  const navOn = ctx.v('navBar') === undefined ? true : boolish(ctx.v('navBar'))
  const buttonsOn = ctx.v('buttonGroup') === undefined ? true : boolish(ctx.v('buttonGroup'))
  const { type, position } = clampSheetNav(str(ctx.v('navbarType'), 'default'), str(ctx.v('navbarPosition'), 'left'))
  const buttonType = clampSheetButtons(str(ctx.v('buttonType'), '2BtnHorizantal'))
  const title = str(ctx.v('title'), '标题')
  const descOn = ctx.v('description') === undefined ? true : boolish(ctx.v('description'))
  const descText = str(ctx.v('descText'), 'Description')
  const leftIconGlyph = ctx.renderSlot(ctx.v('leftNavIcon'))
  const rightIconGlyph = ctx.renderSlot(ctx.v('rightNavIcon'))
  const leftIconName = str(ctx.v('leftIconName'), '')
  const rightIconName = str(ctx.v('rightIconName'), '')
  const leftNavIcon =
    leftIconGlyph || leftIconName
      ? ctx.renderNamed(
          '.navBar / Icon',
          {
            bg: 'off',
            iconAction: str(ctx.v('leftIconAction'), 'close'),
            ariaLabel: str(ctx.v('leftIconLabel'), '关闭'),
          },
          leftIconGlyph ?? <Icon decorative name={leftIconName || 'Icon/close-sm'} size={24} />,
        )
      : undefined
  const rightNavIcon =
    rightIconGlyph || rightIconName
      ? ctx.renderNamed(
          '.navBar / Icon',
          {
            bg: 'off',
            iconAction: str(ctx.v('rightIconAction'), 'share'),
            ariaLabel: str(ctx.v('rightIconLabel'), '分享'),
          },
          rightIconGlyph ?? <Icon decorative name={rightIconName || 'Icon/share'} size={24} />,
        )
      : undefined
  return (
    <section className={`yb-sheet yb-bottomsheet ${ctx.className}`.trim()}
      data-handle={handle ? 'true' : 'false'} data-buttons={buttonsOn ? 'true' : 'false'}>
      {handle ? (
        <span aria-hidden className="yb-sheet-handle-wrap">
          <i className="yb-sheet-handle" />
        </span>
      ) : null}
      {navOn
        ? ctx.renderNamed(
            '.navbar',
            {
              type,
              position,
              divider: boolish(ctx.v('navbarDivider')),
              leftIcon: ctx.v('leftIcon') ?? true,
              rightIcon: ctx.v('rightIcon') ?? true,
              content: ctx.v('navbarContent') ?? true,
              description: descOn,
              descText,
              leftSlot: ctx.v('leftNavSlot'),
              rightSlot: ctx.v('rightNavSlot') ?? rightNavIcon,
              leftIconSlot: leftNavIcon,
            },
            title,
          )
        : null}
      <div className="yb-sheet-body">
        {ctx.renderSlot(ctx.v('content'), contentOr(ctx.children, '内容'))}
      </div>
      {buttonsOn
        ? ctx.renderNamed('3149:24142', {
            type: buttonType,
            buttonLabel: ctx.v('buttonLabel'),
            primaryLabel: ctx.v('primaryLabel'),
            secondaryLabel: ctx.v('secondaryLabel'),
            textLabel: ctx.v('textLabel'),
          })
        : null}
      <i aria-hidden className="yb-sheet-home" />
    </section>
  )
}

export function SheetNavBarView({ ctx }: { ctx: RenderCtx }) {
  const rawType = str(ctx.v('type'), 'default')
  const rawPosition = str(ctx.v('position'), 'left')
  const { type, position } = clampSheetNav(rawType, rawPosition)
  const leftOn = ctx.v('leftIcon') === undefined ? true : boolish(ctx.v('leftIcon'))
  const rightOn = ctx.v('rightIcon') === undefined ? true : boolish(ctx.v('rightIcon'))
  const descOn = ctx.v('description') === undefined ? true : boolish(ctx.v('description'))
  const contentOn = ctx.v('content') === undefined ? true : boolish(ctx.v('content'))
  const dividerOn = ctx.v('divider') === undefined ? true : boolish(ctx.v('divider'))
  const title = contentOr(ctx.children, type === 'tabCard' ? '' : '标题')
  const descText = str(ctx.v('descText'), 'Description')
  const [tab, setTab] = useState(0)
  const left = leftOn
    ? ctx.renderSlot(ctx.v('leftIconSlot'), ctx.renderNamed('.navBar / Icon', { bg: 'off' }))
    : null
  const right = rightOn
    ? ctx.renderSlot(ctx.v('rightSlot'), ctx.renderNamed('.navBar / Icon', { bg: 'off' }))
    : null
  const copy = contentOn ? (
    <span className={`yb-sheet-navbar-copy${position === 'middle' ? ' is-center' : ''}`}>
      <strong>{title || '标题'}</strong>
      {descOn ? <small>{descText}</small> : null}
    </span>
  ) : null

  return (
    <div className={`yb-sheet-navbar ${ctx.className}`.trim()} data-position={position} data-type={type}>
      <div className="yb-sheet-navbar-row">
        {type === 'tabCard' ? (
          <div className="yb-sheet-tabs">
            {SHEET_TABS.map((label, index) => (
              <button
                className={index === tab ? 'is-on' : undefined}
                key={label}
                onClick={() => {
                  setTab(index)
                  ctx.onAction?.(`tab:${index}`)
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        ) : position === 'middle' ? (
          <>
            <span className="yb-sheet-navbar-side is-left">{ctx.renderSlot(ctx.v('leftSlot'), left)}</span>
            {copy}
            <span className="yb-sheet-navbar-side is-right">{right}</span>
          </>
        ) : (
          <>
            <span className="yb-sheet-navbar-side is-left">
              {ctx.renderSlot(ctx.v('leftSlot'), <>{left}{copy}</>)}
            </span>
            <span className="yb-sheet-navbar-side is-right">{right}</span>
          </>
        )}
      </div>
      {dividerOn ? <i aria-hidden className="yb-sheet-navbar-line" /> : null}
    </div>
  )
}

export function NavBarIconView({ ctx }: { ctx: RenderCtx }) {
  const bg = str(ctx.v('bg'), 'on') === 'on' ? 'on' : 'off'
  const showLeft = ctx.v('showLeftIcon') === undefined ? true : boolish(ctx.v('showLeftIcon'))
  const action = str(ctx.v('iconAction'), 'close')
  const label = str(ctx.v('ariaLabel'), action === 'share' ? '分享' : '关闭')
  const icon = showLeft
    ? ctx.renderSlot(
        ctx.v('leftSlot'),
        contentOr(ctx.children, <Icon decorative name="Icon/A" size={24} />),
      )
    : null
  return (
    <button
      aria-label={label}
      className={`yb-sheet-nav-icon ${ctx.className}`.trim()}
      data-bg={bg}
      onClick={() => ctx.onAction?.(action)}
      type="button"
    >
      {icon}
    </button>
  )
}

export function ActionSheetView({ ctx }: { ctx: RenderCtx }) {
  const showDesc = ctx.v('showDesc') === undefined ? true : boolish(ctx.v('showDesc'))
  const showIcon = ctx.v('showIcon') === undefined ? true : boolish(ctx.v('showIcon'))
  const cancelLabel = str(ctx.values.cancelLabel, '取消')
  const rawItems = ctx.values.items
  const items = Array.isArray(rawItems) && rawItems.every((item) => typeof item === 'string') ? rawItems : null
  return (
    <section className={`yb-actionsheet ${ctx.className}`.trim()}>
      {showDesc ? (
        <div className="yb-actionsheet-desc">
          {ctx.renderSlot(ctx.v('desc'), '400-950-1925 可能是一个电话号码')}
        </div>
      ) : null}
      <div className="yb-actionsheet-list">
        {items
          ? items.map((label, index) => (
              <Fragment key={`${label}-${index}`}>
                {ctx.renderNamed(
                  '.Actionsheet/item',
                  {
                    state: 'Default',
                    showIcon,
                    onAction: () => ctx.onAction?.(`item:${index}`),
                  },
                  label,
                )}
              </Fragment>
            ))
          : (
            <>
              {ctx.renderNamed('.Actionsheet/item', { state: 'Default', showIcon: true }, '选项')}
              {ctx.renderSlot(ctx.v('item'), ctx.renderNamed('.Actionsheet/item', { state: 'Default', showIcon: true }, '选项'))}
              {ctx.renderNamed('.Actionsheet/item', { state: 'Default', showIcon: true }, '选项')}
            </>
          )}
      </div>
      {ctx.renderNamed(
        'Button 按钮',
        {
          type: 'Secondary',
          size: 'L',
          state: 'Default',
          onAction: () => ctx.onAction?.('cancel'),
        },
        cancelLabel,
      )}
    </section>
  )
}

export function ActionSheetItemView({ ctx }: { ctx: RenderCtx }) {
  const state = clampActionState(str(ctx.v('state'), 'Default'))
  const showIcon = ctx.v('showIcon') === undefined ? true : boolish(ctx.v('showIcon'))
  const [pressed, setPressed] = useState(false)
  const disabled = state === 'Disable'
  const on = state === 'Pressed' || pressed
  const icon = showIcon
    ? ctx.renderSlot(ctx.v('icon'), <Icon decorative name="Icon/A" size={16} />)
    : null
  return (
    <button
      className={`yb-actionsheet-item ${ctx.className}`.trim()}
      data-state={disabled ? 'Disable' : on ? 'Pressed' : 'Default'}
      disabled={disabled}
      onPointerDown={() => {
        if (disabled) return
        setPressed(true)
        ctx.onAction?.('press')
      }}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      type="button"
    >
      <span>
        <span>{contentOr(ctx.children, '选项')}</span>
        {icon}
      </span>
    </button>
  )
}

export function FeatureSheetView({ ctx }: { ctx: RenderCtx }) {
  const indicatorOn = ctx.v('indicator') === undefined ? true : boolish(ctx.v('indicator'))
  const textType = clampFeatureText(str(ctx.v('text'), 'multiLine'))
  const num = clampFeatureNum(str(ctx.v('num'), '1'))
  const focus = clampFeatureFocus(str(ctx.v('focus'), '1'))
  return (
    <section className={`yb-featuresheet ${ctx.className}`.trim()}>
      <div className="yb-featuresheet-body">
        <div className="yb-featuresheet-carousel">
          <div className="yb-featuresheet-pic">
            {ctx.renderSlot(
              ctx.v('pic'),
              <span aria-hidden className="yb-featuresheet-pic-fill" />,
            )}
            <button
              aria-label="关闭"
              className="yb-featuresheet-close"
              onClick={() => ctx.onAction?.('close')}
              type="button"
            >
              <FeatureCloseMark />
            </button>
          </div>
          {indicatorOn ? ctx.renderNamed('.indicator', { focus }) : null}
        </div>
        {ctx.renderNamed('.text', { type: textType })}
        {ctx.renderNamed('3677:33977', { num })}
      </div>
    </section>
  )
}

export function ShareSheetView({ ctx }: { ctx: RenderCtx }) {
  const kind = clampShareKind(str(ctx.v('shareSheet'), 'Dialogue Share'))
  const descOn = kind === 'Dialogue Share' && (ctx.v('description') === undefined ? true : boolish(ctx.v('description')))
  const closeIcon = ctx.renderNamed(
    '.navBar / Icon',
    { bg: 'off' },
    <Icon decorative name="Icon/close-sm" size={24} />,
  )
  return (
    <section className={`yb-sheet yb-sharesheet ${ctx.className}`.trim()} data-kind={kind === 'File Share' ? 'file' : 'dialogue'}>
      {kind === 'Dialogue Share'
        ? ctx.renderNamed(
            '.navbar',
            {
              type: 'default',
              position: 'middle',
              leftIcon: false,
              rightIcon: true,
              description: descOn,
              divider: false,
              content: true,
              descText: '小技巧：收起深度思考后可仅分享模型回答',
              rightSlot: closeIcon,
            },
            '分享到',
          )
        : (
          <>
            <div className="yb-sharesheet-file">
              <div className="yb-sharesheet-file-main">
                {ctx.renderNamed('2850:10220', { file: 'Excel', state: 'icon' })}
                <div className="yb-sharesheet-file-copy">
                  <strong>牛奶成分对比表.csv</strong>
                  <small>
                    <span>CSV</span>
                    <span>12K</span>
                  </small>
                </div>
              </div>
              {closeIcon}
            </div>
            <div className="yb-sharesheet-rule">
              {ctx.renderNamed('divider', { type: 'default', direction: 'horizontal' })}
            </div>
          </>
        )}
      <div className="yb-sharesheet-body">
        {(kind === 'File Share' ? [SHARE_FILE_ITEMS] : SHARE_DIALOGUE_ROWS).map((row, rowIndex) => (
          <div className="yb-sharesheet-row" key={rowIndex}>
            {row.map((label) => (
              <Fragment key={label}>{ctx.renderNamed('.shareSheet/item', {}, label)}</Fragment>
            ))}
          </div>
        ))}
      </div>
      <i aria-hidden className="yb-sheet-home" />
    </section>
  )
}

export function ShareSheetItemView({ ctx }: { ctx: RenderCtx }) {
  const label = contentOr(ctx.children, '元宝派')
  const text = typeof label === 'string' ? label : '分享'
  return (
    <button
      className={`yb-sharesheet-item ${ctx.className}`.trim()}
      onClick={() => ctx.onAction?.('press')}
      type="button"
    >
      <span className="yb-sharesheet-item-icon">
        {ctx.renderSlot(ctx.v('iconSlot'), <ShareGlyph label={text} />)}
      </span>
      <span className="yb-sharesheet-item-label">{text}</span>
    </button>
  )
}

const STATUS_STATES = ['Error', 'Warning', 'Info', 'Success'] as const

const STATUS_SUCCESS_CHECK =
  'M 8.292893409729004 0.2928932309150696 C 8.683417320251465 -0.09763109683990479 9.316431999206543 -0.09763109683990479 9.706955909729004 0.2928932309150696 C 10.097404837608337 0.6834235787391663 10.097455382347107 1.316456824541092 9.706955909729004 1.7069557905197144 L 4.206955432891846 7.206955909729004 C 3.8164563179016113 7.597454398870468 3.18342325091362 7.5974041521549225 2.7928929328918457 7.206955909729004 L 0.2928929626941681 4.706955909729004 C -0.09763115644454956 4.316431701183319 -0.09763085842132568 3.6834175884723663 0.2928929626941681 3.292893171310425 C 0.6834172308444977 2.902368903160095 1.3164311647415161 2.902368903160095 1.7069554328918457 3.292893171310425 L 3.4999241828918457 5.085862159729004 L 8.292893409729004 0.2928932309150696 Z'

function clampStatusState(value: string) {
  return STATUS_STATES.includes(value as (typeof STATUS_STATES)[number]) ? (value as (typeof STATUS_STATES)[number]) : 'Success'
}

function nextStatusState(state: (typeof STATUS_STATES)[number]) {
  const index = STATUS_STATES.indexOf(state)
  return STATUS_STATES[(index + 1) % STATUS_STATES.length]
}

export function ToastView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'Default') === 'Vertical' ? 'Vertical' : 'Default'
  const iconOn = type === 'Vertical' && (ctx.v('icon') === undefined || boolish(ctx.v('icon')))
  const actionOn = type === 'Vertical' && (ctx.v('actionButton') === undefined || boolish(ctx.v('actionButton')))
  const arrowOn = type === 'Vertical' && boolish(ctx.v('arrowIcon'))
  const state = str(ctx.v('iconState'), 'Success') === 'Error' ? 'Warning' : clampStatusState(str(ctx.v('iconState'), 'Success'))
  return (
    <div className={`yb-toast ${ctx.className}`.trim()} data-type={type}>
      {iconOn ? (
        <button
          aria-label={`状态 ${state}`}
          className="yb-toast-state"
          onClick={() => ctx.onAction?.(`iconState:${state === 'Success' ? 'Warning' : state === 'Warning' ? 'Info' : 'Success'}`)}
          type="button"
        >
          {ctx.renderSlot(ctx.v('iconSlot'), ctx.renderNamed('3499:3825', { state, decorative: true }))}
        </button>
      ) : null}
      <p>
        {type === 'Vertical'
          ? contentOr(ctx.children, '垂直 Toast 最大宽度为 260')
          : contentOr(ctx.children, '默认 Toast 最大宽度为 260')}
      </p>
      {actionOn ? (
        <button onClick={() => ctx.onAction?.('toast-action')} type="button">
          {str(ctx.v('actionLabel'), '操作按钮')}
          {arrowOn ? <Icon decorative name="Icon/chevron-right" size={14} /> : null}
        </button>
      ) : null}
    </div>
  )
}

const TOOLTIP_ARROW =
  'M 14 0.0000011652294915620587 C 12.791032791137695 0.000001050880840125501 11.644522726535797 0.5112473368644714 10.870560646057129 1.3954659700393677 L 8.173538208007812 4.4766998291015625 C 7.562808096408844 5.174432277679443 6.437188446521759 5.1744314432144165 5.8264594078063965 4.476698875427246 L 3.1294376850128174 1.3954640626907349 C 2.3554757237434387 0.5112453699111938 1.2089669704437256 1.1434863012027563e-7 0 0 L 14 0.0000011652294915620587 Z'

const TOOLTIP_NORMAL = '这里是引导文案'
const TOOLTIP_MIX = '      这里是引导文案这里是引导文案这里是引导文案这里是引导文案'

function clampTooltipType(value: string) {
  return value === 'mix' ? 'mix' : 'normal'
}

function clampTooltipDirection(value: string) {
  return value === 'up' ? 'up' : 'bottom'
}

function clampNotificationKind(value: string) {
  return value === 'pic' ? 'pic' : 'icon'
}

function TooltipArrow({ direction }: { direction: 'up' | 'bottom' }) {
  return (
    <span className="yb-tooltip-arrow-row">
      <svg
        aria-hidden
        className="yb-tooltip-arrow"
        data-direction={direction}
        fill="none"
        height={5}
        viewBox="0 0 14 5"
        width={14}
      >
        <path d={TOOLTIP_ARROW} fill="currentColor" />
      </svg>
    </span>
  )
}

function NotificationCloseMark() {
  return (
    <svg aria-hidden fill="none" height={16} viewBox="0 0 16 16" width={16}>
      <g stroke="currentColor" strokeLinecap="round" strokeWidth={1.5}>
        <path d="M3.297 3.297 L12.703 12.703" />
        <path d="M12.703 3.297 L3.297 12.703" />
      </g>
    </svg>
  )
}

function NotificationEntryMark() {
  return (
    <svg aria-hidden fill="none" height={16} viewBox="0 0 16 16" width={16}>
      <path
        d="M5.333 3 L10.333 8 L5.333 13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </svg>
  )
}

function StatusWarningMark() {
  return (
    <g className="yb-status-mark" transform="translate(10.75 7)">
      <path d="M 1.25 7.5 C 1.9403559565544128 7.5 2.5 8.059644043445587 2.5 8.75 C 2.5 9.440355956554413 1.9403559565544128 10 1.25 10 C 0.5596440434455872 10 0 9.440355956554413 0 8.75 C 0 8.059644043445587 0.5596440434455872 7.5 1.25 7.5 Z" />
      <path d="M 1.25 0 C 1.8022847771644592 0 2.25 0.44771522283554077 2.25 1 L 2.25 5.5 C 2.25 6.0522847175598145 1.8022847771644592 6.5 1.25 6.5 C 0.6977152228355408 6.5 0.25 6.0522847175598145 0.25 5.5 L 0.25 1 C 0.25 0.44771522283554077 0.6977152228355408 0 1.25 0 Z" />
    </g>
  )
}

function StatusStateMark({
  size,
  state,
}: {
  size: number
  state: (typeof STATUS_STATES)[number]
}) {
  return (
    <svg aria-hidden fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <circle className={`yb-status-body is-${state.toLowerCase()}`} cx="12" cy="12" r="10" />
      {state === 'Success' ? (
        <g className="yb-status-mark" transform="translate(7 8.5)">
          <path d={STATUS_SUCCESS_CHECK} />
        </g>
      ) : state === 'Info' ? (
        <g className="yb-status-mark" transform="translate(10.75 7)">
          <path d="M 1.25 3.5 C 1.8022847771644592 3.5 2.25 3.9477152228355408 2.25 4.5 L 2.25 9 C 2.25 9.552284717559814 1.8022847771644592 10 1.25 10 C 0.6977152228355408 10 0.25 9.552284717559814 0.25 9 L 0.25 4.5 C 0.25 3.9477152228355408 0.6977152228355408 3.5 1.25 3.5 Z M 1.25 0 C 1.9403559565544128 0 2.5 0.5596440434455872 2.5 1.25 C 2.5 1.9403559565544128 1.9403559565544128 2.5 1.25 2.5 C 0.5596440434455872 2.5 0 1.9403559565544128 0 1.25 C 0 0.5596440434455872 0.5596440434455872 0 1.25 0 Z" />
        </g>
      ) : (
        <StatusWarningMark />
      )}
    </svg>
  )
}

export function TooltipView({ ctx }: { ctx: RenderCtx }) {
  const type = clampTooltipType(str(ctx.v('type'), 'normal'))
  const direction = clampTooltipDirection(str(ctx.v('direction'), 'bottom'))
  const showIcon = ctx.v('showIcon') === undefined ? true : boolish(ctx.v('showIcon'))
  const showClose = boolish(ctx.v('showClose'))
  const copy = type === 'mix' ? contentOr(ctx.children, TOOLTIP_MIX) : contentOr(ctx.children, TOOLTIP_NORMAL)
  const arrow = <TooltipArrow direction={direction} />
  return (
    <div className={`yb-tooltip ${ctx.className}`.trim()} data-direction={direction} data-type={type}>
      {direction === 'up' ? arrow : null}
      <div className="yb-tooltip-body">
        <div className="yb-tooltip-content">
          {showIcon ? (
            <span className="yb-tooltip-icon">{ctx.renderSlot(ctx.v('icon'), <Icon decorative name="Icon/A" size={22} />)}</span>
          ) : null}
          <p>{copy}</p>
        </div>
        {showClose ? (
          <button aria-label="关闭" className="yb-tooltip-close" onClick={() => ctx.onAction?.('close')} type="button">
            <Icon decorative name="Icon/close-sm" size={20} />
          </button>
        ) : null}
      </div>
      {direction === 'bottom' ? arrow : null}
    </div>
  )
}

export function NotificationView({ ctx }: { ctx: RenderCtx }) {
  const kind = clampNotificationKind(str(ctx.v('notification'), 'icon'))
  const iconOn = kind === 'icon' && (ctx.v('icon') === undefined ? true : boolish(ctx.v('icon')))
  const subtitleOn = ctx.v('subtitle') === undefined ? true : boolish(ctx.v('subtitle'))
  const buttonOn = ctx.v('button') === undefined ? true : boolish(ctx.v('button'))
  const closeOn = ctx.v('close') === undefined ? true : boolish(ctx.v('close'))
  const entryOn = boolish(ctx.v('entry'))
  return (
    <div className={`yb-notification ${ctx.className}`.trim()} data-kind={kind}>
      <div className="yb-notification-main">
        {kind === 'pic' ? (
          <span className="yb-notification-pic">
            <img alt="" height={48} src={contentImageSrc(ctx.v('imageSrc'), '/images/notification-pic.png')} width={48} />
          </span>
        ) : iconOn ? (
          <span className="yb-notification-icon">
            {ctx.renderSlot(ctx.v('iconSlot'), <Icon decorative name="Icon/A" size={22} />)}
          </span>
        ) : null}
        <div className="yb-notification-copy">
          <strong>这里是主标题</strong>
          {subtitleOn ? <p>{contentOr(ctx.children, '这里是副标题，副标题有点长')}</p> : null}
        </div>
      </div>
      <div className="yb-notification-actions">
        {buttonOn ? (
          <button className="yb-notification-cta" onClick={() => ctx.onAction?.('press')} type="button">
            开启
          </button>
        ) : null}
        {closeOn ? (
          <button aria-label="关闭" className="yb-notification-close" onClick={() => ctx.onAction?.('close')} type="button">
            <NotificationCloseMark />
          </button>
        ) : null}
        {entryOn ? (
          <button aria-label="进入" className="yb-notification-entry" onClick={() => ctx.onAction?.('entry')} type="button">
            <NotificationEntryMark />
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function SnackbarView({ ctx }: { ctx: RenderCtx }) {
  const iconOn = ctx.v('icon') === undefined ? true : boolish(ctx.v('icon'))
  const actionOn = ctx.v('actionButton') === undefined ? true : boolish(ctx.v('actionButton'))
  const state = clampStatusState(str(ctx.v('iconState'), 'Success'))
  return (
    <div className={`yb-snackbar ${ctx.className}`.trim()}>
      <div className="yb-snackbar-text">
        {iconOn ? (
          <button
            aria-label={`状态 ${state}`}
            className="yb-snackbar-state"
            onClick={() => ctx.onAction?.(`iconState:${nextStatusState(state)}`)}
            type="button"
          >
            <StatusStateMark size={20} state={state} />
          </button>
        ) : null}
        <p>{contentOr(ctx.children, 'Snackbar 建议单行文本')}</p>
      </div>
      {actionOn ? (
        <button className="yb-snackbar-action" onClick={() => ctx.onAction?.('press')} type="button">
          操作按钮
        </button>
      ) : null}
    </div>
  )
}

const TIP_DOUBLE = '这里是引导文案，这里是引导文案，这里是引导文案'
const TIP_SINGLE = '这里是引导文案'

function clampTipLine(value: string) {
  return value === 'single' ? 'single' : 'double'
}

function clampOutputKind(value: string) {
  return value === 'loading-moving' ? 'loading-moving' : 'loading-silence'
}

function clampBlueFrame(value: string) {
  return value === '2' ? '2' : '1'
}

function GuideStem() {
  return (
    <div aria-hidden className="yb-guide-stem">
      <span className="yb-guide-column">
        <svg className="yb-guide-line" fill="none" height={64} viewBox="0 0 1 64" width={1}>
          <line
            stroke="currentColor"
            strokeDasharray="1.5 4"
            strokeLinecap="round"
            strokeWidth={1}
            x1="0.5"
            x2="0.5"
            y1="0"
            y2="64"
          />
        </svg>
        <span className="yb-guide-dot">
          <i className="yb-guide-core" />
        </span>
      </span>
    </div>
  )
}

export function TipView({ ctx }: { ctx: RenderCtx }) {
  const line = clampTipLine(str(ctx.v('line'), 'double'))
  return (
    <div className={`yb-tip ${ctx.className}`.trim()} data-line={line}>
      <p>{contentOr(ctx.children, line === 'single' ? TIP_SINGLE : TIP_DOUBLE)}</p>
    </div>
  )
}

export function GuideView({ ctx }: { ctx: RenderCtx }) {
  const direction = clampTooltipDirection(str(ctx.v('direction'), 'up'))
  const line = clampTipLine(str(ctx.v('line'), 'double'))
  const stem = <GuideStem />
  return (
    <div className={`yb-guide ${ctx.className}`.trim()} data-direction={direction}>
      {direction === 'up' ? ctx.renderNamed('tip', { line }) : stem}
      {direction === 'up' ? stem : ctx.renderNamed('tip', { line })}
    </div>
  )
}

export function LoadingView({ ctx }: { ctx: RenderCtx }) {
  return (
    <div className={`yb-loading ${ctx.className}`.trim()}>
      <img alt="" aria-hidden className="yb-loading-spinner" height={32} src="/icons/loading-spinner.svg" width={32} />
      <p>{contentOr(ctx.children, '加载中')}</p>
    </div>
  )
}

export function LoadingTextView({ ctx }: { ctx: RenderCtx }) {
  return (
    <div className={`yb-loading-text ${ctx.className}`.trim()}>
      <img
        alt=""
        aria-hidden
        className="yb-loading-text-spinner"
        height={20}
        src="/icons/loading-text-spinner.svg"
        width={20}
      />
      <p>{contentOr(ctx.children, '加载中...')}</p>
    </div>
  )
}

export function OutputView({ ctx }: { ctx: RenderCtx }) {
  const kind = clampOutputKind(str(ctx.v('property1'), 'loading-silence'))
  const src = kind === 'loading-moving' ? '/loading/output-moving.gif' : '/loading/output-silence.png'
  return (
    <img
      alt=""
      aria-hidden
      className={`yb-output ${ctx.className}`.trim()}
      data-kind={kind}
      height={24}
      src={src}
      width={24}
    />
  )
}

export function BlueView({ ctx }: { ctx: RenderCtx }) {
  const frame = clampBlueFrame(str(ctx.v('property1'), '1'))
  return (
    <div className={`yb-function-blue ${ctx.className}`.trim()} data-frame={frame}>
      <img alt="" height={400} src={`/loading/blue-${frame}.png`} width={400} />
    </div>
  )
}

export function IndicatorView({ ctx }: { ctx: RenderCtx }) {
  const focus = clampFeatureFocus(str(ctx.v('focus'), '1'))
  return (
    <div className={`yb-feature-indicator ${ctx.className}`.trim()} data-focus={focus}>
      {FEATURE_FOCUS.map((value) => (
        <button
          aria-current={value === focus ? 'true' : undefined}
          aria-label={`第 ${value} 张`}
          className="yb-feature-dot"
          data-on={value === focus ? 'true' : 'false'}
          key={value}
          onClick={() => ctx.onAction?.(`focus:${value}`)}
          type="button"
        />
      ))}
    </div>
  )
}

export function TextAtomView({ ctx }: { ctx: RenderCtx }) {
  const type = clampFeatureText(str(ctx.v('type'), 'singleLine'))
  return (
    <div className={`yb-feature-text ${ctx.className}`.trim()} data-type={type}>
      <h2>标题</h2>
      <p>
        {type === 'multiLine' ? '此处添加内文, 内文控制在三行，此处添加内文, 内文控制在两行，' : '此处添加内文, 内文控制在三行，'}
        <a className="yb-feature-link">可加文字链</a>
      </p>
    </div>
  )
}
