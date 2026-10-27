export function SwitchGraphic({ checked }: { checked: boolean }) {
  return (
    <svg className="yb-switch-graphic" viewBox="0 0 56 28" width={56} height={28} aria-hidden="true">
      <rect className="yb-switch-track" width={56} height={28} rx={14} />
      <rect className="yb-switch-thumb" x={checked ? 20 : 2} y={2} width={34} height={24} rx={12} />
    </svg>
  )
}
