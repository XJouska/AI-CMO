import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { boolish, contentImageSrc, contentImageSrcs, contentOr, str } from '../helpers'
import { Icon } from '../Icon'
import type { RenderCtx } from '../context'

const MD_VARIANTS = [
  'prompt',
  'Progress',
  'H1',
  'H2',
  'Others+H2',
  'H3',
  'Others+H3',
  'H4',
  'Others+H4',
  'Body',
  'OL',
  'UL',
  'Divider',
  'Table',
  'Code',
  'File',
  'Quote',
  'InlineLaTex',
  'WrappedInlineLaTex',
  'DisplayLaTex',
  'sugForm',
  'Toolbar',
  'followUp',
  'video',
  'IMG',
  'ImgWidget',
  'miniProgram',
  'AiEdu',
  'recording',
] as const

type MdVariant = (typeof MD_VARIANTS)[number]

const MD_PADS: Record<MdVariant, { top: number; bottom: number; left?: number }> = {
  prompt: { top: 0, bottom: 32 },
  Progress: { top: 0, bottom: 0 },
  H1: { top: 0, bottom: 16 },
  H2: { top: 10, bottom: 10 },
  'Others+H2': { top: 24, bottom: 10 },
  H3: { top: 10, bottom: 10 },
  'Others+H3': { top: 20, bottom: 10 },
  H4: { top: 10, bottom: 10 },
  'Others+H4': { top: 20, bottom: 10 },
  Body: { top: 10, bottom: 10 },
  OL: { top: 10, bottom: 12 },
  UL: { top: 10, bottom: 12 },
  Divider: { top: 24, bottom: 24 },
  Quote: { top: 12, bottom: 24, left: 2 },
  Table: { top: 12, bottom: 24 },
  Code: { top: 12, bottom: 24 },
  File: { top: 12, bottom: 24 },
  recording: { top: 12, bottom: 24 },
  AiEdu: { top: 12, bottom: 24 },
  miniProgram: { top: 12, bottom: 24 },
  ImgWidget: { top: 12, bottom: 24 },
  InlineLaTex: { top: 0, bottom: 0 },
  WrappedInlineLaTex: { top: 0, bottom: 0 },
  DisplayLaTex: { top: 0, bottom: 0 },
  sugForm: { top: 20, bottom: 0 },
  Toolbar: { top: 20, bottom: 0 },
  followUp: { top: 16, bottom: 0 },
  IMG: { top: 0, bottom: 0 },
  video: { top: 0, bottom: 0 },
}

const DEFAULT_OL = [
  { text: '一级有序 (17px / 155% / Regular)', level: 1 },
  { text: '二级有序', level: 2 },
  { text: '三级有序', level: 3 },
  { text: '一级有序 (17px / 155% / Regular)', level: 1 },
]

const DEFAULT_UL = [
  { text: '一级无序 (17px / 155% / Regular)', level: 1 },
  { text: '二级无序', level: 2 },
  { text: '二级无序', level: 3 },
  { text: '一级无序 (17px / 155% / Regular)', level: 1 },
]

const TABLE_ROWS = [
  ['大交通', '约 ¥4,000 - ¥5,000', '深圳/香港往返鹿儿岛机票 + 鹿儿岛往返屋久岛高速船票'],
  ['奢华住宿', '约 ¥8,000 - ¥9,000', '6晚住宿。屋久岛和鹿儿岛城山酒店各安排1-2晚自带顶级温泉、一泊二食的高端日式旅馆，其余时间住高档精品酒店。'],
  ['当地交通', '约 ¥2,500', '屋久岛环岛包车/租车（含向导）+ 鹿儿岛特色列车及市区通票'],
  ['总计', '约 ¥19,000 - ¥21,000', '刚好完美落在你的预算区间内。'],
]

const CODE_SAMPLE = `import time
import os
import random

def clear_screen():
    """清屏函数"""
    os.system('cls' if os.name == 'nt' else 'clear')

def print_balloon(color):
    """打印气球"""
    balloon = f'''
{color}🎈{color}🎈{color}🎈
{color}  \\\\ /  {color}  \\\\ /
{color}   |   {color}  /|\\\\
'''
    return balloon

def print_candy():
    """打印糖果"""
    candies = ['🍬', '🍭', '🍫', '🍩', '🍪', '🎂']
    return random.choice(candies)

def print_teddy():
    """打印小熊"""
    teddy = '''
(\\_/)
(•ㅅ•)づ
/ 　 づ
'''
    return teddy

def print_rainbow():
    """打印彩虹"""
    rainbow = '''
🌈🌈🌈🌈🌈🌈🌈🌈🌈🌈
🌈🌈🌈🌈🌈🌈🌈🌈🌈🌈
🌈🌈🌈🌈🌈🌈🌈🌈🌈🌈
'''
    return rainbow`

const QUOTE_DEFAULT = '数字化转型评价指标体系 (2026版) \n(联系人：张工；联系电话：0X-12345678；电子邮箱：digital@munci.gov.cn)'

const FOLLOWUP_LABELS: Record<string, string[]> = {
  single: ['需要'],
  multi2: ['参考部署模板', 'QPS目标计算'],
  multi3: ['云南', '日本', '川西'],
  longText: ['如何从技术背景转型 AI 产品经理？', '转行产品经理需要哪些技能和要求？'],
}

const AGENT_TITLES: Record<string, string> = {
  澄清: '正在确认需求',
  任务: '正在执行任务',
  skill: '正在调用技能',
  读取: '正在读取文件',
  search: '正在搜索',
  bash: '正在执行命令',
  write: '正在写作',
  edit: '正在编辑',
  fetch: '正在抓取页面',
  类型13: '正在处理',
  ocr: '正在 OCR',
  搜图: '正在搜图',
  视频: '正在处理视频',
}

const MD_IMG_SINGLE: Record<string, string> = {
  '3:4': '/images/md-img-1-1.png',
  '4:3': '/images/md-img-1-1.png',
  '1:1': '/images/md-img-1-1.png',
}

const MD_IMG_MULTI = [
  { src: '/images/md-img-multi-1.png', width: 102, caption: '孔雀鱼美图' },
  { src: '/images/md-img-multi-2.png', width: 136, caption: '迷你鹦鹉鱼' },
  { src: '/images/md-img-multi-3.png', width: 182, caption: '中国斗鱼' },
]

const MD_IMG_GRID = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `/images/md-img-grid-${n}.png`)

const MD_IMG_TYPE6 = [
  { src: '/images/md-img-type6-1.png', height: 101 },
  { src: '/images/md-img-type6-2.png', height: 242 },
  { src: '/images/md-img-type6-3.png', height: 180 },
]

const MD_ATTACH_THUMBS = [1, 2, 3, 4, 5].map((n) => `/images/md-attach-${n}.png`)

const RECORDING_WAVE = [
  0, 2, 2, 2, 6, 8, 10, 6, 1.75, 4, 4, 6, 12, 18, 16, 24, 20, 16, 18, 8, 6, 2, 2, 2, 4, 6, 10, 6, 12, 16, 10, 6, 2, 4, 2,
  2, 4, 6, 10, 12, 12, 18, 24, 18, 12, 8, 10, 6, 6, 4, 2, 2, 2, 2, 2, 6, 8, 8, 12, 16, 18, 12, 14, 10, 6, 5, 8, 12, 8, 4,
  2, 2, 2, 2, 2, 6, 8, 8, 12, 16, 18, 12, 14, 10, 6, 5, 8, 12, 8, 4, 2, 2,
]

const IMGWIDGET_PHOTO = {
  src: '/images/md-imgwidget-raw.png',
}

const MINIPROGRAM_PHOTO = {
  src: '/images/md-miniprogram-raw.png',
}

const MD_VIDEO_TITLE = '攀爬哈巴雪山第一视角最真实体验'

const AGENT_ICON: Record<string, string> = {
  完成: 'Icon/done',
  澄清: 'Icon/done',
  skill: 'Icon/Setting',
  'edit/write': 'Icon/A',
  write: 'Icon/A',
  edit: 'Icon/A',
  读取: 'Icon/link',
  search: 'Icon/Search',
  搜索: 'Icon/Search',
  fetch: 'Icon/link',
  文案: 'Icon/A',
  bash: 'Icon/Setting',
  图片: 'Icon/Camera',
  搜图: 'Icon/Camera',
  视频: 'Icon/Camera',
  file: 'Icon/link',
  定时任务: 'Icon/Clock',
  任务: 'Icon/Clock',
  OCR: 'Icon/Camera',
  ocr: 'Icon/Camera',
  生图: 'Icon/Camera',
  深度研究: 'Icon/Search',
  深度思考: 'Icon/A',
  think: 'Icon/A',
  类型13: 'Icon/A',
}

