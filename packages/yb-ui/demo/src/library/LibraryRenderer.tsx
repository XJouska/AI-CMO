import type { ReactNode } from 'react'
import type { AssetDefinition } from '../generated/assets'
import { fullCatalog as assetCatalog } from './catalog'
import type { RenderCtx } from './context'
import { isEmptySlot } from './helpers'
import {
  AgentInputButtonsView,
  AgentInputIconView,
  AgentInputPrimaryButtonView,
  AgentInputView,
  ButtonView,
  FormDoubleLineView,
  FormSingleLineView,
  RadioCheckBoxView,
  SearchView,
  SwitchView,
} from './components/Actions'
import { KeyboardView, PublishedKeyboardView } from './components/Keyboard'
import { TemplateContentView, IPadGuidelinesView } from './components/TemplateContent'
import { FormFieldsView, FormFieldsItemView } from './components/FormFields'
import { TabView, TabItemView } from './components/Tabs'
import { ListSectionTitleView, ListTrailingContentView, ListTrailingSwitchView,
  ListTrailingIconView, AgentVisibilityIconView, ListItemTitleView, ListExperienceBadgeView } from './components/ListParts'
import {
  BadgeDotView,
  BadgeNumberView,
  CardView,
  EmptyIllusView,
  EmptyPageView,
  FileItemsView,
  FileView,
  HistoryItemView,
  HistoryItemsView,
  ListView,
  SettingsCellView,
  SettingsFullWidthItemView,
  SettingsItemsView,
  StatusView,
  TagView,
} from './components/Display'
import {
  ActionSheetItemView,
  ActionSheetView,
  BlueView,
  BottomSheetView,
  ButtonGroupView,
  DialogBodyView,
  DialogView,
  FeatureSheetView,
  GuideView,
  IndicatorView,
  LoadingView,
  LoadingTextView,
  NavBarIconView,
  NotificationView,
  OutputView,
  ShareSheetItemView,
  ShareSheetView,
  SheetNavBarView,
  SnackbarView,
  TextAtomView,
  TipView,
  ToastView,
  TooltipView,
} from './components/Feedback'
import {
  DividerView,
  IconAssetView,
  MaskView,
  MenuDividerView,
  MenuItemView,
  MenuView,
} from './components/Foundation'
import {
  ImgViewerButtonGroupView,
  ImgViewerFooterView,
  ImgViewerNavBarView,
  ImgViewerSearchInfoView,
  ImgViewerView,
  IPadTemplateView,
  MarkdownView,
  MDAgentAttachmentView,
  MDAgentIconView,
  MDAgentView,
  MDFollowupView,
  MDOlNumView,
  MDOlView,
  MDUlView,
  MDMediaView,
  MDProgressView,
  MDSentView,
  MDToolbarView,
  MDToolItemView,
  VideoViewerFooterView,
  VideoViewerIndicatorView,
  VideoViewerNavBarView,
  VideoViewerView,
  WindowResizeView,
} from './components/MediaMarkdown'
import {
  BrowserToolbarIconView,
  BrowserToolbarView,
  NavBarButtonsView,
  NavBarTitleView,
  NavBarView,
  StatusBarView,
  TabBarIconView,
  TabBarModeIconView,
  TabBarView,
} from './components/Navigation'
import { useRenderPolicy } from './RenderPolicy'
import rendererBindings from './renderer-bindings.json'
import rendererNodeBindings from './renderer-node-bindings.json'
import unavailableRenderers from './renderer-unavailable.json'
import './library.css'

type View = (props: { ctx: RenderCtx }) => ReactNode

