// 登录 / 注册。信息不完整时主按钮置灰；格式错误与服务端错误走 Toast。
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, type SessionOut } from '@/api/endpoints'
import { useErrorToast } from '@/feedback/useErrorToast'
import { t } from '@/i18n'
import { AuthCard } from '@/layout/AuthLayout'
import { isEmail, passwordProblem } from '@/lib/validation'
import { useSession } from '@/session/session'
import { Button, PasswordField, TextField, useToast } from '@/ui'

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
      mode === 'login' ? api.login({ email: email.trim(), password }) : api.register({ email: email.trim(), password, name: name.trim() }),
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
    <AuthCard
      description={isLogin ? t.auth.loginDesc : t.auth.registerDesc}
      footer={
        <Link replace state={location.state} to={isLogin ? '/register' : '/login'}>
          {isLogin ? t.auth.toRegister : t.auth.toLogin}
        </Link>
      }
      title={isLogin ? t.auth.loginTitle : t.auth.registerTitle}
    >
      <form
        className="ui-form-stack"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {isLogin ? null : <TextField autoComplete="name" label={t.auth.name} maxLength={64} onChange={setName} placeholder={t.auth.namePlaceholder} value={name} />}
        <TextField autoComplete="email" inputMode="email" label={t.auth.email} maxLength={254} onChange={setEmail} placeholder={t.auth.emailPlaceholder} value={email} />
        <PasswordField
          autoComplete={isLogin ? 'current-password' : 'new-password'}
          label={t.auth.password}
          maxLength={128}
          onChange={setPassword}
          onSubmit={submit}
          placeholder={isLogin ? t.auth.passwordPlaceholder : t.auth.newPasswordPlaceholder}
          value={password}
        />
        <Button block disabled={!complete} loading={mutation.isPending} size="lg" type="submit" variant="primary">
          {isLogin ? t.auth.login : t.auth.register}
        </Button>
      </form>
    </AuthCard>
  )
}

export function LoginPage() {
  return <AuthPage mode="login" />
}

export function RegisterPage() {
  return <AuthPage mode="register" />
}
