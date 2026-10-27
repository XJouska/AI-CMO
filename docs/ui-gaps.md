# UI 缺口登记

记录正式组件无法直接满足需求、因此做了本地扩展或覆盖的地方。原则：

- 只在正式组件**没有对应公开属性**时才扩展。
- 扩展只复用正式组件的 DOM 结构、CSS 类名和 tokens 变量，不新增视觉样式。
- 每条记录说明原因、实现位置、设计包更新时需要复核的内容。

---

## GAP-001 · TabBar 的 Tab 文案和图标写死

- **正式组件**：`TabBar`（节点 `119:10030`）
- **问题**：四个 Tab 固定为设计包品牌的文案和图标（`library/components/Navigation.tsx` 的 `TAB_ITEMS`），没有公开属性可改。
- **处理**：`packages/yb-ui/extensions/BrandTabBar.tsx`
  - 复用 `yb-tabbar` / `yb-tabbar-dock` / `yb-tabbar-body` / `yb-tabbar-icon` / `yb-tabbar-mode-icon` / `yb-tabbar-label` 类名和 `data-selected` / `data-tone` 属性
  - 输入框直接使用正式 `AgentInput`（`leftBtn={false}`，`rightType` 在 `Send Only` 与 `Stop & Plus` 之间切换）
  - 徽标使用正式 `BadgeDot` / `BadgeNumber`
  - 新增 `items: { id, label, icon, iconOn?, tone, badge?, dot? }[]` 属性
  - 正式 `AgentInput` 的原生输入框不处理回车，在 TabBar 根节点补充回车发送（输入法组字时不触发）
- **复核**：设计包更新后检查 `TabBarView` 的 DOM 结构和类名是否变化。

## GAP-002 · 贴边壳层组件宽度写死为 402px

- **正式组件**：`NavBar`、`TabBar`、`AgentInput`、`Settings/fullWidthItem`、`ListSectionTitle`、`Mask`、Sheet 类、`Keyboard`
- **问题**：组件 CSS 把宽度写死为 402px（iPhone 设计稿宽度）。真机宽度 360～430px，会溢出或留白；
  设计规范 `edge-chrome-vs-content-inset` 要求贴边壳层铺满画布。
- **处理**：`packages/yb-ui/extensions/canvas-fit.css`，作用范围限定在 `.app-canvas` 内，只把宽度改为 `100%`，不改颜色、字号、间距。
- **复核**：设计包更新后检查是否新增了写死 402px 的贴边组件。

## GAP-003 · NavBar 内置模拟 iOS 状态栏

- **正式组件**：`NavBar`（内部渲染 `.StatusBar`，显示 9:41 和信号图标）
- **问题**：真实浏览器已有系统状态栏，模拟状态栏会重复显示。
- **处理**：`canvas-fit.css` 把 `.yb-navbar .yb-status-bar` 收起为 `env(safe-area-inset-top)` 高度并隐藏内容，
  这样在 iOS 全面屏上仍然为刘海留出空间。
- **复核**：NavBar 背景板（`.yb-navbar-plate`）高度按 54px 状态栏设计，收起后背景板会多出一截但被内容层遮住，目前视觉无影响。

## GAP-004 · Tab 图标沿用设计包图标

- **问题**：设计包只提供四组 Tab 图标（节点 `5544:*`，原用途为「问元宝 / 派 / 发现 / 我们」）。
  本产品的「助手 / 商机 / 官网 / 我的」目前按顺序沿用这四组图标的 off / on 两态。
- **处理**：暂不处理。图标本身为通用几何图形，不含品牌字样。
- **后续**：如需产品专属图标，由设计补充到设计系统后再替换 `apps/web/src/components/local/TabPage.tsx` 中的 `TABS`。

## GAP-005 · 生产环境不使用设计包字体

- **问题**：设计包随附字体不构成网页部署授权（见 [licensing.md](licensing.md)）。
- **处理**：生产构建时，`apps/web/vite.config.ts` 把 `tokens.css` 中的 `@import "./fonts.css"` 替换为
  `packages/yb-ui/extensions/fonts.system.css`（空声明）。组件 CSS 的字体回退链为 `"PingFang SC", system-ui, sans-serif`，
  iOS / macOS 使用系统自带 PingFang SC，其他平台使用系统中文字体。