function clampMdVariant(value: string): MdVariant {
  return (MD_VARIANTS as readonly string[]).includes(value) ? (value as MdVariant) : 'prompt'
}

function headingCopy(variant: MdVariant) {
  if (variant === 'H1') return 'H1 (21px / 140% / Semibold)'
  if (variant === 'H2' || variant === 'Others+H2') return 'H2 (19px / 140% / Semibold)'
  if (variant === 'H3' || variant === 'Others+H3') return 'H3 (17px / 145% / Semibold)'
  return 'H4 (17px / 145% / Semibold)'
}

function stringItems(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const items = value.filter((item) => typeof item === 'string') as string[]
  return items.length ? items : null
}

function withListIndexes<T extends { level: number }>(rows: T[]) {
  const counters = [0, 0, 0, 0]
  return rows.map((row) => {
    const level = Math.min(3, Math.max(1, row.level))
    counters[level] += 1
    for (let i = level + 1; i <= 3; i += 1) counters[i] = 0
    return { ...row, index: counters[level] - 1 }
  })
}

function MdPad({ height }: { height: number }) {
  if (!height) return null
  return <div aria-hidden className="yb-md-pad" style={{ height }} />
}

function MdMask({ src, size, className }: { src: string; size: number; className?: string }) {
  const box: CSSProperties = {
    height: size,
    width: size,
    WebkitMaskImage: `url("${src}")`,
    maskImage: `url("${src}")`,
  }
  return <span aria-hidden className={`yb-icon ${className ?? ''}`.trim()} style={box} />
}

function canonicalPhotoSrc(src: string) {
  const sources: Record<string, string> = {
    '/img-viewer/photo.png': '/images/md-img-type6-1.png',
    '/img-viewer/photo-create.png': '/images/md-img-type6-2.png',
    '/img-viewer/video-cover.png': '/images/md-video-h.png',
    '/images/md-video-v.png': '/images/md-video-m1.png',
  }
  return sources[src] ?? src
}

function photoSrcSet(src: string, density?: 2 | 3) {
  if (src.startsWith('/img-viewer/')) {
    // The source exports contain identical bytes at all three densities.
    const canonical = canonicalPhotoSrc(src)
    return `${canonical} 2x, ${canonical} 3x`
  }
  return density ? `${canonicalPhotoSrc(src)} ${density}x` : undefined
}

function MdPhoto({
  src,
  className,
  density,
}: {
  src: string
  className?: string
  density?: 2 | 3
}) {
  return <img alt="" className={className} src={canonicalPhotoSrc(src)} srcSet={photoSrcSet(src, density)} />
}

function MdVideoPlay() {
  return (
    <span aria-hidden className="yb-md-video-play">
      <svg fill="none" viewBox="0 0 24 24">
        <path
          d="M16.1738 11.1583C16.7872 11.5518 16.7872 12.4482 16.1738 12.8417L10.9258 16.2083C10.2602 16.6352 9.38584 16.1573 9.38584 15.3666V8.63342C9.38584 7.84269 10.2602 7.36477 10.9258 7.79173L16.1738 11.1583Z"
          fill="currentColor"
        />
      </svg>
    </span>
  )
}

function flattenFlowKids(parent: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const child of parent.children) {
    if (!(child instanceof HTMLElement)) continue
    if (getComputedStyle(child).display === 'contents') out.push(...flattenFlowKids(child))
    else out.push(child)
  }
  return out
}

function collapseAdjacentMdPads(node: HTMLElement) {
  const host = node.closest('.agent-conversation-content') ?? node.parentElement
  if (!(host instanceof HTMLElement)) return
  const kids = flattenFlowKids(host)
  let prevMd: HTMLElement | null = null
  for (const kid of kids) {
    if (!kid.hasAttribute('data-md-root')) {
      if (prevMd) prevMd.style.paddingBottom = `${prevMd.dataset.padBottom ?? 0}px`
      prevMd = null
      continue
    }
    const top = Number(kid.dataset.padTop || 0)
    const bottom = Number(kid.dataset.padBottom || 0)
    const special = kid.dataset.mdSpecial === 'true'
    kid.style.paddingBottom = `${bottom}px`
    if (!prevMd) {
      kid.style.paddingTop = `${top}px`
      prevMd = kid
      continue
    }
    const prevBottom = Number(prevMd.dataset.padBottom || 0)
    const prevSpecial = prevMd.dataset.mdSpecial === 'true'
    let space = Math.max(prevBottom, top)
    if (special) space = top
    else if (prevSpecial) space = prevBottom
    prevMd.style.paddingBottom = '0px'
    kid.style.paddingTop = `${space}px`
    prevMd = kid
  }
}

function MdRoot({
  variant,
  className,
  children,
  pad,
}: {
  variant: MdVariant
  className: string
  children: ReactNode
  pad?: { top: number; bottom: number; left?: number }
}) {
  const spacing = pad ?? MD_PADS[variant]
  const special = variant === 'Divider' || variant === 'Toolbar'
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (ref.current) collapseAdjacentMdPads(ref.current)
  }, [spacing.top, spacing.bottom, special])
  return (
    <div
      className={`yb-md ${className}`.trim()}
      data-md-root=""
      data-md-special={special ? 'true' : undefined}
      data-pad-bottom={spacing.bottom}
      data-pad-top={spacing.top}
      data-variant={variant}
      ref={ref}
      style={spacing.left ? { paddingLeft: spacing.left } : undefined}
    >
      {children}
    </div>
  )
}

const IMG_VIEWER_TYPES = new Set(['searchImg', 'createImg'])
const IMG_NAV_TYPES = new Set(['searchImg', 'sendImg', 'createImg'])
const IMG_BTN_NUMS = new Set(['1', '2', '3'])

function clampImgViewerType(value: string) {
  return IMG_VIEWER_TYPES.has(value) ? value : 'searchImg'
}

function clampImgNavType(value: string) {
  return IMG_NAV_TYPES.has(value) ? value : 'searchImg'
}

function clampImgBtnNum(value: string) {
  return IMG_BTN_NUMS.has(value) ? value : '1'
}

function ViewerIconBtn({
  action,
  label,
  name,
  onAction,
}: {
  action: string
  label: string
  name: string
  onAction?: (action: string) => void
}) {
  return (
    <button aria-label={label} className="yb-viewer-icon-hit" onClick={() => onAction?.(action)} type="button">
      <Icon decorative name={name} size={24} />
    </button>
  )
}

export function ImgViewerView({ ctx }: { ctx: RenderCtx }) {
  const type = clampImgViewerType(str(ctx.v('type'), 'searchImg'))
  const navType = type === 'createImg' ? 'sendImg' : 'searchImg'
  const photo = contentImageSrc(ctx.v('imageSrc'), type === 'createImg' ? '/img-viewer/photo-create.png' : '/img-viewer/photo.png')
  return (
    <div className={`yb-viewer ${ctx.className}`.trim()} data-theme="dark" data-type={type}>
      <MdPhoto className="yb-viewer-photo" src={photo} />
      {ctx.renderNamed('.imgViewer/navBar', { type: navType, indicator: true })}
      {type === 'searchImg'
        ? ctx.renderNamed('.imgViewer/searchImgInfo', { ecommerce: true, comment: true })
        : ctx.renderNamed('.imgViewer/footerAction', { __scene: 'createImg' })}
      <span aria-hidden className="yb-viewer-home" />
    </div>
  )
}

const VIDEO_TYPES = ['sendVideo', 'createVideo'] as const
const VIDEO_STATUSES = ['pause', 'play', 'drag'] as const

type VideoType = (typeof VIDEO_TYPES)[number]
type VideoStatus = (typeof VIDEO_STATUSES)[number]

function clampVideoType(value: string): VideoType {
  return (VIDEO_TYPES as readonly string[]).includes(value) ? (value as VideoType) : 'sendVideo'
}

function clampVideoStatus(value: string): VideoStatus {
  return (VIDEO_STATUSES as readonly string[]).includes(value) ? (value as VideoStatus) : 'pause'
}

