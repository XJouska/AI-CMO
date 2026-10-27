import { fullCatalog as assetCatalog } from './catalog'

export const nestableAssets = assetCatalog.filter((asset) => asset.isIcon || asset.isInternal)

export const publicAssets = assetCatalog.filter((asset) => !asset.isInternal)
export const internalAssets = assetCatalog.filter((asset) => asset.isInternal)

export const slotPickerAssets = assetCatalog.filter(
  (asset) => asset.isIcon || asset.name.startsWith('.') || asset.name === 'mask' || asset.name === 'divider',
)
