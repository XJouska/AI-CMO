import { type CSSProperties, type ReactNode } from 'react'
import { asStringChange, boolish, contentOr, defaultButtonLabel, isEmptySlot, str } from '../helpers'
import { Icon, iconSrc } from '../Icon'
import type { RenderCtx } from '../context'
import { SwitchGraphic } from './SwitchGraphic'

const BUTTON_ICON_SIZE: Record<string, number> = {
  L: 22,
  M: 20,
  'M-': 20,
  'S+': 16,
  S: 16,
  XS: 14,
}

function buttonSizeClass(size: string) {
  return `yb-button-${size.replace('+', 'plus')}`
}

/** Icon/A 导出是字形框（≈17.89），Figma 实例按 24 画布缩放到按钮 Size。 */
const ICON_A_GLYPH = 17.8887 / 24

function ButtonIcon({ size, slot }: { size: number; slot: ReactNode }) {
  if (slot) {
    return (
      <span className="yb-button-icon is-slot" style={{ height: size, width: size }}>
        {slot}
      </span>
    )
  }
  const src = iconSrc('Icon/A')
  const glyph = `${(ICON_A_GLYPH * 100).toFixed(3)}%`
  const mask: CSSProperties = {
    WebkitMaskImage: `url("${src}")`,
    WebkitMaskSize: `${glyph} ${glyph}`,
    maskImage: `url("${src}")`,
    maskSize: `${glyph} ${glyph}`,
  }
  return (
    <span aria-hidden className="yb-button-icon" style={{ height: size, width: size }}>
      <span className="yb-button-icon-glyph" style={mask} />
    </span>
  )
}

export function ButtonView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'Primary')
  const size = str(ctx.v('size'), 'L')
  const state = str(ctx.v('state'), 'Default')
  const disabled = state === 'Disable'
  const leftIcon = boolish(ctx.v('leftIcon'))
  const rightIcon = boolish(ctx.v('rightIcon'))
  const shadow = boolish(ctx.v('shadow'))
  const iconSize = BUTTON_ICON_SIZE[size] ?? 22
  const label = contentOr(ctx.children, defaultButtonLabel(type))
  const left = leftIcon ? (
    <ButtonIcon size={iconSize} slot={isEmptySlot(ctx.v('leftSlot')) ? null : ctx.renderSlot(ctx.v('leftSlot'))} />
  ) : null
  const right = rightIcon ? (
    <ButtonIcon size={iconSize} slot={isEmptySlot(ctx.v('rightSlot')) ? null : ctx.renderSlot(ctx.v('rightSlot'))} />
  ) : null

  return (
    <button
      className={`yb-button yb-button-${type.toLowerCase()} ${buttonSizeClass(size)} ${shadow ? 'has-shadow' : ''} ${ctx.className}`.trim()}
      data-size={size}
      data-state={state}
      disabled={disabled}
      onClick={() => {
        if (!disabled) ctx.onAction?.('press')
      }}
      type="button"
    >
      <span className="yb-button-content">
        {left}
        <span className="yb-button-label">{label}</span>
        {right}
      </span>
    </button>
  )
}

export function SwitchView({ ctx }: { ctx: RenderCtx }) {
  const turnOn = str(ctx.v('turnOn'), 'true') === 'true'
  const disabled = str(ctx.v('disabled'), 'false') === 'true'
  return (
    <button
      aria-checked={turnOn}
      className={`yb-switch ${ctx.className}`.trim()}
      data-checked={turnOn}
      data-disabled={disabled}
      disabled={disabled}
      onClick={() => ctx.onAction?.('toggle')}
      role="switch"
      type="button"
    >
      <SwitchGraphic checked={turnOn} />
    </button>
  )
}