function VideoGlass({
  children,
  cluster,
}: {
  children: ReactNode
  cluster?: boolean
}) {
  return <div className={`yb-video-glass${cluster ? ' is-cluster' : ''}`}>{children}</div>
}

function VideoHit({
  label,
  onClick,
  children,
}: {
  label: string
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button aria-label={label} className="yb-video-hit" onClick={onClick} type="button">
      {children}
    </button>
  )
}

function VideoPlayMark() {
  return (
    <svg aria-hidden className="yb-video-play-mark" fill="none" viewBox="0 0 40 40">
      <path
        d="M34.5 17.4019C36.5 18.5566 36.5 21.4434 34.5 22.5981L14.25 34.2894C12.25 35.4441 9.75 34.0007 9.75 31.6913L9.75 8.30866C9.75 5.99925 12.25 4.55588 14.25 5.71058L34.5 17.4019Z"
        fill="currentColor"
      />
    </svg>
  )
}

function VideoPauseMark() {
  return (
    <svg aria-hidden className="yb-video-pause-mark" fill="none" viewBox="0 0 40 40">
      <rect fill="currentColor" height="27" rx="2" width="8" x="10" y="7" />
      <rect fill="currentColor" height="27" rx="2" width="8" x="22" y="7" />
    </svg>
  )
}

function VideoScrubTime({ drag, remainingDim }: { drag?: boolean; remainingDim?: boolean }) {
  return (
    <div className={`yb-video-time${drag ? ' is-drag' : ''}`}>
      <span>00:20</span>
      <em>/</em>
      <span className={remainingDim ? 'is-remain' : undefined}>00:45</span>
    </div>
  )
}

function VideoScrubBar({
  drag,
  onDragStart,
}: {
  drag?: boolean
  onDragStart?: () => void
}) {
  return (
    <div
      className={`yb-video-bar${drag ? ' is-drag' : ''}`}
      onPointerDown={(event) => {
        event.preventDefault()
        onDragStart?.()
      }}
    >
      <i aria-hidden className="yb-video-bar-total" />
      <i aria-hidden className="yb-video-bar-done" />
      <i aria-hidden className="yb-video-knob" />
    </div>
  )
}

export function VideoViewerView({ ctx }: { ctx: RenderCtx }) {
  const type = clampVideoType(str(ctx.v('type'), 'sendVideo'))
  return (
    <div className={`yb-viewer is-video ${ctx.className}`.trim()} data-theme="dark" data-type={type}>
      <MdPhoto className="yb-viewer-photo" src={contentImageSrc(ctx.v('imageSrc'), '/img-viewer/video-cover.png')} />
      {ctx.renderNamed('.videoViewer/navBar', { type, indicator: true })}
      {ctx.renderNamed('.videoViewer/footerAction', { buttonGroup: type === 'createVideo' })}
      <div aria-hidden className="yb-video-home">
        <i />
      </div>
    </div>
  )
}

export function VideoViewerNavBarView({ ctx }: { ctx: RenderCtx }) {
  const type = clampVideoType(str(ctx.v('type'), 'sendVideo'))
  const indicator = ctx.v('indicator') === undefined ? true : boolish(ctx.v('indicator'))
  const send = type === 'sendVideo'
  return (
    <div className={`yb-video-nav ${ctx.className}`.trim()} data-type={type}>
      {ctx.renderNamed('.StatusBar', { type: 'iPhone' })}
      <div className="yb-video-title">
        <VideoGlass>
          <VideoHit label="关闭" onClick={() => ctx.onAction?.('close')}>
            <Icon decorative name="Icon/close-sm" size={24} />
          </VideoHit>
        </VideoGlass>
        {indicator ? <span className="yb-video-count">1/4</span> : null}
        {send ? (
          <VideoGlass cluster>
            <VideoHit label="下载" onClick={() => ctx.onAction?.('download')}>
              <Icon decorative name="Icon/Download" size={24} />
            </VideoHit>
            <VideoHit label="分享" onClick={() => ctx.onAction?.('share')}>
              <Icon decorative name="Icon/share" size={24} />
            </VideoHit>
          </VideoGlass>
        ) : (
          <VideoGlass>
            <VideoHit label="分享" onClick={() => ctx.onAction?.('share')}>
              <Icon decorative name="Icon/share" size={24} />
            </VideoHit>
          </VideoGlass>
        )}
      </div>
    </div>
  )
}

export function VideoViewerFooterView({ ctx }: { ctx: RenderCtx }) {
  const buttonGroup = ctx.v('buttonGroup') === undefined ? true : boolish(ctx.v('buttonGroup'))
  return (
    <div className={`yb-video-footer ${ctx.className}`.trim()} data-actions={buttonGroup ? 'true' : 'false'}>
      {ctx.renderNamed('.videoViewer/footerAction/indicator')}
      {buttonGroup ? (
        <div className="yb-video-actions">
          {ctx.renderNamed(
            'Button 按钮',
            {
              type: 'Secondary',
              size: 'M',
              state: 'Default',
              leftIcon: true,
              shadow: false,
              leftSlot: <Icon decorative name="Icon/Download" size={24} />,
            },
            '保存视频',
          )}
          {ctx.renderNamed(
            'Button 按钮',
            {
              type: 'Secondary',
              size: 'M',
              state: 'Default',
              leftIcon: true,
              shadow: false,
              leftSlot: <Icon decorative name="Icon/live" size={24} />,
            },
            '保存实况',
          )}
        </div>
      ) : null}
    </div>
  )
}

export function VideoViewerIndicatorView({ ctx }: { ctx: RenderCtx }) {
  const fromProp = clampVideoStatus(str(ctx.v('status'), 'pause'))
  const [local, setLocal] = useState<VideoStatus>(fromProp)
  const beforeDragRef = useRef<VideoStatus>('pause')
  const statusRef = useRef<VideoStatus>(fromProp)

  useEffect(() => {
    setLocal(fromProp)
  }, [fromProp])

  const status = local
  statusRef.current = status

  function commit(next: VideoStatus) {
    setLocal(next)
    ctx.onAction?.(`status:${next}`)
  }

  const playing = status === 'play'
  const drag = status === 'drag'

  return (
    <div className={`yb-video-scrub ${ctx.className}`.trim()} data-status={status}>
      {drag ? <VideoScrubTime drag remainingDim /> : null}
      <div className="yb-video-scrub-row">
        <button
          aria-label={playing ? '暂停' : '播放'}
          className="yb-video-play"
          onClick={() => commit(playing ? 'pause' : 'play')}
          type="button"
        >
          {playing ? <VideoPauseMark /> : <VideoPlayMark />}
        </button>
        <div className="yb-video-scrub-track">
          {drag ? null : <VideoScrubTime />}
          <VideoScrubBar
            drag={drag}
            onDragStart={() => {
              const current = statusRef.current === 'drag' ? beforeDragRef.current : statusRef.current
              beforeDragRef.current = current === 'play' ? 'play' : 'pause'
              commit('drag')
              const end = () => {
                window.removeEventListener('pointerup', end)
                window.removeEventListener('pointercancel', end)
                if (statusRef.current === 'drag') {
                  commit(beforeDragRef.current === 'play' ? 'play' : 'pause')
                }
              }
              window.addEventListener('pointerup', end)
              window.addEventListener('pointercancel', end)
            }}
          />
        </div>
      </div>
    </div>
  )
}

export function ImgViewerNavBarView({ ctx }: { ctx: RenderCtx }) {
  const type = clampImgNavType(str(ctx.v('type'), 'searchImg'))
  const indicator = ctx.v('indicator') === undefined ? true : boolish(ctx.v('indicator'))
  const search = type === 'searchImg'
  const create = type === 'createImg'
  return (
    <header className={`yb-viewer-nav ${ctx.className}`.trim()} data-type={type}>
      {ctx.renderNamed('.StatusBar', { type: 'iPhone' })}
      <div className="yb-viewer-titlebar">
        <div className="yb-viewer-nav-left">
          <button
            aria-label="关闭"
            className="yb-viewer-icon-btn"
            onClick={() => ctx.onAction?.('close')}
            type="button"
          >
            <Icon decorative name="Icon/close-sm" size={24} />
          </button>
          {indicator && search ? <span className="yb-viewer-indicator">1/17</span> : null}
        </div>
        {indicator && !search ? <span className="yb-viewer-indicator is-center">1/17</span> : null}
        {create ? (
          <button
            aria-label="分享"
            className="yb-viewer-icon-btn"
            onClick={() => ctx.onAction?.('share')}
            type="button"
          >
            <Icon decorative name="Icon/share" size={24} />
          </button>
        ) : (
          <div className="yb-viewer-icon-cluster">
            {search ? <ViewerIconBtn action="source" label="来源" name="Icon/link" onAction={ctx.onAction} /> : null}
            <ViewerIconBtn action="download" label="下载" name="Icon/Download" onAction={ctx.onAction} />
            <ViewerIconBtn action="share" label="分享" name="Icon/share" onAction={ctx.onAction} />
          </div>
        )}
      </div>
    </header>
  )
}

