import { useRef, type ComponentProps } from 'react'
import { useHostContrast } from './hostContrast'
import { DeviceOverlayProvider } from './DeviceOverlays'

export type CanvasRole = 'grouped' | 'primary'

interface HostCanvasProps extends ComponentProps<'section'> {
  canvasRole: CanvasRole
}

export function HostCanvas({ canvasRole, children, ...props }: HostCanvasProps) {
  const ref = useRef<HTMLElement>(null)
  useHostContrast(ref)

  return (
    <section
      {...props}
      data-canvas={canvasRole}
      ref={(node) => {
        ref.current = node
      }}
    >
      <DeviceOverlayProvider>{children}</DeviceOverlayProvider>
    </section>
  )
}
