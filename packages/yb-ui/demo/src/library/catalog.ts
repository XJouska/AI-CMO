import { assetCatalog, type AssetDefinition } from '../generated/assets'

export type { AssetDefinition }

const CARD_FILE_TYPES = [
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

const CARD_FILE_STATES = ['icon', 'loading', 'error', 'refresh'] as const

function appendProps(asset: AssetDefinition, extras: AssetDefinition['properties'], after?: string) {
  if (extras.length === 0) return asset
  const existing = new Set(asset.properties.map((property) => property.reactProp))
  const next = extras.filter((property) => !existing.has(property.reactProp))
  if (next.length === 0) return asset
  const properties = [...asset.properties]
  const index = after ? properties.findIndex((property) => property.reactProp === after) : -1
  properties.splice(index >= 0 ? index + 1 : properties.length, 0, ...next)
  return { ...asset, properties }
}

function withCatalogFacingProps(asset: AssetDefinition): AssetDefinition {
  if (asset.name === '状态') {
    asset = { ...asset, isInternal: true }
  }
  if (asset.name === 'Markdown') {
    asset = appendProps(asset, [
      {
        figmaName: 'type',
        reactProp: 'videoType',
        type: 'VARIANT',
        defaultValue: 'horizontal',
        variantOptions: ['horizontal', 'vertical', 'multi'],
      },
    ])
  }
  if (asset.name === 'emptyPage') {
    return appendProps(asset, [
      {
        figmaName: 'illus',
        reactProp: 'illus',
        type: 'VARIANT',
        defaultValue: 'placeholder',
        variantOptions: ['placeholder', 'networkError', 'noContent'],
      },
    ])
  }
  if (asset.name === 'FeatureSheet') {
    return appendProps(asset, [
      {
        figmaName: 'text',
        reactProp: 'text',
        type: 'VARIANT',
        defaultValue: 'multiLine',
        variantOptions: ['singleLine', 'multiLine'],
      },
      {
        figmaName: 'num',
        reactProp: 'num',
        type: 'VARIANT',
        defaultValue: '1',
        variantOptions: ['1', '2'],
      },
      {
        figmaName: 'focus',
        reactProp: 'focus',
        type: 'VARIANT',
        defaultValue: '1',
        variantOptions: ['1', '2', '3', '4'],
      },
    ])
  }
  if (asset.name === 'bottomSheet') {
    return appendProps(asset, [
      {
        figmaName: 'navbarType',
        reactProp: 'navbarType',
        type: 'VARIANT',
        defaultValue: 'default',
        variantOptions: ['default', 'tabCard'],
      },
      {
        figmaName: 'navbarPosition',
        reactProp: 'navbarPosition',
        type: 'VARIANT',
        defaultValue: 'left',
        variantOptions: ['left', 'middle'],
      },
      {
        figmaName: 'buttonType',
        reactProp: 'buttonType',
        type: 'VARIANT',
        defaultValue: '2BtnHorizantal',
        variantOptions: ['1Btn', '2BtnHorizantal', '2BtnVertical'],
      },
    ])
  }
  if (asset.name === 'shareSheet') {
    return appendProps(asset, [
      {
        figmaName: 'description',
        reactProp: 'description',
        type: 'BOOLEAN',
        defaultValue: true,
        variantOptions: [],
      },
    ])
  }
  if (asset.name === 'Guide') {
    return appendProps(asset, [
      {
        figmaName: 'line',
        reactProp: 'line',
        type: 'VARIANT',
        defaultValue: 'double',
        variantOptions: ['single', 'double'],
      },
    ])
  }
  if (asset.name === 'Snackbar' || asset.name === 'Toast') {
    return appendProps(asset, [
      {
        figmaName: 'Icon/State',
        reactProp: 'iconState',
        type: 'VARIANT',
        defaultValue: 'Success',
        variantOptions: asset.name === 'Toast' ? ['Success', 'Warning', 'Info'] : ['Error', 'Warning', 'Info', 'Success'],
      },
    ])
  }
  if (asset.name !== '卡片') return asset
  return appendProps(
    asset,
    [
      {
        figmaName: 'File',
        reactProp: 'file',
        type: 'VARIANT',
        defaultValue: 'PDF',
        variantOptions: CARD_FILE_TYPES,
      },
      {
        figmaName: 'State',
        reactProp: 'state',
        type: 'VARIANT',
        defaultValue: 'icon',
        variantOptions: CARD_FILE_STATES,
      },
    ],
    'card',
  )
}

export interface CatalogAsset extends AssetDefinition {
  readonly published: boolean
}

export function isComponentCatalogEntry(asset: AssetDefinition) {
  return asset.pageName !== '【AI参考案例】Template' && asset.nodeId !== '20115:554'
}

// Published assets come from the live published inventory (data/figma-components.json).
export const publishedCatalog: CatalogAsset[] = assetCatalog.map((asset) => ({ ...asset, published: true }))
export const fullCatalog: CatalogAsset[] = publishedCatalog.map(
  (asset) => withCatalogFacingProps(asset) as CatalogAsset,
)
export const publishedAssetKeys = new Set(publishedCatalog.map((asset) => asset.assetKey))