export function RadioCheckBoxView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'circled')
  const size = str(ctx.v('size'), 'lg')
  const state = str(ctx.v('state'), 'unchecked')
  const resolvedType = type === 'plain' ? 'plain' : 'circled'
  const resolvedState = resolvedType === 'plain' ? 'checked' : state
  const checked = resolvedState === 'checked' || resolvedState === 'checkedDisabled'
  const disabled = resolvedState === 'disabled' || resolvedState === 'checkedDisabled'
  const mark = resolvedType === 'plain' ? 'radio-check-plain' : 'radio-check'

  return (
    <button
      aria-checked={checked}
      aria-label={checked ? '已选中' : '未选中'}
      className={`yb-check yb-check-${resolvedType} yb-check-${size} ${ctx.className}`.trim()}
      data-state={resolvedState}
      disabled={disabled}
      onClick={() => {
        if (!disabled) ctx.onAction?.('toggle')
      }}
      type="button"
    >
      {checked ? (
        <span
          aria-hidden
          className="yb-check-mark"
          style={{
            WebkitMaskImage: `url("/icons/${mark}.svg")`,
            maskImage: `url("/icons/${mark}.svg")`,
          }}
        />
      ) : null}
    </button>
  )
}

const FORM_SINGLE_SAMPLE = '火火的元宝群'
const FORM_DOUBLE_SAMPLE = '每周一早上 9 点给我推送最近一周最新的AI新闻。'
const FORM_CLEAR_X =
  'M7.00015 6.99699L10.0031 9.99998M10.0031 9.99998L13.0002 12.997M10.0031 9.99998L13.0001 7.00298M10.0031 9.99998L7.00012 13.003'

function FormCaret({ active, slot }: { active: boolean; slot?: ReactNode }) {
  if (!active) return null
  if (slot) return <>{slot}</>
  return <i aria-hidden className="yb-form-caret" />
}

function FormClear({ onClear }: { onClear: () => void }) {
  return (
    <button
      aria-label="清除"
      className="yb-form-clear"
      onClick={(event) => {
        event.stopPropagation()
        onClear()
      }}
      type="button"
    >
      <svg aria-hidden className="yb-form-clear-x" fill="none" height="20" viewBox="0 0 20 20" width="20">
        <path d={FORM_CLEAR_X} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      </svg>
    </button>
  )
}