const viewsByName: Record<string, View> = {
  Content: TemplateContentView,
  'Published Keyboard': PublishedKeyboardView,
  'iPad guidelines': IPadGuidelinesView,
  'Form Fields': FormFieldsView,
  '.Form Fields/Item': FormFieldsItemView,
  tab: TabView,
  '.tab/item': TabItemView,
  'List/sectionTitle': ListSectionTitleView,
  'List/trailingContent': ListTrailingContentView,
  'List/trailingSwitch': ListTrailingSwitchView,
  'List/trailingIcon': ListTrailingIconView,
  'Agent/visibilityIcon': AgentVisibilityIconView,
  'List/itemTitle': ListItemTitleView,
  'List/experienceBadge': ListExperienceBadgeView,
  mask: MaskView,
  divider: DividerView,
  'NavBar / Buttons': NavBarButtonsView,
  '.StatusBar': StatusBarView,
  '.NavBar / Title': NavBarTitleView,
  'NavBar 导航栏': NavBarView,
  '.TabBar / Icon': TabBarIconView,
  'TabBar 底部标签栏': TabBarView,
  '.TabBar / Icons-Mode Options': TabBarModeIconView,
  BrowserToolbar: BrowserToolbarView,
  '.BrowserToolbar/icon': BrowserToolbarIconView,
  'Button 按钮': ButtonView,
  '.Agent Input/Icon': AgentInputIconView,
  '.Agent Input/ButtonCombination': AgentInputButtonsView,
  '.Agent Input/PrimaryButton': AgentInputPrimaryButtonView,
  'Agent Input': AgentInputView,
  Keyboard: KeyboardView,
  'Radio & CheckBox': RadioCheckBoxView,
  'menu/divider': MenuDividerView,
  'menu/vertical/item': MenuItemView,
  'menu/horizontal/item': MenuItemView,
  'menu/horizontal': MenuView,
  'menu/vertical': MenuView,
  'Form/SingleLine': FormSingleLineView,
  'Form/DoubleLine': FormDoubleLineView,
  Switch: SwitchView,
  '.history/item': HistoryItemView,
  search: SearchView,
  '.historyItems': HistoryItemsView,
  Markdown: MarkdownView,
  '.MD/ol/num': MDOlNumView,
  '.MD/ol': MDOlView,
  '.MD/ul': MDUlView,
  '.MD/progress': MDProgressView,
  '.MD/followupButtons': MDFollowupView,
  '.MD/video': MDMediaView,
  '.MD/IMG': MDMediaView,
  '.MD/toolbarItems/like': MDToolItemView,
  '.MD/toolbarItems/dislike': MDToolItemView,
  '.MD/toolbarItems/play': MDToolItemView,
  '.MD/toolbar': MDToolbarView,
  '.MD/sent': MDSentView,
  '.MD/agent/Attachment': MDAgentAttachmentView,
  '.MD/agent/nodeIcon': MDAgentIconView,
  '.MD/agent': MDAgentView,
  'Settings/items': SettingsItemsView,
  'File/items': FileItemsView,
  List: ListView,
  '.Settings/items/cell': SettingsCellView,
  'Settings/fullWidthItem': SettingsFullWidthItemView,
  '.状态': StatusView,
  '.File': FileView,
  卡片: CardView,
  状态: StatusView,
  Tag: TagView,
  'Badge / Dot': BadgeDotView,
  'Badge / Number': BadgeNumberView,
  '.Badge Number': BadgeNumberView,
  emptyPage: EmptyPageView,
  'emptyPage/illus': EmptyIllusView,
  '.imgViewer/footerAction': ImgViewerFooterView,
  '.imgViewer/searchImgInfo': ImgViewerSearchInfoView,
  '.imgViewer/navBar': ImgViewerNavBarView,
  '.imgViewer/buttonGroup': ImgViewerButtonGroupView,
  imgViewer: ImgViewerView,
  '.videoViewer/footerAction': VideoViewerFooterView,
  '.videoViewer/navBar': VideoViewerNavBarView,
  '.videoViewer/footerAction/indicator': VideoViewerIndicatorView,
  videoViewer: VideoViewerView,
  弹窗组件: DialogView,
  '.dialog/body': DialogBodyView,
  '.buttonGroup': ButtonGroupView,
  bottomSheet: BottomSheetView,
  '.navbar': SheetNavBarView,
  '.navBar / Icon': NavBarIconView,
  ActionSheet: ActionSheetView,
  '.Actionsheet/item': ActionSheetItemView,
  '.indicator': IndicatorView,
  '.text': TextAtomView,
  FeatureSheet: FeatureSheetView,
  '.shareSheet/item': ShareSheetItemView,
  shareSheet: ShareSheetView,
  Toast: ToastView,
  tooltip: TooltipView,
  Notification: NotificationView,
  Snackbar: SnackbarView,
  tip: TipView,
  Guide: GuideView,
  蓝色: BlueView,
  output: OutputView,
  Loading: LoadingView,
  'Loading+text': LoadingTextView,
  'ipad 模板': IPadTemplateView,
  '_Window Resize': WindowResizeView,
}

function normalizeName(name: string) {
  return name.replace(/[\u200B-\u200D\uFEFF]/g, '')
}