export function ImgViewerSearchInfoView({ ctx }: { ctx: RenderCtx }) {
  const ecommerce = ctx.v('ecommerce') === undefined ? true : boolish(ctx.v('ecommerce'))
  const comment = ctx.v('comment') === undefined ? true : boolish(ctx.v('comment'))
  if (!ecommerce && !comment) return null
  return (
    <div className={`yb-viewer-dock ${ctx.className}`.trim()}>
      <div className="yb-viewer-info">
        {ecommerce ? (
          <button className="yb-viewer-shop" onClick={() => ctx.onAction?.('buy')} type="button">
            <span className="yb-viewer-shop-name">
              <Icon decorative name="Icon/Shopping" nodeId="5224:9557" size={16} />
              商品名称
            </span>
            <i aria-hidden className="yb-viewer-shop-div" />
            <span className="yb-viewer-shop-cta">
              去购买
              <Icon decorative name="Icon/chevron-right" size={16} />
            </span>
          </button>
        ) : null}
        {comment ? (
          <p className="yb-viewer-comment">由大模型识别出来的图片解释文案，最多展示两行，左对齐。</p>
        ) : null}
      </div>
    </div>
  )
}

export function ImgViewerButtonGroupView({ ctx }: { ctx: RenderCtx }) {
  const num = clampImgBtnNum(str(ctx.v('num'), '1'))
  const scene = str(ctx.v('__scene'), '')
  const create = scene === 'createImg'
  const secondary = (label: string, icon?: { name: string }) =>
    ctx.renderNamed(
      'Button 按钮',
      {
        type: 'Secondary',
        size: 'M',
        state: 'Default',
        leftIcon: true,
        leftSlot: icon ? <Icon decorative name={icon.name} size={20} /> : undefined,
      },
      label,
    )
  return (
    <div className={`yb-viewer-btns ${ctx.className}`.trim()} data-num={num}>
      {num === '1'
        ? create
          ? secondary('智能P图', { name: 'Icon/CreatePic' })
          : secondary('次要按钮')
        : null}
      {num === '2' ? (
        <>
          {create
            ? secondary('智能P图', { name: 'Icon/CreatePic' })
            : secondary('次要按钮')}
          {create
            ? secondary('变视频', { name: 'Icon/VideoAI' })
            : secondary('次要按钮')}
        </>
      ) : null}
      {num === '3' ? (
        <>
          {secondary('次要按钮')}
          {secondary('次要按钮')}
          {ctx.renderNamed('Button 按钮', { type: 'Primary', size: 'M', state: 'Default', leftIcon: true }, '主要按钮')}
        </>
      ) : null}
    </div>
  )
}

export function ImgViewerFooterView({ ctx }: { ctx: RenderCtx }) {
  return (
    <div className={`yb-viewer-dock ${ctx.className}`.trim()}>
      {ctx.renderNamed('.imgViewer/buttonGroup', {
        num: str(ctx.v('num'), '2'),
        __scene: str(ctx.v('__scene'), ''),
      })}
    </div>
  )
}

function clampIPadMode(value: string) {
  return value === '横屏' ? '横屏' : '竖屏'
}

function IPadStatusBar() {
  return (
    <div className="yb-ipad-status">
      <div className="yb-ipad-status-left">
        <span>9:41</span>
        <span>Tue Apr 1</span>
      </div>
      <div className="yb-ipad-status-right">
        <img alt="" className="yb-ipad-cellular" height={10} src="/ipad/cellular.svg" width={16.5} />
        <img alt="" className="yb-ipad-wifi" height={10} src="/ipad/wifi.svg" width={14} />
        <span>100%</span>
        <img alt="" className="yb-ipad-battery" height={12} src="/ipad/battery.svg" width={26.5} />
      </div>
    </div>
  )
}

export function IPadTemplateView({ ctx }: { ctx: RenderCtx }) {
  const mode = clampIPadMode(str(ctx.v('displayMode'), '竖屏'))
  return (
    <div className={`yb-ipad ${ctx.className}`.trim()} data-mode={mode}>
      <img alt="" className="yb-ipad-wallpaper" src="/ipad/wallpaper.png" />
      <IPadStatusBar />
    </div>
  )
}

export function WindowResizeView({ ctx }: { ctx: RenderCtx }) {
  return <span aria-hidden className={`yb-window-resize ${ctx.className}`.trim()} />
}

function PromptView({ ctx, variant }: { ctx: RenderCtx; variant: MdVariant }) {
  return (
    <MdRoot className={ctx.className} variant={variant}>
      <div className="yb-md-prompt-stack">
        {boolish(ctx.v('promptAttachment')) ? ctx.renderNamed('.MD/sent', { type: 'image' }) : null}
        <div className="yb-md-bubble-wrap">
          <div className="yb-md-bubble">
            <p>{contentOr(ctx.children, contentOr(ctx.renderSlot(ctx.v('body')), '签证准备'))}</p>
          </div>
          <MdMask className="yb-md-bubble-arrow" size={29} src="/icons/md-bubble-arrow.svg" />
        </div>
      </div>
    </MdRoot>
  )
}

function HeadingView({ ctx, variant }: { ctx: RenderCtx; variant: MdVariant }) {
  const Tag = variant.includes('H1') ? 'h1' : variant.includes('H2') ? 'h2' : variant.includes('H3') ? 'h3' : 'h4'
  return (
    <MdRoot className={ctx.className} variant={variant}>
      <Tag className={`yb-md-heading yb-md-${Tag}`}>{contentOr(ctx.children, headingCopy(variant))}</Tag>
    </MdRoot>
  )
}

function BodyView({ ctx, variant }: { ctx: RenderCtx; variant: MdVariant }) {
  const slot = ctx.renderSlot(ctx.v('body'))
  return (
    <MdRoot className={ctx.className} variant={variant}>
      <div className="yb-md-body">
        {slot ?? ctx.children ?? (
          <>
            <p>Body (17px / 155% / Regular)</p>
            <p>Body (17px / 155% / Regular)</p>
          </>
        )}
      </div>
    </MdRoot>
  )
}

function ListBlock({ ctx, ordered }: { ctx: RenderCtx; ordered: boolean }) {
  const variant: MdVariant = ordered ? 'OL' : 'UL'
  const slot = ctx.renderSlot(ctx.v(ordered ? 'olSlot' : 'ulSlot'))
  const supplied = stringItems(ctx.values.items)
  const raw = supplied
    ? supplied.map((text) => ({ text, level: 1 }))
    : ordered
      ? DEFAULT_OL
      : DEFAULT_UL
  const rows = withListIndexes(raw)
  return (
    <MdRoot className={ctx.className} variant={variant}>
      {slot ?? (
        <div className="yb-md-list">
          {rows.map((row) => (
            <div className="yb-md-list-row" data-level={row.level} key={`${row.level}-${row.index}-${row.text}`}>
              {ordered
                ? ctx.renderNamed('.MD/ol', { level: String(row.level), index: row.index })
                : ctx.renderNamed('.MD/ul', { type: 'solid', level: String(row.level) })}
              <p>{row.text}</p>
            </div>
          ))}
        </div>
      )}
    </MdRoot>
  )
}

function QuoteView({ ctx }: { ctx: RenderCtx }) {
  return (
    <MdRoot className={ctx.className} variant="Quote">
      <div className="yb-md-quote">
        <i aria-hidden className="yb-md-quote-bar" />
        <div className="yb-md-quote-text">
          {ctx.renderSlot(ctx.v('quoteText')) ?? ctx.children ?? (
            <>
              <p>附件</p>
              <p>{QUOTE_DEFAULT}</p>
            </>
          )}
        </div>
      </div>
    </MdRoot>
  )
}