export function FormSingleLineView({ ctx }: { ctx: RenderCtx }) {
  const active = boolish(ctx.v('active'))
  const align = str(ctx.v('align'), 'middle')
  const inputOn = str(ctx.v('input'), 'off') === 'on'
  const extraLabel = typeof ctx.values.label === 'string' ? ctx.values.label : null
  const placeholder = str(ctx.values.placeholder, '请输入')
  const onChange = asStringChange(ctx.values.onChange)
  const controlled = typeof ctx.values.value === 'string'
  const value = controlled ? String(ctx.values.value) : inputOn ? FORM_SINGLE_SAMPLE : ''
  const maxLength = typeof ctx.values.maxLength === 'number' ? ctx.values.maxLength : undefined
  const showPlaceholder = !inputOn

  return (
    <div className={`yb-form-wrap ${ctx.className}`.trim()}>
      {extraLabel ? <span className="yb-form-label">{extraLabel}</span> : null}
      <div
        className={`yb-form-single ${active ? 'is-active' : ''}`}
        data-align={align}
        data-input={inputOn ? 'on' : 'off'}
        onClick={() => ctx.onAction?.('focus')}
      >
        {inputOn || onChange ? (
          <>
            <span className="yb-form-value">
              {onChange ? (
                <input
                  aria-label={extraLabel || placeholder}
                  maxLength={maxLength}
                  onChange={(event) => onChange(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  placeholder={placeholder}
                  value={value}
                />
              ) : (
                value
              )}
              {onChange ? null : <FormCaret active={active} />}
            </span>
            {value ? (
              <FormClear
                onClear={() => {
                  onChange?.('')
                  ctx.onAction?.('clear')
                }}
              />
            ) : null}
          </>
        ) : (
          <>
            <FormCaret active={active} />
            {showPlaceholder ? <em>{placeholder}</em> : null}
          </>
        )}
      </div>
    </div>
  )
}

export function FormDoubleLineView({ ctx }: { ctx: RenderCtx }) {
  const active = boolish(ctx.v('active'))
  const showDelete = ctx.v('propDelete') === undefined ? true : boolish(ctx.v('propDelete'))
  const scroll = boolish(ctx.v('scroll'))
  const inputOn = str(ctx.v('input'), 'off') === 'on'
  const extraLabel = typeof ctx.values.label === 'string' ? ctx.values.label : null
  const placeholder = str(ctx.values.placeholder, '请输入')
  const onChange = asStringChange(ctx.values.onChange)
  const controlled = typeof ctx.values.value === 'string'
  const value = controlled ? String(ctx.values.value) : inputOn ? FORM_DOUBLE_SAMPLE : ''
  const maxLength = typeof ctx.values.maxLength === 'number' ? ctx.values.maxLength : undefined
  const cursorSlot = isEmptySlot(ctx.v('cursor')) ? null : ctx.renderSlot(ctx.v('cursor'))

  return (
    <div className={`yb-form-wrap ${ctx.className}`.trim()}>
      {extraLabel ? <span className="yb-form-label">{extraLabel}</span> : null}
      <div
        className={`yb-form-double ${active ? 'is-active' : ''}`}
        data-input={inputOn ? 'on' : 'off'}
        onClick={() => ctx.onAction?.('focus')}
      >
        {inputOn || onChange ? (
          <>
            <span className="yb-form-value is-multiline">
              {onChange ? (
                <textarea
                  aria-label={extraLabel || placeholder}
                  maxLength={maxLength}
                  onChange={(event) => onChange(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  placeholder={placeholder}
                  value={value}
                />
              ) : (
                <>
                  {value}
                  <FormCaret active={active} slot={cursorSlot} />
                </>
              )}
            </span>
            {showDelete && value ? (
              <FormClear
                onClear={() => {
                  onChange?.('')
                  ctx.onAction?.('clear')
                }}
              />
            ) : null}
          </>
        ) : (
          <>
            <FormCaret active={active} slot={cursorSlot} />
            <em>{placeholder}</em>
          </>
        )}
        {scroll ? <i aria-hidden className="yb-form-scroll" /> : null}
      </div>
    </div>
  )
}

/** Figma Vector 4.8×4.8 at (5.6, 5.6) in the 16×16 clear frame — center 8,8. */
const SEARCH_CLEAR_X = 'M5.6 5.6L10.4 10.4M10.4 5.6L5.6 10.4'

function SearchClear({ onClear }: { onClear: () => void }) {
  return (
    <button
      aria-label="清除"
      className="yb-search-clear"
      onClick={(event) => {
        event.stopPropagation()
        onClear()
      }}
      type="button"
    >
      <svg aria-hidden className="yb-search-clear-x" fill="none" height="16" viewBox="0 0 16 16" width="16">
        <path d={SEARCH_CLEAR_X} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      </svg>
    </button>
  )
}

export function SearchView({ ctx }: { ctx: RenderCtx }) {
  const status = str(ctx.v('status'), 'default')
  const paiName = boolish(ctx.v('paiName')) && status === 'inputted'
  const placeholder = str(ctx.v('placeholder'), '搜索')
  const suppliedValue = ctx.v('value')
  const query = typeof suppliedValue === 'string' ? suppliedValue : str(suppliedValue, typeof ctx.children === 'string' ? ctx.children : '元宝')
  const onChange = ctx.values.onChange as ((value: string) => void) | undefined

  return (
    <div className={`yb-search ${ctx.className}`.trim()} data-status={status}>
      <div
        className="yb-search-field"
        onClick={() => {
          if (status === 'default') ctx.onAction?.('focus')
          if (status === 'focus') ctx.onAction?.('input')
        }}
        role="searchbox"
      >
        <Icon decorative name="Icon/Search" size={18} />
        {onChange ? (
          <input
            aria-label={placeholder}
            className="yb-search-native"
            onChange={(event) => onChange(event.target.value)}
            onFocus={() => ctx.onAction?.('focus')}
            placeholder={placeholder}
            value={query}
          />
        ) : null}
        {!onChange && status === 'default' ? <em>{placeholder}</em> : null}
        {!onChange && status === 'focus' ? (
          <>
            <i aria-hidden className="yb-search-caret" />
            <em>{placeholder}</em>
          </>
        ) : null}
        {!onChange && status === 'inputted' ? (
          <>
            <div className="yb-search-grow">
              <div className="yb-search-content">
                {paiName ? <b className="yb-search-pai">派名</b> : null}
                <span className="yb-search-query">{query}</span>
              </div>
              <i aria-hidden className="yb-search-caret" />
            </div>
            <SearchClear onClear={() => ctx.onAction?.('clear')} />
          </>
        ) : null}
        {onChange && query ? <SearchClear onClear={() => onChange('')} /> : null}
      </div>
      {status !== 'default' ? (
        <button className="yb-search-cancel" onClick={() => ctx.onAction?.('cancel')} type="button">
          取消
        </button>
      ) : null}
    </div>
  )
}

const AGENT_ICON_FILE: Record<string, string> = {
  Camera: 'agent-camera',
  Voice: 'agent-voice',
  Plus: 'agent-plus',
  Keyboard: 'agent-keyboard',
  Sticker: 'agent-sticker',
  Photo: 'agent-photo',
}

export function AgentInputIconView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'Camera')
  const file = AGENT_ICON_FILE[type] ?? 'agent-camera'
  return (
    <button
      aria-label={type}
      className={`yb-agent-icon-btn ${ctx.className}`.trim()}
      onClick={() => ctx.onAction?.(`agent-icon:${type}`)}
      type="button"
    >
      <span
        aria-hidden
        className="yb-agent-icon"
        style={{
          WebkitMaskImage: `url("/icons/${file}.svg")`,
          maskImage: `url("/icons/${file}.svg")`,
        }}
      />
    </button>
  )
}

const AGENT_COMBO_END_PAD = new Set(['Voice & Plus', 'Keyboard & Plus', 'Plus Only', 'Voice Only'])

export function AgentInputButtonsView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'Voice & Plus')
  const nodes: ReactNode[] = []
  if (type.includes('Keyboard')) nodes.push(<span key="keyboard">{ctx.renderNamed('.Agent Input/Icon', { type: 'Keyboard' })}</span>)
  else if (type.includes('Voice')) nodes.push(<span key="voice">{ctx.renderNamed('.Agent Input/Icon', { type: 'Voice' })}</span>)
  if (type.includes('Plus')) nodes.push(<span key="plus">{ctx.renderNamed('.Agent Input/Icon', { type: 'Plus' })}</span>)
  if (type.includes('Send')) nodes.push(<span key="send">{ctx.renderNamed('.Agent Input/PrimaryButton', { type: 'Send' })}</span>)
  if (type.includes('Stop')) nodes.push(<span key="stop">{ctx.renderNamed('.Agent Input/PrimaryButton', { type: 'Stop' })}</span>)
  return (
    <div
      className={`yb-agent-input-btns ${AGENT_COMBO_END_PAD.has(type) ? 'has-end-pad' : ''} ${ctx.className}`.trim()}
      data-type={type}
    >
      {nodes}
    </div>
  )
}

