import type { AssetDefinition } from '../generated/assets'

type EditableValue = string | boolean
type Values = Record<string, EditableValue>

const AGENT_CYCLE: Record<string, string> = {
  Default: 'Inputting',
  Voice: 'Inputting',
  Inputting: 'Stopped',
  Stopped: 'Default',
  Upload: 'Inputting',
  'Long Text': 'Inputting',
}

function setProp(current: Values, key: string, value: EditableValue): Values {
  return { ...current, [key]: value }
}

/** Keep catalog values on description-legal variants; View also clamps as a backstop. */
export function clampCatalogValues(asset: AssetDefinition, values: Values): Values {
  if (asset.name === 'Radio & CheckBox') {
    if (String(values.type ?? 'circled') !== 'plain') return values
    if (String(values.state) === 'checked') return values
    return setProp(values, 'state', 'checked')
  }
  if (asset.name === 'bottomSheet' && String(values.navbarType ?? 'default') === 'tabCard') {
    return setProp(values, 'navbarPosition', 'middle')
  }
  return values
}

export function nextAgentType(currentType: string, action: string): string {
  const atomic = currentType.startsWith('Atomic')
  if (atomic) return currentType
  if (action === 'send') return AGENT_CYCLE[currentType] ?? 'Inputting'
  if (action === 'stop') return 'Default'
  if (action === 'agent-icon:Voice') return 'Voice'
  if (action === 'agent-icon:Keyboard') return 'Default'
  if (action === 'agent-icon:Plus' && currentType === 'Default') return 'Upload'
  return currentType
}