function TableView({ ctx }: { ctx: RenderCtx }) {
  return (
    <MdRoot className={ctx.className} variant="Table">
      <div className="yb-md-table">
        <div className="yb-md-table-toolbar">
          <span>表格</span>
          <div className="yb-md-table-ops">
            <button aria-label="复制" onClick={() => ctx.onAction?.('copy')} type="button">
              <MdMask size={18} src="/icons/md-copy.svg" />
            </button>
            <button aria-label="下载" onClick={() => ctx.onAction?.('download')} type="button">
              <Icon decorative name="Icon/Download" size={18} />
            </button>
            <button aria-label="展开" onClick={() => ctx.onAction?.('expand')} type="button">
              <Icon decorative name="Icon/Expand" size={18} />
            </button>
          </div>
        </div>
        <div className="yb-md-table-scroll">
          <table>
            <thead>
              <tr>
                <th>项目</th>
                <th>预计花费 (人民币)</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {ctx.renderSlot(ctx.v('tableContent')) ??
                TABLE_ROWS.map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell) => (
                      <td key={cell}>{cell}</td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </MdRoot>
  )
}

function CodeView({ ctx }: { ctx: RenderCtx }) {
  const code = contentOr(ctx.children, contentOr(ctx.renderSlot(ctx.v('body')), CODE_SAMPLE))
  return (
    <MdRoot className={ctx.className} variant="Code">
      <div className="yb-md-code">
        <div className="yb-md-code-toolbar">
          <span>Python</span>
          <div className="yb-md-table-ops">
            <button aria-label="复制" onClick={() => ctx.onAction?.('copy')} type="button">
              <MdMask size={18} src="/icons/md-copy.svg" />
            </button>
            <button aria-label="下载" onClick={() => ctx.onAction?.('download')} type="button">
              <Icon decorative name="Icon/Download" size={18} />
            </button>
            <button aria-label="展开" onClick={() => ctx.onAction?.('expand')} type="button">
              <Icon decorative name="Icon/Expand" size={18} />
            </button>
          </div>
        </div>
        <pre>{code}</pre>
        <button className="yb-md-code-more" onClick={() => ctx.onAction?.('expand')} type="button">
          查看全部
        </button>
      </div>
    </MdRoot>
  )
}

function FileCardView({ ctx }: { ctx: RenderCtx }) {
  return (
    <MdRoot className={ctx.className} variant="File">
      <button className="yb-md-file" onClick={() => ctx.onAction?.('file')} type="button">
        <div className="yb-md-file-info">
          {ctx.renderNamed('2850:10220', { file: 'PDF' })}
          <strong>{contentOr(ctx.children, '小红书慢人节招商方案.pptx')}</strong>
          <Icon decorative name="Icon/chevron-right" size={14} />
        </div>
        <MdPhoto className="yb-md-file-preview" density={3} src="/images/md-file-preview.png" />
      </button>
    </MdRoot>
  )
}

function MdWidgetPhoto({ src }: { src: string }) {
  return (
    <span className="yb-md-widget-photo">
      <MdPhoto density={3} src={src} />
    </span>
  )
}

function RecordingView({ ctx }: { ctx: RenderCtx }) {
  return (
    <MdRoot className={ctx.className} variant="recording">
      <div className="yb-md-file yb-md-recording">
        <button className="yb-md-file-info" onClick={() => ctx.onAction?.('recording')} type="button">
          <MdMask size={20} src="/icons/md-recording-mic.svg" />
          <strong>{contentOr(ctx.children, 'AI录音笔：金融研讨会纪要')}</strong>
          <Icon decorative name="Icon/chevron-right" size={14} />
        </button>
        <div className="yb-md-recording-inner">
          <div className="yb-md-recording-panel">
            <div className="yb-md-recording-bar">
              <div aria-label="32:37" className="yb-md-recording-time">
                <span>32 37</span>
                <i className="yb-md-recording-colon" />
              </div>
              <div className="yb-md-recording-wave">
                {RECORDING_WAVE.map((height, index) => (
                  <span className="yb-md-recording-peak" key={index} style={{ height }} />
                ))}
              </div>
              <button
                aria-label="播放"
                className="yb-md-recording-play"
                onClick={() => ctx.onAction?.('play')}
                type="button"
              >
                <span className="yb-md-recording-disc">
                  <MdMask className="yb-md-recording-play-icon" size={18} src="/icons/md-recording-play.svg" />
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </MdRoot>
  )
}

function AiEduView({ ctx }: { ctx: RenderCtx }) {
  return (
    <MdRoot className={ctx.className} variant="AiEdu">
      <div className="yb-md-aiedu">
        <div className="yb-md-aiedu-copy">
          <div className="yb-md-aiedu-title">
            <span>AI精讲本题</span>
            <em>免费</em>
          </div>
          <p>一对一实时互动，讲透本题</p>
        </div>
        <button className="yb-md-aiedu-cta" onClick={() => ctx.onAction?.('aiedu')} type="button">
          进入讲解
        </button>
      </div>
    </MdRoot>
  )
}

function MiniProgramView({ ctx }: { ctx: RenderCtx }) {
  return (
    <MdRoot className={ctx.className} variant="miniProgram">
      <button className="yb-md-widget yb-md-miniprogram" onClick={() => ctx.onAction?.('miniprogram')} type="button">
        <span className="yb-md-miniprogram-main">
          <MdWidgetPhoto src={MINIPROGRAM_PHOTO.src} />
          <span className="yb-md-widget-title">{contentOr(ctx.children, 'DJI 大疆创新店')}</span>
        </span>
        <MdMask className="yb-md-miniprogram-mark" size={8} src="/icons/md-miniprogram-mark.svg" />
      </button>
    </MdRoot>
  )
}

function ImgWidgetView({ ctx }: { ctx: RenderCtx }) {
  return (
    <MdRoot className={ctx.className} variant="ImgWidget">
      <button className="yb-md-widget yb-md-imgwidget" onClick={() => ctx.onAction?.('imgwidget')} type="button">
        <span className="yb-md-imgwidget-row">
          <span className="yb-md-imgwidget-place">
            <MdWidgetPhoto src={IMGWIDGET_PHOTO.src} />
            <span className="yb-md-widget-title">{contentOr(ctx.children, '大梅沙海滨公园')}</span>
          </span>
          <i className="yb-md-imgwidget-rule" />
          <span className="yb-md-imgwidget-source">
            <span>携程</span>
            <MdMask className="yb-md-imgwidget-fold" size={11} src="/icons/md-imgwidget-fold.svg" />
          </span>
        </span>
      </button>
    </MdRoot>
  )
}

function LatexView({ ctx, variant }: { ctx: RenderCtx; variant: MdVariant }) {
  const formula = ctx.renderSlot(ctx.v('latex')) ?? ctx.children
  if (variant === 'DisplayLaTex') {
    return (
      <MdRoot className={ctx.className} variant={variant}>
        <p className="yb-md-body-line">组合方差 (风险) 定义为：</p>
        <div className="yb-md-latex">{formula ?? 'σₚ² = wᵀ Σ w'}</div>
        <p className="yb-md-body-line">对于两资产组合，展开得到：</p>
        <div className="yb-md-latex">σₚ² = wᵢ² σᵢ² + wⱼ² σⱼ² + 2 wᵢ wⱼ Cov(Rᵢ, Rⱼ)</div>
      </MdRoot>
    )
  }
  return (
    <MdRoot className={ctx.className} variant={variant}>
      <div className="yb-md-body">
        <p>
          {variant === 'WrappedInlineLaTex' ? '乘以除式：' : '现在余式是：'}
          <span className="yb-md-latex-inline">{formula ?? 'x² + y²'}</span>
        </p>
      </div>
    </MdRoot>
  )
}

function FollowUpLinksView({ ctx }: { ctx: RenderCtx }) {
  const items = stringItems(ctx.values.items) ?? ['加入错题本', '再拍一题']
  return (
    <MdRoot className={ctx.className} variant="followUp">
      <div className="yb-md-follow-links">
        {items.map((item) => (
          <button
            className="yb-md-follow-link"
            key={item}
            onClick={() => ctx.onAction?.(`follow-up:${item}`)}
            type="button"
          >
            <MdMask className="yb-md-follow-link-mark" size={24} src="/icons/md-recommend.svg" />
            <span className="yb-md-follow-link-text">
              <span className="yb-md-follow-link-label">{item}</span>
              <Icon decorative name="Icon/chevron-right" size={14} />
            </span>
          </button>
        ))}
      </div>
    </MdRoot>
  )
}

function SugFormView({ ctx }: { ctx: RenderCtx }) {
  return (
    <MdRoot className={ctx.className} variant="sugForm">
      <div className="yb-md-sug">
        <p>这三个方向，哪个画面最触动你？选定后我们可以针对性地看机票和具体的酒店推荐！</p>
        {ctx.renderNamed('.MD/followupButtons', { property1: 'multi3', actionPrefix: 'sug' })}
      </div>
    </MdRoot>
  )
}

export function MarkdownView({ ctx }: { ctx: RenderCtx }) {
  const variant = clampMdVariant(str(ctx.v('variant'), 'prompt'))
  if (variant === 'prompt') return <PromptView ctx={ctx} variant={variant} />
  if (variant === 'Progress') {
    return (
      <MdRoot className={ctx.className} pad={{ top: 0, bottom: 0 }} variant={variant}>
        {ctx.renderNamed('.MD/progress', { status: str(ctx.v('status'), 'done'), body: ctx.v('body') }, ctx.children)}
      </MdRoot>
    )
  }
  if (variant.startsWith('H') || variant.startsWith('Others+')) return <HeadingView ctx={ctx} variant={variant} />
  if (variant === 'Body') return <BodyView ctx={ctx} variant={variant} />
  if (variant === 'OL') return <ListBlock ctx={ctx} ordered />
  if (variant === 'UL') return <ListBlock ctx={ctx} ordered={false} />
  if (variant === 'Divider') {
    return (
      <MdRoot className={ctx.className} variant={variant}>
        <i aria-hidden className="yb-md-rule" />
      </MdRoot>
    )
  }
  if (variant === 'Quote') return <QuoteView ctx={ctx} />
  if (variant === 'Table') return <TableView ctx={ctx} />
  if (variant === 'Code') return <CodeView ctx={ctx} />
  if (variant === 'File') return <FileCardView ctx={ctx} />
  if (variant === 'recording') return <RecordingView ctx={ctx} />
  if (variant === 'AiEdu') return <AiEduView ctx={ctx} />
  if (variant === 'miniProgram') return <MiniProgramView ctx={ctx} />
  if (variant === 'ImgWidget') return <ImgWidgetView ctx={ctx} />
  if (variant === 'InlineLaTex' || variant === 'WrappedInlineLaTex' || variant === 'DisplayLaTex') {
    return <LatexView ctx={ctx} variant={variant} />
  }
  if (variant === 'sugForm') return <SugFormView ctx={ctx} />
  if (variant === 'Toolbar') {
    return (
      <MdRoot className={ctx.className} variant={variant}>
        {ctx.renderNamed('.MD/toolbar')}
      </MdRoot>
    )
  }
  if (variant === 'followUp') return <FollowUpLinksView ctx={ctx} />
  if (variant === 'IMG') {
    return (
      <MdRoot className={ctx.className} variant="IMG">
        {ctx.renderNamed('.MD/IMG')}
      </MdRoot>
    )
  }
  if (variant === 'video') {
    const videoType = str(ctx.v('videoType'), 'horizontal')
    return (
      <MdRoot className={ctx.className} variant="video">
        {ctx.renderNamed(
          '.MD/video',
          {
            type: videoType === 'vertical' || videoType === 'multi' ? videoType : 'horizontal',
            videoTitle: ctx.v('videoTitle'),
            videoOwner: ctx.v('videoOwner'),
            videoTime: ctx.v('videoTime'),
          },
          ctx.children,
        )}
      </MdRoot>
    )
  }
  return <BodyView ctx={ctx} variant="Body" />
}

function ToolbarIconButton({
  action,
  label,
  on,
  src,
  onAction,
}: {
  action: string
  label: string
  src: string
  on?: boolean
  onAction?: (action: string) => void
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={on}
      className={`yb-md-tool ${on ? 'is-on' : ''}`.trim()}
      onClick={() => onAction?.(action)}
      type="button"
    >
      <MdMask size={24} src={src} />
    </button>
  )
}

export function MDToolbarView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'Default')
  const recreate = type === 'recreate'
  const [liked, setLiked] = useState(false)
  const [disliked, setDisliked] = useState(false)
  const [play, setPlay] = useState(type === 'playing' ? 'playing' : 'play')

  useEffect(() => {
    if (type === 'playing') setPlay('playing')
    else setPlay('play')
  }, [type])

  const playSrc = play === 'playing' ? '/icons/md-playing.svg' : play === 'paused' ? '/icons/md-paused.svg' : '/icons/md-play.svg'

  return (
    <div className={`yb-md-toolbar ${ctx.className}`.trim()} data-type={type}>
      <div className="yb-md-toolbar-actions">
        {recreate ? (
          <div className="yb-md-toolbar-pager">
            <button aria-label="上一条" onClick={() => ctx.onAction?.('prev')} type="button">
              <Icon decorative name="Icon/chevron-left" size={24} />
            </button>
            <span>1/2</span>
            <button aria-label="下一条" onClick={() => ctx.onAction?.('next')} type="button">
              <Icon decorative name="Icon/chevron-right" size={24} />
            </button>
          </div>
        ) : null}
        <ToolbarIconButton action="refresh" label="重新生成" onAction={ctx.onAction} src="/icons/md-refresh.svg" />
        <ToolbarIconButton action="copy" label="复制" onAction={ctx.onAction} src="/icons/md-copy.svg" />
        <ToolbarIconButton
          action="play"
          label={play === 'playing' ? '播放中' : play === 'paused' ? '已暂停' : '朗读'}
          on={play !== 'play'}
          onAction={(action) => {
            if (!recreate) {
              setPlay((current) => (current === 'play' ? 'playing' : current === 'playing' ? 'paused' : 'play'))
            }
            ctx.onAction?.(action)
          }}
          src={playSrc}
        />
        {recreate ? <ToolbarIconButton action="more" label="更多" onAction={ctx.onAction} src="/icons/more.svg" /> : null}
        {recreate ? null : (
          <ToolbarIconButton
            action="like"
            label="点赞"
            on={liked}
            onAction={(action) => {
              setLiked((current) => {
                const next = !current
                if (next) setDisliked(false)
                return next
              })
              ctx.onAction?.(action)
            }}
            src={liked ? '/icons/md-like-on.svg' : '/icons/md-like.svg'}
          />
        )}
        {recreate ? null : (
          <ToolbarIconButton
            action="dislike"
            label="点踩"
            on={disliked}
            onAction={(action) => {
              setDisliked((current) => {
                const next = !current
                if (next) setLiked(false)
                return next
              })
              ctx.onAction?.(action)
            }}
            src={disliked ? '/icons/md-dislike-on.svg' : '/icons/md-dislike.svg'}
          />
        )}
        {recreate ? null : <ToolbarIconButton action="share" label="分享" onAction={ctx.onAction} src="/icons/md-share.svg" />}
      </div>
      <button className="yb-md-source" onClick={() => ctx.onAction?.('source')} type="button">
        <span className="yb-md-source-logos">
          <img alt="" src="/icons/md-source-1.svg" />
          <MdPhoto density={3} src="/icons/md-source-2.png" />
          <MdPhoto density={3} src="/icons/md-source-3.png" />
        </span>
        源
      </button>
    </div>
  )
}