export function AgentInputPrimaryButtonView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'Send')
  const stop = type === 'Stop'
  return (
    <button
      aria-label={stop ? '停止' : '发送'}
      className={`yb-agent-primary ${ctx.className}`.trim()}
      onClick={() => ctx.onAction?.(stop ? 'stop' : 'send')}
      type="button"
    >
      {stop ? (
        <span className="yb-agent-stop" />
      ) : (
        <span
          aria-hidden
          className="yb-agent-send-glyph"
          style={{
            WebkitMaskImage: 'url("/icons/agent-send.svg")',
            maskImage: 'url("/icons/agent-send.svg")',
          }}
        />
      )}
    </button>
  )
}

const AGENT_RIGHT_TYPE: Record<string, string> = {
  Default: 'Voice & Plus',
  Voice: 'Keyboard & Plus',
  Inputting: 'Send & Plus',
  Stopped: 'Stop & Plus',
  Upload: 'Send & Voice & Plus',
  'Long Text': 'Send & Plus',
  'Atomic-Default': 'Voice & Plus',
  'Atomic-Customized': 'Voice & Plus',
}

const AGENT_HIDE_LEFT = new Set(['Inputting', 'Long Text', 'Upload'])

const AGENT_LONG_TEXT =
  '帮我生成图片：一张专业录音室试音场景的写实风格插画，展现萌宠专注工作的可爱画面。一只毛茸茸的布偶猫戴着专业录音耳机，前爪轻搭在麦克风支架上，湛蓝色圆眼专注凝视前方，耳朵微竖呈现认真聆听的神态。采用细腻的动物写实风格，柔和自然光从侧上方洒落，突出猫咪丝绒质感的毛发和耳机金属细节。近景平视角凸显猫咪生动表情，录音室环境简洁专业，灰色吸音墙与设备形成高级灰调背景，氛围安静专注且带有一丝趣味性，比例3:4'