- **影响**：Android / Windows 上字形与设计稿略有差异；数字字体 DIN Pro 回退为系统字体。

## GAP-006 · 密码输入框（`SecureTextField`）

- **正式组件**：`Form/SingleLine` 渲染的 `<input>` 没有 `type` 属性，无法隐藏密码，也无法提示浏览器自动填充。
- **处理**：`apps/web/src/components/local/SecureTextField.tsx` 只复用 `Form/SingleLine` 的 DOM 结构与 CSS 类
  （`yb-form-wrap` / `yb-form-single` / `yb-form-value` / `yb-form-label`），设置 `type="password"` 和 `autocomplete`，
  不新增任何视觉样式。
- **后续**：设计系统提供密码输入变体后替换。

## GAP-007 · 页面布局与状态容器（`StackPage` / `QueryView`）

- **问题**：设计包没有「二级页面」与「数据加载四态」的容器组件。
- **处理**：`apps/web/src/components/local/StackPage.tsx` 只负责布局分区（正式 `NavBar` + 滚动内容 + 底部固定区）；
  `QueryView.tsx` 把加载 / 错误 / 空态分别映射到正式 `Loading` / `EmptyPage networkError` / `EmptyPage noContent`，
  并按规范 `page-empty` 相对整屏居中。两者都不定义组件外观，布局样式只用 Token。

## GAP-008 · 确认变更页的勾选行

- **问题**：`Settings/fullWidthItem` 没有前置勾选框的变体；`Settings/items` 的 Radio 单元格固定在右侧且只表示单选。
- **处理**：`.review-row` 把正式 `RadioCheckBox`（circled / sm）放在正式 `Settings/fullWidthItem` 左侧，
  勾选框位于内容层边距内。只有布局 CSS，没有新的视觉样式。

## GAP-009 · BottomSheet 按钮回调

- **问题**：正式 `bottomSheet` 的按钮组不向外暴露 `onAction`（内部 `.buttonGroup` 渲染的 Button 没有回调）。
- **处理**：`apps/web/src/feedback/overlays.tsx` 的 `FormSheet` 在外层容器捕获点击，按按钮在按钮组中的位置
  区分「次要 / 主要」。不修改设计包代码。
- **后续**：设计包为 `bottomSheet` 增加按钮回调后改为直接使用。

## GAP-010 · 助手页 NavBar 右侧「新对话」按钮

- **正式组件**：`NavBar barType="Agent"` 右侧默认渲染 `NavBar / Buttons type="Multiple"`（朗读 / 通话 / 临时对话三个图标，无回调）。
- **处理**：通过正式属性 `rightSlot` 传入一个按钮，复用 NavBar 自身的按钮类名 `yb-navbar-btn`，图标为设计包 `Icon/NewChat`。
- **后续**：设计包提供「单图标 + 回调」的 Agent 右侧按钮后替换。

## GAP-011 · 助手卡片的操作按钮区

- **问题**：正式 `卡片 Card` 的 Output 变体只有标题、副标题与左侧图标，没有按钮区；确认操作需要「取消 / 确认」两个按钮。
- **处理**：`ConfirmCard` 在正式 `Card Output` 下方放置两个正式 `Button`（M 尺寸），容器 `.assistant-card-actions` 只做布局。

## GAP-012 · Markdown Progress 的 status 属性

- **问题**：`Markdown variant="Progress"` 的 `status`（loading / done / clarify）由渲染器读取，但生成的类型声明中没有该属性。
- **处理**：按设计包示例 `screens/generated/agent.tsx` 的写法 `{...{ status: 'loading' }}` 传入，不修改设计包。

---

## 未作为缺口处理的情况

| 场景 | 做法 |
|---|---|
| 助手页 NavBar 标题（默认「元宝」） | 通过正式属性 `middleSlot` 传入正式 `InternalNavBarTitle`，不需要扩展。计划 01 中的 `BrandNavBar` 因此不再需要。 |
| 「我的」列表右侧描述 | 使用 `Settings/fullWidthItem` 的 `trailing` 属性；不用 `Settings/items`（其右侧文案写死为「选项」并带红点）。 |