export function applyCatalogAction(
  asset: AssetDefinition,
  action: string,
  current: Values,
): Values {
  const name = asset.name

  if (name === 'Radio & CheckBox' && action === 'toggle') {
    const clamped = clampCatalogValues(asset, current)
    const type = String(clamped.type ?? 'circled')
    if (type === 'plain') return clamped
    const state = String(clamped.state ?? 'unchecked')
    if (state === 'disabled' || state === 'checkedDisabled') return clamped
    return setProp(clamped, 'state', state === 'checked' ? 'unchecked' : 'checked')
  }

  if (name === 'TabBar 底部标签栏') {
    if (action.startsWith('tab:')) {
      const tabId = action.slice(4)
      const selected = String(current.selected ?? 'Tab 1 & Input')
      if (tabId === 'Tab 1') {
        return setProp(
          current,
          'selected',
          selected === 'Tab 1' ? 'Tab 1 & Input' : selected === 'Tab 1 & Input' ? 'Tab 1' : 'Tab 1',
        )
      }
      return setProp(current, 'selected', tabId)
    }
    const currentType = String(current.__agentType ?? 'Default')
    const nested = nextAgentType(currentType, action)
    if (nested !== currentType) return setProp(current, '__agentType', nested)
    return current
  }

  if (name === 'Button 按钮' && action === 'press') {
    const state = String(current.state ?? 'Default')
    if (state === 'Disable') return current
    return setProp(current, 'state', 'Pressed')
  }

  if (name === 'Button 按钮' && action === 'press-end') {
    const state = String(current.state ?? 'Default')
    if (state === 'Disable') return current
    return setProp(current, 'state', 'Default')
  }

  if (name === 'Agent Input') {
    const type = String(current.type ?? 'Default')
    const next = nextAgentType(type, action)
    if (next !== type) return setProp(current, 'type', next)
    return current
  }

  if (name === 'Keyboard') {
    return current
  }

  if ((name === 'menu/vertical/item' || name === 'menu/horizontal/item') && action === 'press') {
    const pressed = String(current.pressed ?? 'off')
    return setProp(current, 'pressed', pressed === 'on' ? 'off' : 'on')
  }

  if (name === 'Form/SingleLine' || name === 'Form/DoubleLine') {
    if (action === 'focus') {
      return { ...setProp(current, 'input', 'on'), active: true }
    }
    if (action === 'clear') {
      return setProp(current, 'input', 'off')
    }
  }

  if (name === 'Switch' && action === 'toggle') {
    if (String(current.disabled ?? 'false') === 'true') return current
    const on = String(current.turnOn ?? 'true') === 'true'
    return setProp(current, 'turnOn', on ? 'false' : 'true')
  }

  if (name === 'search') {
    if (action === 'focus') return setProp(current, 'status', 'focus')
    if (action === 'input') return setProp(current, 'status', 'inputted')
    if (action === 'clear') return setProp(current, 'status', 'focus')
    if (action === 'cancel') return setProp(current, 'status', 'default')
  }

  if (
    (name === 'List' ||
      name === 'Settings/items' ||
      name === '.Settings/items/cell' ||
      name === 'Settings/fullWidthItem') &&
    action === 'toggle'
  ) {
    return current
  }

  if (name === 'Settings/fullWidthItem' && action === 'press') {
    return current
  }

  if (name === '卡片') {
    if (action === 'press') return setProp(current, 'pressed', 'on')
    if (action === 'press-end') return setProp(current, 'pressed', 'off')
    if (action === 'close') return setProp(current, 'close', false)
  }

  if (name === 'emptyPage' && (action === 'press' || action === 'press-end')) {
    return current
  }

  if (name === '.MD/toolbarItems/like' && action === 'like') {
    const on = String(current.click ?? 'false') === 'true'
    return setProp(current, 'click', on ? 'false' : 'true')
  }

  if (name === '.MD/toolbarItems/dislike' && action === 'dislike') {
    const on = String(current.click ?? 'false') === 'true'
    return setProp(current, 'click', on ? 'false' : 'true')
  }

  if (name === '.MD/toolbarItems/play' && action === 'play') {
    const status = String(current.status ?? 'play')
    const next = status === 'play' ? 'playing' : status === 'playing' ? 'paused' : 'play'
    return setProp(current, 'status', next)
  }

  if (name === '.MD/toolbar' && action === 'play') {
    const type = String(current.type ?? 'Default')
    if (type === 'recreate') return current
    return setProp(current, 'type', type === 'playing' ? 'Default' : 'playing')
  }

  if (
    name === 'Markdown' &&
    (action === 'recording' ||
      action === 'play' ||
      action === 'imgwidget' ||
      action === 'miniprogram' ||
      action === 'video')
  ) {
    return current
  }

  if (name === 'FeatureSheet') {
    if (action.startsWith('focus:')) {
      const focus = action.slice(6)
      if (focus === '1' || focus === '2' || focus === '3' || focus === '4') {
        return setProp(current, 'focus', focus)
      }
    }
    return current
  }

  if (name === 'Snackbar' || name === 'Toast') {
    if (action.startsWith('iconState:')) {
      const next = action.slice(10)
      if (next === 'Error' || next === 'Warning' || next === 'Info' || next === 'Success') {
        return setProp(current, 'iconState', next)
      }
    }
    return current
  }

  if (
    name === 'shareSheet' ||
    name === '.shareSheet/item' ||
    name === 'tooltip' ||
    name === 'Notification' ||
    name === 'tip' ||
    name === 'Guide' ||
    name === '蓝色' ||
    name === 'output' ||
    name === 'Loading' ||
    name === 'Loading+text' ||
    name === 'ipad 模板' ||
    name === '_Window Resize'
  ) {
    return current
  }

  if (name === 'imgViewer' || name.startsWith('.imgViewer/')) {
    return current
  }

  if (name === '.Actionsheet/item' && action === 'press') {
    const state = String(current.state ?? 'Default')
    if (state === 'Disable') return current
    return setProp(current, 'state', state === 'Pressed' ? 'Default' : 'Pressed')
  }

  if (name === '.dialog/body' && action === 'toggle') {
    return current
  }

  if (
    name === '弹窗组件' ||
    name === 'bottomSheet' ||
    name === '.navbar' ||
    name === '.navBar / Icon' ||
    name === 'ActionSheet' ||
    name === '.buttonGroup'
  ) {
    return current
  }

  if (name === '.videoViewer/footerAction/indicator' && action.startsWith('status:')) {
    const status = action.slice(7)
    if (status === 'pause' || status === 'play' || status === 'drag') {
      return setProp(current, 'status', status)
    }
    return current
  }

  return current
}
