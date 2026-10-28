import { Check, Eye, EyeOff } from 'lucide-react'
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

interface FieldShellProps {
  id: string
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  counter?: string
  className?: string
  children: ReactNode
}

/** 表单项外壳：标签、控件、说明 / 错误。 */
export function FieldShell({ id, label, hint, error, counter, className, children }: FieldShellProps) {
  return (
    <div className={cx('ui-field', error ? 'has-error' : undefined, className)}>
      {label ? (
        <label className="ui-field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      {children}
      {error || hint || counter ? (
        <div className="ui-field__foot">
          {error ? (
            <span className="ui-field__error" id={`${id}-msg`} role="alert">
              {error}
            </span>
          ) : hint ? (
            <span className="ui-field__hint" id={`${id}-msg`}>
              {hint}
            </span>
          ) : (
            <span />
          )}
          {counter ? <span className="ui-field__counter">{counter}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

type NativeInput = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size' | 'onSubmit' | 'prefix'>

export interface TextFieldProps extends NativeInput {
  label?: string
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  hint?: ReactNode
  error?: ReactNode
  prefix?: ReactNode
  suffix?: ReactNode
  fieldClassName?: string
}

export function TextField({ label, value, onChange, onSubmit, hint, error, prefix, suffix, fieldClassName, id, placeholder, className, ...rest }: TextFieldProps) {
  const auto = useId()
  const inputId = id ?? auto
  return (
    <FieldShell className={fieldClassName} error={error} hint={hint} id={inputId} label={label}>
      <div className={cx('ui-input', className)}>
        {prefix ? <span className="ui-input__affix">{prefix}</span> : null}
        <input
          {...rest}
          aria-describedby={hint || error ? `${inputId}-msg` : undefined}
          aria-invalid={error ? true : undefined}
          aria-label={label ? undefined : placeholder}
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && onSubmit) {
              event.preventDefault()
              onSubmit()
            }
            rest.onKeyDown?.(event)
          }}
          placeholder={placeholder}
          value={value}
        />
        {suffix ? <span className="ui-input__affix">{suffix}</span> : null}
      </div>
    </FieldShell>
  )
}

export function PasswordField(props: Omit<TextFieldProps, 'type' | 'suffix'>) {
  const [visible, setVisible] = useState(false)
  return (
    <TextField
      {...props}
      suffix={
        <button
          aria-label={visible ? '隐藏密码' : '显示密码'}
          className="ui-input__toggle"
          onClick={() => setVisible((v) => !v)}
          type="button"
        >
          {visible ? <EyeOff aria-hidden size={16} /> : <Eye aria-hidden size={16} />}
        </button>
      }
      type={visible ? 'text' : 'password'}
    />
  )
}

export interface TextAreaProps {
  label?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  rows?: number
  hint?: ReactNode
  error?: ReactNode
  showCount?: boolean
  className?: string
  id?: string
  disabled?: boolean
}

export function TextArea({ label, value, onChange, placeholder, maxLength, rows = 4, hint, error, showCount, className, id, disabled }: TextAreaProps) {
  const auto = useId()
  const inputId = id ?? auto
  return (
    <FieldShell
      className={className}
      counter={showCount && maxLength ? `${value.length} / ${maxLength}` : undefined}
      error={error}
      hint={hint}
      id={inputId}
      label={label}
    >
      <textarea
        aria-invalid={error ? true : undefined}
        aria-label={label ? undefined : placeholder}
        className="ui-textarea"
        disabled={disabled}
        id={inputId}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        value={value}
      />
    </FieldShell>
  )
}

export interface SelectOption<T extends string> {
  value: T
  label: string
}

export interface SelectProps<T extends string> {
  label?: string
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  hint?: ReactNode
  className?: string
}

export function Select<T extends string>({ label, value, options, onChange, hint, className }: SelectProps<T>) {
  const id = useId()
  return (
    <FieldShell className={className} hint={hint} id={id} label={label}>
      <div className="ui-input ui-select">
        <select id={id} onChange={(event) => onChange(event.target.value as T)} value={value}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </FieldShell>
  )
}

export interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  ariaLabel?: string
  disabled?: boolean
  className?: string
}

export function Checkbox({ checked, onChange, label, ariaLabel, disabled, className }: CheckboxProps) {
  return (
    <label className={cx('ui-check', disabled && 'is-disabled', className)}>
      <input
        aria-label={ariaLabel}
        checked={checked}
        className="ui-check__input"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span aria-hidden className="ui-check__box">
        {checked ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      {label ? <span className="ui-check__label">{label}</span> : null}
    </label>
  )
}

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  showLabel?: boolean
}

export function Switch({ checked, onChange, label, disabled, showLabel }: SwitchProps) {
  return (
    <span className="ui-switch-wrap">
      {showLabel ? <span className="ui-switch__text">{label}</span> : null}
      <button
        aria-checked={checked}
        aria-label={label}
        className={cx('ui-switch', checked && 'is-on')}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span aria-hidden className="ui-switch__knob" />
      </button>
    </span>
  )
}
