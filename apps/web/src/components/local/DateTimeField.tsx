// 本地缺口组件：日期时间输入框。
//
// 原因：正式 Form/SingleLine 渲染的 <input> 没有 type 属性，无法调起系统的日期时间选择器。
// 本组件只复用正式 Form/SingleLine 的 DOM 结构与 CSS 类（yb-form-wrap / yb-form-single / yb-form-value），
// 不新增任何视觉样式。登记位置：docs/ui-gaps.md「GAP-013」。
import { useId } from 'react'

interface DateTimeFieldProps {
  label: string
  value: string // datetime-local 格式：YYYY-MM-DDTHH:mm
  onChange: (value: string) => void
}

export function DateTimeField({ label, value, onChange }: DateTimeFieldProps) {
  const id = useId()
  return (
    <div className="yb-form-wrap">
      <label className="yb-form-label" htmlFor={id}>
        {label}
      </label>
      <div className="yb-form-single" data-align="left" data-input="on">
        <span className="yb-form-value">
          <input id={id} onChange={(event) => onChange(event.target.value)} type="datetime-local" value={value} />
        </span>
      </div>
    </div>
  )
}

/** Date → datetime-local 输入值（本地时间）。 */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
