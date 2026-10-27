// 本地缺口组件：密码输入框。
//
// 原因：正式 Form/SingleLine 渲染的 <input> 没有 type 属性，无法隐藏密码，也无法提示浏览器自动填充。
// 本组件只复用正式 Form/SingleLine 的 DOM 结构与 CSS 类（yb-form-wrap / yb-form-single / yb-form-value），
// 不新增任何视觉样式。登记位置：docs/ui-gaps.md「GAP-006」。
import { useId } from 'react'

interface SecureTextFieldProps {
  label: string
  value: string
  placeholder: string
  autoComplete: 'current-password' | 'new-password' | 'off'
  maxLength?: number
  onChange: (value: string) => void
  onSubmit?: () => void
}

export function SecureTextField({ label, value, placeholder, autoComplete, maxLength = 128, onChange, onSubmit }: SecureTextFieldProps) {
  const id = useId()
  return (
    <div className="yb-form-wrap">
      <label className="yb-form-label" htmlFor={id}>
        {label}
      </label>
      <div className="yb-form-single" data-align="left" data-input="on">
        <span className="yb-form-value">
          <input
            autoComplete={autoComplete}
            id={id}
            maxLength={maxLength}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) onSubmit?.()
            }}
            placeholder={placeholder}
            type="password"
            value={value}
          />
        </span>
      </div>
    </div>
  )
}
