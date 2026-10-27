import { useState } from 'react'
import type { RenderCtx } from '../context'
import { boolish, contentImageSrc, contentOr, str } from '../helpers'
import './list-parts.css'
import { SwitchGraphic } from './SwitchGraphic'

const trailingIcons: Record<string, string> = {
  '上下箭头': '19766-24813', '下一级箭头': '19766-24817',
  '更多': '19766-24821', '主题色': '19766-24828',
}
const visibilityIcons: Record<string, string> = {
  '私密': '19766-24948', '公开': '19766-24952', '不被发现': '19766-24959',
}

function ExactMark({ id, label, color }: { id: string; label: string; color?: string }) {
  const src = `/figma-assets/${id}.svg`
  return color
    ? <span aria-label={label} role="img" className="yb-list-part-mark"
        style={{ background: color, mask: `url("${src}") center / contain no-repeat` }} />
    : <img alt={label} className="yb-list-part-mark" src={src} width={16} height={16} />
}

export function ListSectionTitleView({ ctx }: { ctx: RenderCtx }) {
  return <div className={`yb-list-section-title ${ctx.className}`}>{contentOr(ctx.children, '列表小标题')}</div>
}

export function ListTrailingIconView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), '更多')
  return <span className={`yb-list-part-icon ${ctx.className}`}>
    <ExactMark id={trailingIcons[type] ?? trailingIcons['更多']} label={type}
      color={type === '主题色' ? undefined : 'var(--yb-color-basic-text-quinary)'} />
  </span>
}

export function AgentVisibilityIconView({ ctx }: { ctx: RenderCtx }) {
  const state = str(ctx.v('state'), '不被发现')
  return <span className={`yb-list-part-icon ${ctx.className}`}>
    <ExactMark id={visibilityIcons[state] ?? visibilityIcons['不被发现']} label={state}
      color="var(--yb-color-basic-text-quaternary)" />
  </span>
}

export function ListExperienceBadgeView({ ctx }: { ctx: RenderCtx }) {
  const on = str(ctx.v('state'), 'on') === 'on'
  // The source description says off hides the badge; its canvas has a grey glyph.
  return <span className={`yb-list-experience-badge ${ctx.className}`} data-state={on ? 'on' : 'off'}>
    {on && <img alt="元宝体验馆" src="/figma-assets/19766-25546.svg" width={18} height={18} />}
  </span>
}

export function ListTrailingSwitchView({ ctx }: { ctx: RenderCtx }) {
  const sourceOn = str(ctx.v('state'), 'off') === 'on'
  return <TrailingSwitchControl key={String(sourceOn)} ctx={ctx} sourceOn={sourceOn} />
}

function TrailingSwitchControl({ ctx, sourceOn }: { ctx: RenderCtx; sourceOn: boolean }) {
  const [on, setOn] = useState(sourceOn)
  return <button type="button" role="switch" aria-label={str(ctx.v('label'), '开关')} aria-checked={on}
    className={`yb-switch yb-list-part-switch ${ctx.className}`} data-checked={on}
    onClick={event => { event.stopPropagation(); setOn(!on); ctx.onAction?.('toggle') }}>
    <SwitchGraphic checked={on} />
  </button>
}

export function ListTrailingContentView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), '常规描述')
  const label = contentOr(ctx.children, type === '按钮' ? '按钮' : type === '带图标描述' ? '带图标选项' : '描述文本')
  if (type === '按钮') return <button type="button" className={`yb-list-part-button ${ctx.className}`}
    onClick={event => { event.stopPropagation(); ctx.onAction?.('press') }}>{label}</button>
  return <span className={`yb-list-trailing-content ${ctx.className}`} data-type={type}>
    {type === '头像'
      ? <img alt="" className="yb-list-part-avatar" width={48} height={48}
          src={contentImageSrc(ctx.v('imageSrc'), '/figma-assets/list-avatar.png')} />
      : <><span className="yb-list-trailing-option">
          {type === '带图标描述' && ctx.renderNamed('19766:24812', { type: '主题色' })}
          <span>{label}</span>
        </span>
        {boolish(ctx.v('showDot')) && <i className="yb-list-part-dot is-small" />}</>}
    {ctx.renderNamed('19766:24812', { type: '下一级箭头' })}
  </span>
}

export function ListItemTitleView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), '常规')
  if (type === '头像和昵称') return <span className={`yb-list-item-title is-profile ${ctx.className}`}>
    <img alt="" className="yb-list-part-avatar" width={48} height={48}
      src={contentImageSrc(ctx.v('imageSrc'), '/figma-assets/list-avatar.png')} />
    <span className="yb-list-profile-copy">
      <span className="yb-list-profile-name">{contentOr(ctx.children, 'NICCCC')}
        {ctx.renderNamed('19766:25547', { state: str(ctx.v('badgeState'), 'on') })}
      </span>
      {boolish(ctx.v('showTeamName')) && <small>{str(ctx.v('teamName'), '团队名称')}</small>}
    </span>
  </span>
  return <span className={`yb-list-item-title ${ctx.className}`}>
    <span>{contentOr(ctx.children, '列表标题')}</span>
    {type === '带红点' && <i className="yb-list-part-dot" />}
    {type === '带标签' && <span className="yb-list-part-tag">{str(ctx.v('tagLabel'), '标签文本')}</span>}
  </span>
}