const assetsByKey = new Map(assetCatalog.map(asset => [asset.assetKey, asset]))
const rendererByKey = new Map(Object.entries(rendererBindings).map(([key, name]) => [key, viewsByName[name]]))
const rendererByNodeId = new Map(Object.entries(rendererNodeBindings).map(([nodeId, name]) => [nodeId, viewsByName[name]]))
function findAsset(ref: string, strict = false) {
  const exact = assetsByKey.get(ref) ?? assetCatalog.find(asset => asset.nodeId === ref || asset.componentName === ref)
  if (exact) return exact
  const matches = assetCatalog.filter(asset => normalizeName(asset.name) === normalizeName(ref))
  if (strict && matches.length !== 1) throw new Error(`Ambiguous or missing component reference: ${ref}`)
  return matches.length === 1 ? matches[0] : undefined
}

function FallbackView({ ctx }: { ctx: RenderCtx }) {
  return (
    <p className={`yb-fallback ${ctx.className}`.trim()} role="status" data-missing-renderer={ctx.asset.assetKey}>
      {ctx.asset.name}：缺少已验证的 React 实现
    </p>
  )
}

export interface LibraryRendererProps {
  asset: AssetDefinition
  values?: object
}

export function LibraryRenderer({ asset, values = {} }: LibraryRendererProps) {
  const strict = useRenderPolicy() === 'deliverable-strict'
  const supplied = values as Record<string, unknown>
  if (strict) {
    const canonical = assetsByKey.get(asset.assetKey)
    if (!canonical || canonical.nodeId !== asset.nodeId) throw new Error(`Unknown component identity: ${asset.assetKey}`)
    if (!canonical.published) throw new Error(`Unpublished component in strict delivery: ${asset.name}`)
    const unavailable = (unavailableRenderers as Record<string, string>)[canonical.assetKey]
    if (unavailable) throw new Error(`Unavailable renderer: ${canonical.assetKey}: ${unavailable}`)
    asset = canonical
    for (const property of asset.properties) {
      const value = supplied[property.reactProp]
      if (value === undefined) continue
      if (property.type === 'BOOLEAN' && typeof value !== 'boolean') throw new Error(`Invalid boolean: ${asset.name}.${property.reactProp}`)
      if (property.type === 'VARIANT' && !property.variantOptions.includes(String(value))) throw new Error(`Invalid variant: ${asset.name}.${property.reactProp}=${String(value)}`)
      if (property.type === 'TEXT' && typeof value !== 'string') throw new Error(`Invalid text: ${asset.name}.${property.reactProp}`)
      if ((property.type === 'SLOT' || property.type === 'INSTANCE_SWAP') && typeof value === 'string' && value !== '') findAsset(value, true)
    }
  }
  const merged = Object.fromEntries(
    asset.properties.map((property) => [property.reactProp, supplied[property.reactProp] ?? property.defaultValue]),
  )
  const className = typeof supplied.className === 'string' ? supplied.className : ''
  const onAction = typeof supplied.onAction === 'function' ? (supplied.onAction as (action: string) => void) : undefined

  function renderAsset(next: AssetDefinition, nextValues: Record<string, unknown> = {}, children?: ReactNode) {
    return (
      <LibraryRenderer
        asset={next}
        values={{
          ...nextValues,
          children,
          onAction:
            typeof nextValues.onAction === 'function'
              ? (nextValues.onAction as (action: string) => void)
              : onAction,
        }}
      />
    )
  }

  const ctx: RenderCtx = {
    asset,
    values: { ...merged, ...supplied },
    children: supplied.children as ReactNode,
    className,
    onAction,
    v: (key) => supplied[key] ?? merged[key],
    renderSlot(value, fallback) {
      if (isEmptySlot(value)) return fallback ?? null
      if (typeof value === 'string') {
        const nested = findAsset(value, strict)
        return nested ? renderAsset(nested) : (fallback ?? null)
      }
      return value as ReactNode
    },
    renderNamed(name, nextValues = {}, children) {
      const nested = findAsset(name, strict)
      if (!nested) return children ?? null
      return renderAsset(nested, nextValues, children)
    },
  }

  const registered = rendererByKey.get(asset.assetKey) ?? rendererByNodeId.get(asset.nodeId)
  if (strict && !asset.isIcon && !registered) throw new Error(`Missing renderer: ${asset.assetKey}`)
  const View = asset.isIcon ? IconAssetView : registered ?? FallbackView
  return <View ctx={ctx} />
}

export function renderByName(name: string, values?: object) {
  const asset = findAsset(name)
  if (!asset) return null
  return <LibraryRenderer asset={asset} values={values} />
}