export function MDToolItemView({ ctx }: { ctx: RenderCtx }) {
  const name = ctx.asset.name
  if (name.includes('play')) {
    const status = str(ctx.v('status'), 'play')
    const src = status === 'playing' ? '/icons/md-playing.svg' : status === 'paused' ? '/icons/md-paused.svg' : '/icons/md-play.svg'
    return (
      <button
        aria-label={status === 'playing' ? '播放中' : status === 'paused' ? '已暂停' : '朗读'}
        className={`yb-md-tool ${ctx.className}`.trim()}
        onClick={() => ctx.onAction?.('play')}
        type="button"
      >
        <MdMask size={24} src={src} />
      </button>
    )
  }
  const liked = str(ctx.v('click'), 'false') === 'true'
  const dislike = name.includes('dislike')
  const action = dislike ? 'dislike' : 'like'
  const src = dislike
    ? liked
      ? '/icons/md-dislike-on.svg'
      : '/icons/md-dislike.svg'
    : liked
      ? '/icons/md-like-on.svg'
      : '/icons/md-like.svg'
  return (
    <button
      aria-label={dislike ? '点踩' : '点赞'}
      aria-pressed={liked}
      className={`yb-md-tool ${liked ? 'is-on' : ''} ${ctx.className}`.trim()}
      onClick={() => ctx.onAction?.(action)}
      type="button"
    >
      <MdMask size={24} src={src} />
    </button>
  )
}