function AgentCursor() {
  return <span className="yb-agent-cursor" />
}

function AgentInputField({
  ctx,
  type,
  leftBtn,
}: {
  ctx: RenderCtx
  type: string
  leftBtn: boolean
}) {
  const rightOverride = typeof ctx.v('rightType') === 'string' ? String(ctx.v('rightType')) : ''
  const rightType = rightOverride || AGENT_RIGHT_TYPE[type] || 'Voice & Plus'
  const combo = ctx.renderNamed('.Agent Input/ButtonCombination', { type: rightType })
  const camera = leftBtn ? ctx.renderNamed('.Agent Input/Icon', { type: 'Camera' }) : null
  const extraValue = typeof ctx.v('value') === 'string' ? String(ctx.v('value')) : undefined
  const extraPlaceholder = typeof ctx.v('placeholder') === 'string' ? String(ctx.v('placeholder')) : undefined

  function emitHold(kind: 'start' | 'move' | 'end', event: { clientX: number; clientY: number }) {
    ctx.onAction?.(`hold-${kind}:${Math.round(event.clientX)}:${Math.round(event.clientY)}`)
  }

  if (type === 'Voice') {
    return (
      <div
        className="yb-agent-input-body is-voice"
        onPointerCancel={() => ctx.onAction?.('hold-cancel')}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          emitHold('start', event)
        }}
        onPointerMove={(event) => emitHold('move', event)}
        onPointerUp={(event) => emitHold('end', event)}
      >
        {camera}
        <p className="yb-agent-voice-label">{extraValue || '按住 说话'}</p>
        {combo}
      </div>
    )
  }

  if (type === 'Long Text') {
    return (
      <div className="yb-agent-input-body is-long">
        <div className="yb-agent-longtext">
          <p className="yb-agent-value">{AGENT_LONG_TEXT}</p>
          <span className="yb-agent-long-cursor">
            <AgentCursor />
          </span>
          <span className="yb-agent-scrollbar" />
        </div>
        {combo}
        <button aria-label="展开" className="yb-agent-expand" type="button">
          <span
            aria-hidden
            className="yb-agent-icon"
            style={{
              WebkitMaskImage: 'url("/icons/expand.svg")',
              maskImage: 'url("/icons/expand.svg")',
            }}
          />
        </button>
      </div>
    )
  }

  if (type === 'Inputting' || type === 'Upload') {
    const inputtingText =
      extraValue !== undefined ? extraValue : type === 'Upload' ? '分析上传的内容' : '最近一周的国际新闻'
    const listening = !inputtingText
    return (
      <div className={type === 'Upload' ? 'yb-agent-input-row' : 'yb-agent-input-body'}>
        <div className={listening ? 'yb-agent-input-left' : 'yb-agent-input-left is-value'}>
          {listening ? (
            <p className="yb-agent-placeholder">{extraPlaceholder || '正在聆听'}</p>
          ) : (
            <p className="yb-agent-value">{inputtingText}</p>
          )}
          {listening ? null : <AgentCursor />}
        </div>
        {combo}
      </div>
    )
  }

  const defaultText = extraValue !== undefined ? extraValue : ''
  const defaultPlaceholder = extraPlaceholder || '发消息或按住说话'
  const onChange = ctx.values.onChange as ((value: string) => void) | undefined
  return (
    <div className={type === 'Atomic-Customized' ? 'yb-agent-input-row' : 'yb-agent-input-body'}>
      <div className={defaultText ? 'yb-agent-input-left is-value' : 'yb-agent-input-left'}>
        {camera}
        {onChange ? (
          <input
            aria-label={defaultPlaceholder}
            className="yb-agent-native"
            onChange={(event) => onChange(event.target.value)}
            onFocus={() => ctx.onAction?.('focus')}
            placeholder={defaultPlaceholder}
            value={defaultText}
          />
        ) : defaultText ? (
          <p className="yb-agent-value">{defaultText}</p>
        ) : (
          <p
            className="yb-agent-placeholder"
            onClick={() => ctx.onAction?.('focus')}
            role="presentation"
          >
            {defaultPlaceholder}
          </p>
        )}
      </div>
      {combo}
    </div>
  )
}

