// 登录 / 注册。规范 form-validation-timing：信息不完整时主按钮置灰；格式错误与服务端错误只走 Toast。
import { useMutation } from '@tanstack/react-query'
import { Button, FormSingleLine } from '@yb/generated/components'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, type SessionOut } from '@/api/endpoints'
import { SecureTextField } from '@/components/local/SecureTextField'
import { StackPage } from '@/components/local/StackPage'
import { useToast } from '@/feedback/toast'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { isEmail, passwordProblem } from '@/lib/validation'
import { useSession } from '@/session/session'

type Mode = 'login' | 'register'

export function nextPathAfterAuth(session: SessionOut, from: string | undefined): string {
  if (session.user.companies.length === 0) return '/onboarding/company'
  return from && from.startsWith('/') && !from.startsWith('//') ? from : '/assistant'
}

export function AuthPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const session = useSession()
  const toast = useToast()
  const showError = useErrorToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  const from = (location.state as { from?: string } | null)?.from
  const complete = email.trim() !== '' && password !== '' && (mode === 'login' || name.trim() !== '')

  const mutation = useMutation({
    mutationFn: () =>
      mode === 'login'
        ? api.login({ email: email.trim(), password })
        : api.register({ email: email.trim(), password, name: name.trim() }),
    onSuccess: (result) => {
      session.signIn(result)
      navigate(nextPathAfterAuth(result, from), { replace: true })
    },
    onError: showError,
  })

  function submit() {
    if (!complete || mutation.isPending) return
    if (!isEmail(email)) return toast.show(t.auth.invalidEmail)
    if (mode === 'register') {
      const problem = passwordProblem(password)
      if (problem === 'tooShort') return toast.show(t.auth.passwordTooShort)
      if (problem === 'needMix') return toast.show(t.auth.passwordNeedMix)
    }
    mutation.mutate()
  }

  const isLogin = mode === 'login'
  return (
    <StackPage
      footer={
        <div className="form-actions">
          <Button
            onAction={(action) => action === 'press' && submit()}
            size="L"
            state={complete && !mutation.isPending ? 'Default' : 'Disable'}
            type="Primary"
          >
            {isLogin ? t.auth.login : t.auth.register}
          </Button>
          <Button
            onAction={(action) => action === 'press' && navigate(isLogin ? '/register' : '/login', { replace: true, state: location.state })}
            size="M"
            type="Text"
          >
            {isLogin ? t.auth.toRegister : t.auth.toLogin}
          </Button>
        </div>
      }
      noBack
      surface="primary"
      title={isLogin ? t.auth.loginTitle : t.auth.registerTitle}
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {isLogin ? null : (
          <FormSingleLine align="left" label={t.auth.name} maxLength={64} onChange={setName} placeholder={t.auth.namePlaceholder} value={name} />
        )}
        <FormSingleLine align="left" label={t.auth.email} maxLength={254} onChange={setEmail} placeholder={t.auth.emailPlaceholder} value={email} />
        <SecureTextField
          autoComplete={isLogin ? 'current-password' : 'new-password'}
          label={t.auth.password}
          onChange={setPassword}
          onSubmit={submit}
          placeholder={isLogin ? t.auth.passwordPlaceholder : t.auth.newPasswordPlaceholder}
          value={password}
        />
      </form>
    </StackPage>
  )
}

export function LoginPage() {
  return <AuthPage mode="login" />
}

export function RegisterPage() {
  return <AuthPage mode="register" />
}