function followupKind(labels: string[], property1: string) {
  if (property1 === 'longText' || property1 === 'multi2' || property1 === 'multi3' || property1 === 'single') return property1
  if (labels.some((label) => label.length > 10)) return 'longText'
  if (labels.length >= 3) return 'multi3'
  if (labels.length === 2) return 'multi2'
  return 'single'
}

export function MDFollowupView({ ctx }: { ctx: RenderCtx }) {
  const property1 = str(ctx.v('property1'), 'single')
  const labels = stringItems(ctx.values.items) ?? FOLLOWUP_LABELS[property1] ?? FOLLOWUP_LABELS.single
  const kind = followupKind(labels, property1)
  const prefix = str(ctx.v('actionPrefix'), 'follow-up')
  return (
    <div className={`yb-md-followups ${ctx.className}`.trim()} data-kind={kind}>
      {labels.map((item) => (
        <button
          className={kind === 'longText' ? 'is-long' : undefined}
          key={item}
          onClick={() => ctx.onAction?.(`${prefix}:${item}`)}
          type="button"
        >
          {item}
        </button>
      ))}
    </div>
  )
}

const DEFAULT_PROGRESS_MIND =
  '用户提到了神经网络这个概念，系统首先分析输入数据，识别出关键特征和模式。接着，通过多层神经网络进行推理，评估不同的可能性和结果。随着每一次迭代，AI不断优化其算法，逐步接近最优解。'

function progressMind(ctx: RenderCtx) {
  const body = ctx.v('body')
  if (typeof body === 'string' && body !== '' && body !== '-1:-1' && !/^\d+:\d+$/.test(body)) return body
  return ctx.renderSlot(body) ?? DEFAULT_PROGRESS_MIND
}

export function MDProgressView({ ctx }: { ctx: RenderCtx }) {
  const status = str(ctx.v('status'), 'done')
  const label = contentOr(
    ctx.children,
    status === 'loading' ? '思考中' : status === 'clarify' ? '待用户补充信息' : '处理完成',
  )
  const chevron = status === 'clarify' ? 'Icon/chevron-down' : 'Icon/chevron-right'
  const mind = progressMind(ctx)
  const mindRef = useRef<HTMLDivElement>(null)
  const [clip, setClip] = useState(false)
  useLayoutEffect(() => {
    const box = mindRef.current
    if (!box) return
    setClip(box.scrollHeight > 140)
  }, [mind, status])
  return (
    <div className={`yb-md-progress ${ctx.className}`.trim()} data-status={status}>
      <button className="yb-md-progress-label" onClick={() => ctx.onAction?.('progress')} type="button">
        <span className={status === 'loading' || status === 'clarify' ? 'is-shimmer' : undefined}>{label}</span>
        <Icon decorative name={chevron} size={14} />
      </button>
      {status === 'loading' ? (
        <>
          <MdPad height={10} />
          <div className={`yb-md-progress-mind${clip ? ' is-clip' : ''}`} ref={mindRef}>
            {mind}
          </div>
        </>
      ) : null}
      <MdPad height={12} />
    </div>
  )
}

export function MDAgentIconView({ ctx }: { ctx: RenderCtx }) {
  const node = str(ctx.v('node'), str(ctx.v('property1'), '完成'))
  const icon = AGENT_ICON[node] ?? 'Icon/done'
  return (
    <span className={`yb-md-agent-icon ${ctx.className}`.trim()}>
      <Icon decorative name={icon} size={16} />
    </span>
  )
}

export function MDAgentView({ ctx }: { ctx: RenderCtx }) {
  const property1 = str(ctx.v('property1'), '澄清')
  const title = AGENT_TITLES[property1] ?? property1
  return (
    <section className={`yb-md-agent ${ctx.className}`.trim()} data-kind={property1}>
      {ctx.renderNamed('.MD/agent/nodeIcon', { node: property1 === '澄清' ? '完成' : property1 })}
      <div className="yb-md-agent-body">
        <strong>{contentOr(ctx.children, title)}</strong>
        {property1 === '澄清' ? (
          <div className="yb-md-agent-clarify">
            <p>你希望用来做什么？</p>
            <span>个人投资决策参考、学习/学术研究、用来当教学资料</span>
            <p>你希望文档的深度和篇幅是？</p>
            <span>精简摘要(2-3页核心要点)</span>
            <p>交付格式偏好？</p>
            <span>未提供</span>
          </div>
        ) : (
          ctx.renderNamed('.MD/agent/Attachment', { attachmentType: property1 === '搜图' ? 'img' : property1 === '视频' ? 'video' : property1 === 'fetch' ? 'fetch' : 'search' })
        )}
      </div>
    </section>
  )
}

export function MDAgentAttachmentView({ ctx }: { ctx: RenderCtx }) {
  const attachmentType = str(ctx.v('attachmentType'), 'fetch')
  if (attachmentType === 'img' || attachmentType === 'video') {
    return (
      <div className={`yb-md-attach-media ${ctx.className}`.trim()} data-type={attachmentType}>
        {contentImageSrcs(ctx.v('imageSrcs'), MD_ATTACH_THUMBS).map((src) => (
          <MdPhoto className="yb-md-attach-thumb" key={src} src={src} />
        ))}
      </div>
    )
  }
  const label = attachmentType === 'search' ? '搜索结果' : attachmentType === 'file' ? '文件附件' : '抓取页面'
  return (
    <div className={`yb-md-attachment ${ctx.className}`.trim()} data-type={attachmentType}>
      {ctx.renderSlot(ctx.v('slot')) ?? ctx.renderSlot(ctx.v('slot2')) ?? ctx.renderSlot(ctx.v('slot4')) ?? (
        <>
          <Icon decorative name="Icon/link" size={16} />
          <span>{contentOr(ctx.children, label)}</span>
        </>
      )}
    </div>
  )
}

function MdImgActions() {
  return (
    <div className="yb-md-img-actions">
      <span className="yb-md-img-action is-edit">
        <MdMask size={16} src="/icons/md-create-pic.svg" />
        智能P图
      </span>
      <span className="yb-md-img-action is-download">
        <MdMask size={16} src="/icons/md-img-download.svg" />
      </span>
    </div>
  )
}

function ImgFrame({
  src,
  ratio,
  more,
  caption,
  actions,
  style,
}: {
  src: string
  ratio?: string
  more?: string
  caption?: string
  actions?: boolean
  style?: CSSProperties
}) {
  return (
    <div className="yb-md-img-frame" data-ratio={ratio} style={style}>
      <MdPhoto className="yb-md-img-photo" src={src} />
      {caption ? (
        <span className="yb-md-img-caption">
          <span>{caption}</span>
        </span>
      ) : null}
      {actions ? <MdImgActions /> : null}
      {more ? <span className="yb-md-img-more">{more}</span> : null}
    </div>
  )
}

function VideoOwner({
  platform,
  name,
  time,
}: {
  platform: 'bilibili' | 'channel'
  name: string
  time: string
}) {
  return (
    <div className="yb-md-video-meta">
      <span className="yb-md-video-owner">
        {platform === 'bilibili' ? (
          <MdPhoto className="yb-md-video-logo" density={3} src="/icons/md-bilibili.png" />
        ) : (
          <MdMask className="yb-md-video-channel" size={16} src="/icons/md-video-channel.svg" />
        )}
        <span className="yb-md-video-name">
          <span className="yb-md-video-owner-name">{name}</span>
          {platform === 'bilibili' ? (
            <span aria-hidden className="yb-md-video-bili">
              <MdMask size={12} src="/icons/md-video-bolt.svg" />
            </span>
          ) : (
            <img alt="" className="yb-md-video-vmark" height={12} src="/icons/md-video-vmark.svg" width={12} />
          )}
        </span>
      </span>
      <span className="yb-md-video-time">{time}</span>
    </div>
  )
}