export function AgentInputView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'Default')
  const leftBtn =
    (ctx.v('leftBtn') === undefined ? true : boolish(ctx.v('leftBtn'))) && !AGENT_HIDE_LEFT.has(type)
  const atomic = type.startsWith('Atomic')
  const field = <AgentInputField ctx={ctx} leftBtn={leftBtn} type={type} />

  const titleBar = atomic ? (
    <div className="yb-agent-atom-bar">
      <div className="yb-agent-atom-name">
        <span className="yb-agent-atom-icon">
          {isEmptySlot(ctx.v('iconSlot')) ? <Icon decorative name="Icon/A" size={20} /> : ctx.renderSlot(ctx.v('iconSlot'))}
        </span>
        <strong>原子能力</strong>
      </div>
      <button aria-label="关闭" className="yb-agent-atom-close" type="button">
        <Icon decorative name="Icon/close-sm" size={20} />
      </button>
    </div>
  ) : null

  function attachClose() {
    return (
      <button aria-label="移除" className="yb-agent-attach-close" type="button">
        <span
          aria-hidden
          className="yb-agent-attach-x"
          style={{
            WebkitMaskImage: 'url("/icons/close-lg.svg")',
            maskImage: 'url("/icons/close-lg.svg")',
          }}
        />
      </button>
    )
  }

  const uploadSlot = (
    <div className="yb-agent-upload-slot">
      {isEmptySlot(ctx.v('slot')) ? (
        <>
          {ctx.renderNamed('卡片', { card: 'File', close: true, file: 'PDF' }, '文件名')}
          <div className="yb-agent-photo-thumb">{attachClose()}</div>
        </>
      ) : (
        ctx.renderSlot(ctx.v('slot'))
      )}
    </div>
  )

  const customSlot = (
    <div className="yb-agent-custom-slot">
      {isEmptySlot(ctx.v('slot')) ? (
        <>
          <span className="yb-agent-custom-box" />
          <em>自定义内容区域</em>
        </>
      ) : (
        ctx.renderSlot(ctx.v('slot'))
      )}
    </div>
  )

  return (
    <div className={`yb-agent-input ${ctx.className}`.trim()} data-type={type}>
      <div className="yb-agent-bg" />
      {type === 'Upload' ? (
        <div className="yb-agent-input-body is-upload">
          {uploadSlot}
          {field}
        </div>
      ) : atomic ? (
        <div className="yb-agent-atom-stack">
          {titleBar}
          {type === 'Atomic-Customized' ? (
            <div className="yb-agent-input-body is-custom">
              {customSlot}
              {field}
            </div>
          ) : (
            field
          )}
        </div>
      ) : (
        field
      )}
    </div>
  )
}
