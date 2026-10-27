import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useHostContrast } from './hostContrast'

const PADDING = 48
const ICON_FIT_CAP = 4
const MIN_ZOOM = 0.25
const MAX_ZOOM = 8

export type PreviewZoom = 'fit' | number

interface PreviewCanvasProps {
  theme: 'light' | 'dark'
  zoom: PreviewZoom
  isIcon?: boolean
  onFitScaleChange?: (fitScale: number) => void
  onZoomChange?: (zoom: PreviewZoom) => void
  children: ReactNode
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

export function PreviewCanvas({
  theme,
  zoom,
  isIcon = false,
  onFitScaleChange,
  onZoomChange,
  children,
}: PreviewCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const onFitScaleChangeRef = useRef(onFitScaleChange)
  const onZoomChangeRef = useRef(onZoomChange)
  const zoomRef = useRef(zoom)
  const lastFitRef = useRef(0)
  const [fitScale, setFitScale] = useState(1)
  const [contentSize, setContentSize] = useState({ width: 24, height: 24 })
  const [pixelOffset, setPixelOffset] = useState({ x: 0, y: 0 })

  onFitScaleChangeRef.current = onFitScaleChange
  onZoomChangeRef.current = onZoomChange
  zoomRef.current = zoom

  useLayoutEffect(() => {
    const stage = stageRef.current
    const measure = measureRef.current
    if (!stage || !measure) return

    const update = () => {
      const child = measure.firstElementChild as HTMLElement | null
      const width = Math.max(measure.offsetWidth, measure.scrollWidth, child?.offsetWidth ?? 0, 1)
      const height = Math.max(measure.offsetHeight, measure.scrollHeight, child?.offsetHeight ?? 0, 1)
      setContentSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      )

      const availableWidth = Math.max(stage.clientWidth - PADDING, 1)
      const availableHeight = Math.max(stage.clientHeight - PADDING, 1)
      let next = Math.min(availableWidth / width, availableHeight / height)
      next = Math.min(next, isIcon ? ICON_FIT_CAP : 1)
      if (Math.abs(lastFitRef.current - next) < 0.001) return
      lastFitRef.current = next
      setFitScale(next)
      onFitScaleChangeRef.current?.(next)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    observer.observe(measure)
    if (measure.firstElementChild) observer.observe(measure.firstElementChild)
    return () => observer.disconnect()
  }, [isIcon])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const onWheel = (event: WheelEvent) => {
      if (!event.metaKey && !event.ctrlKey) return
      event.preventDefault()
      const current = zoomRef.current === 'fit' ? lastFitRef.current || 1 : zoomRef.current
      const next = clampZoom(current + (event.deltaY < 0 ? 0.25 : -0.25))
      onZoomChangeRef.current?.(next)
    }

    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])

  useHostContrast(measureRef, stageRef)

  const displayScale = zoom === 'fit' ? fitScale : zoom

  useLayoutEffect(() => {
    const frame = frameRef.current
    const stage = stageRef.current
    if (!frame || !stage) return
    const align = () => {
      const rect = frame.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      // Keep thin, symmetric component insets off fractional device-pixel origins.
      const x = Math.round(rect.x * dpr) / dpr - rect.x
      const y = Math.round(rect.y * dpr) / dpr - rect.y
      setPixelOffset(current => current.x === x && current.y === y ? current : { x, y })
    }
    align()
    const observer = new ResizeObserver(align)
    observer.observe(stage)
    observer.observe(frame)
    window.addEventListener('resize', align)
    return () => { observer.disconnect(); window.removeEventListener('resize', align) }
  }, [contentSize, displayScale])

  return (
    <div
      className="preview-stage"
      data-canvas="grouped"
      data-theme={theme}
      ref={stageRef}
    >
      <div
        className="preview-frame"
        ref={frameRef}
        style={{
          height: contentSize.height * displayScale,
          width: contentSize.width * displayScale,
        }}
      >
        <div
          className="preview-isolate"
          style={{
            zoom: displayScale,
            transform: `translate(${pixelOffset.x / displayScale}px, ${pixelOffset.y / displayScale}px)`,
          }}
        >
          <div className="preview-measure" data-theme={theme} ref={measureRef}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

export function formatZoomPercent(zoom: PreviewZoom, fitScale: number) {
  const value = zoom === 'fit' ? fitScale : zoom
  return `${Math.round(value * 100)}%`
}

export function stepZoom(zoom: PreviewZoom, fitScale: number, delta: number): number {
  const current = zoom === 'fit' ? fitScale : zoom
  return clampZoom(Math.round((current + delta) * 100) / 100)
}