function VideoCard({
  src,
  kind,
  platform,
  name,
  time,
  title,
  density,
  onAction,
}: {
  src: string
  kind: 'horizontal' | 'vertical' | 'tile'
  platform: 'bilibili' | 'channel'
  name: string
  time: string
  title?: string
  density?: 2 | 3
  onAction?: (action: string) => void
}) {
  return (
    <button className={`yb-md-video-card is-${kind}`} onClick={() => onAction?.('video')} type="button">
      <div className="yb-md-img-frame" data-ratio={kind}>
        <MdPhoto className="yb-md-img-photo" density={density} src={src} />
        <MdVideoPlay />
        <div className="yb-md-video-scrim">
          <span>03:22</span>
          <span className="yb-md-video-likes">
            <img alt="" height={12} src="/icons/md-video-like.svg" width={12} />
            122
          </span>
        </div>
      </div>
      <div className="yb-md-video-info">
        <p className="yb-md-video-title">{title || MD_VIDEO_TITLE}</p>
        <VideoOwner name={name} platform={platform} time={time} />
      </div>
    </button>
  )
}

export function MDMediaView({ ctx }: { ctx: RenderCtx }) {
  const isVideo = ctx.asset.name.includes('video')
  const type = str(ctx.v('type'), isVideo ? 'horizontal' : '3:4')
  if (isVideo) {
    const slot = ctx.renderSlot(ctx.v('videos'))
    const videoType = type === 'multi' || type === 'vertical' ? type : 'horizontal'
    const videoTitle = str(ctx.children, str(ctx.v('videoTitle'), MD_VIDEO_TITLE))
    const videoOwner = str(ctx.v('videoOwner'), videoType === 'horizontal' ? '旅游达人' : '旅游达人旅游达人')
    const videoTime = str(ctx.v('videoTime'), videoType === 'horizontal' ? '7天前' : '刚刚')
    return (
      <div className={`yb-md-video ${ctx.className}`.trim()} data-type={videoType}>
        <MdPad height={12} />
        <div className="yb-md-video-stack">
          <p className="yb-md-video-kicker">相关视频</p>
          {slot ?? (
            videoType === 'multi' ? (
              <div className="yb-md-video-multi">
                <VideoCard
                  kind="tile"
                  name={videoOwner}
                  onAction={ctx.onAction}
                  platform="channel"
                  src="/images/md-video-m1.png"
                  time={videoTime}
                  title={videoTitle}
                />
                <VideoCard
                  density={2}
                  kind="tile"
                  name={videoOwner}
                  onAction={ctx.onAction}
                  platform="channel"
                  src="/images/md-video-m2.png"
                  time={videoTime}
                  title={videoTitle}
                />
              </div>
            ) : videoType === 'vertical' ? (
              <VideoCard
                kind="vertical"
                name={videoOwner}
                onAction={ctx.onAction}
                platform="channel"
                src="/images/md-video-v.png"
                time={videoTime}
                title={videoTitle}
              />
            ) : (
              <VideoCard
                density={2}
                kind="horizontal"
                name={videoOwner}
                onAction={ctx.onAction}
                platform="bilibili"
                src="/images/md-video-h.png"
                time={videoTime}
                title={videoTitle}
              />
            )
          )}
        </div>
        <MdPad height={24} />
      </div>
    )
  }

  const slot = ctx.renderSlot(ctx.v('iMGS'))
  const imageSrc = contentImageSrc(ctx.v('imageSrc'), '')
  const multiSrcs = contentImageSrcs(
    ctx.v('imageSrcs'),
    MD_IMG_MULTI.map((item) => item.src),
  )
  const gridSrcs = contentImageSrcs(ctx.v('imageSrcs'), MD_IMG_GRID)
  const type6Srcs = contentImageSrcs(
    ctx.v('imageSrcs'),
    MD_IMG_TYPE6.map((item) => item.src),
  )
  return (
    <div className={`yb-md-imgs ${ctx.className}`.trim()} data-type={type}>
      <MdPad height={12} />
      {slot ?? (
        <>
          {type === 'multi' ? (
            <div className="yb-md-img-row">
              {MD_IMG_MULTI.map((item, index) => (
                <ImgFrame
                  caption={item.caption}
                  key={`${multiSrcs[index] ?? item.src}-${index}`}
                  ratio="multi"
                  src={multiSrcs[index] ?? item.src}
                  style={{ width: item.width }}
                />
              ))}
            </div>
          ) : null}
          {type === 'grid' ? (
            <div className="yb-md-img-grid">
              {[0, 1, 2].map((row) => (
                <div className="yb-md-img-grid-row" key={row}>
                  {[0, 1, 2].map((col) => {
                    const index = row * 3 + col
                    return (
                      <ImgFrame
                        key={`${gridSrcs[index] ?? MD_IMG_GRID[index]}-${index}`}
                        more={index === 8 ? '+13' : undefined}
                        ratio="grid"
                        src={gridSrcs[index] ?? MD_IMG_GRID[index]}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          ) : null}
          {type === 'type6' ? (
            <div className="yb-md-img-stack">
              {MD_IMG_TYPE6.map((item, index) => (
                <ImgFrame
                  actions
                  key={`${type6Srcs[index] ?? item.src}-${index}`}
                  ratio="type6"
                  src={type6Srcs[index] ?? item.src}
                  style={{ height: item.height }}
                />
              ))}
            </div>
          ) : null}
          {type === 'singleAIGC' ? (
            <ImgFrame actions ratio="aigc" src={imageSrc || '/images/md-img-aigc.png'} />
          ) : null}
          {type === '3:4' || type === '4:3' || type === '1:1' ? (
            <ImgFrame caption="图片说明" ratio={type} src={imageSrc || MD_IMG_SINGLE[type]} />
          ) : null}
        </>
      )}
      <MdPad height={24} />
    </div>
  )
}

export function MDOlNumView({ ctx }: { ctx: RenderCtx }) {
  const variant = str(ctx.v('variant'), '0-9')
  const index = typeof ctx.values.index === 'number' ? (ctx.values.index as number) : 0
  const n = index + 1
  const wide = variant === '10+' || n >= 10
  return (
    <span className={`yb-md-ol-num ${ctx.className}`.trim()} data-variant={wide ? '10+' : '0-9'}>
      {n}.
    </span>
  )
}

export function MDOlView({ ctx }: { ctx: RenderCtx }) {
  const level = str(ctx.v('level'), '1')
  const index = typeof ctx.values.index === 'number' ? (ctx.values.index as number) : 0
  const numVariant = index + 1 >= 10 ? '10+' : '0-9'
  return (
    <span className={`yb-md-ol ${ctx.className}`.trim()} data-level={level}>
      {ctx.renderNamed('.MD/ol/num', { variant: numVariant, index })}
    </span>
  )
}

export function MDUlView({ ctx }: { ctx: RenderCtx }) {
  const level = str(ctx.v('level'), '1')
  return (
    <span className={`yb-md-ul ${ctx.className}`.trim()} data-level={level}>
      <i aria-hidden className="yb-md-ul-dot" />
    </span>
  )
}

export function MDListMarkerView({ ctx }: { ctx: RenderCtx }) {
  if (ctx.asset.name.includes('/ul')) return <MDUlView ctx={ctx} />
  if (ctx.asset.name.endsWith('/ol')) return <MDOlView ctx={ctx} />
  return <MDOlNumView ctx={ctx} />
}

export function MDSentView({ ctx }: { ctx: RenderCtx }) {
  const type = str(ctx.v('type'), 'wechat')
  if (type === 'image') {
    return (
      <div className={`yb-md-sent is-image ${ctx.className}`.trim()}>
        <MdPhoto className="yb-md-sent-photo" density={3} src="/images/md-sent.png" />
        <div className="yb-md-sent-photo-action">
          <MdMask size={16} src="/icons/md-create-pic.svg" />
          智能P图
        </div>
      </div>
    )
  }
  if (type === 'file') {
    return (
      <div className={`yb-md-sent is-file ${ctx.className}`.trim()}>
        {ctx.renderNamed('2850:10220', { file: 'PDF' })}
        <div>
          <strong>{contentOr(ctx.children, '文件')}</strong>
          <small>PDF</small>
        </div>
      </div>
    )
  }
  if (type === '公众号') {
    return (
      <div className={`yb-md-sent is-mp ${ctx.className}`.trim()}>
        <strong>{contentOr(ctx.children, '公众号')}</strong>
      </div>
    )
  }
  return (
    <div className={`yb-md-sent is-wechat ${ctx.className}`.trim()}>
      <small>转发内容</small>
      <p>{contentOr(ctx.children, '艾慧：霍尔木兹海峡大消息，油价暴涨！')}</p>
      <span>99 条消息</span>
    </div>
  )
}
