// 登录态：token 与当前企业 ID 存在 localStorage；用户信息通过 /auth/me 获取（TanStack Query 缓存）。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { configureApi } from '@/api/client'
import { api, type CompanyBrief, type SessionOut, type User } from '@/api/endpoints'

const TOKEN_KEY = 'aicmo.token'
const COMPANY_KEY = 'aicmo.company'

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // 隐私模式等场景下 localStorage 不可用：只在内存中保存
  }
}

export interface SessionState {
  token: string | null
  user: User | null
  /** 正在获取用户信息（有 token 但尚未拿到 /auth/me） */
  loading: boolean
  company: CompanyBrief | null
  signIn: (session: SessionOut) => void
  signOut: () => void
  selectCompany: (companyId: string) => void
  refresh: () => Promise<unknown>
}

const SessionContext = createContext<SessionState | null>(null)

export const ME_QUERY_KEY = ['auth', 'me'] as const

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState<string | null>(() => read(TOKEN_KEY))
  const [companyId, setCompanyId] = useState<string | null>(() => read(COMPANY_KEY))

  const signOut = useCallback(() => {
    write(TOKEN_KEY, null)
    write(COMPANY_KEY, null)
    setToken(null)
    setCompanyId(null)
    queryClient.clear()
  }, [queryClient])

  // 用 layout effect：父组件的 layout effect 先于子组件的数据请求（passive effect）执行，
  // 保证首次请求就带上 token 与当前企业头。
  useLayoutEffect(() => {
    configureApi({
      getToken: () => read(TOKEN_KEY),
      getCompanyId: () => read(COMPANY_KEY),
      onUnauthorized: () => {
        if (read(TOKEN_KEY)) signOut()
      },
    })
  }, [signOut])

  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: api.me, enabled: Boolean(token), staleTime: 60_000 })
  const user = token ? (me.data ?? null) : null

  // 当前企业：优先使用保存的选择；不存在或已无权限时回退到第一个企业。
  const company = useMemo(() => {
    if (!user) return null
    return user.companies.find((c) => c.id === companyId) ?? user.companies[0] ?? null
  }, [user, companyId])

  useLayoutEffect(() => {
    if (company && company.id !== read(COMPANY_KEY)) {
      write(COMPANY_KEY, company.id)
      setCompanyId(company.id)
    }
  }, [company])

  const signIn = useCallback(
    (session: SessionOut) => {
      write(TOKEN_KEY, session.token)
      queryClient.clear()
      queryClient.setQueryData(ME_QUERY_KEY, session.user)
      const first = session.user.companies[0]?.id ?? null
      write(COMPANY_KEY, first)
      setCompanyId(first)
      setToken(session.token)
    },
    [queryClient],
  )

  const selectCompany = useCallback(
    (id: string) => {
      write(COMPANY_KEY, id)
      setCompanyId(id)
      // 切换企业后，所有企业范围的数据都需要重新获取
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' })
    },
    [queryClient],
  )

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }), [queryClient])

  const value = useMemo<SessionState>(
    () => ({
      token,
      user,
      loading: Boolean(token) && me.isPending,
      company,
      signIn,
      signOut,
      selectCompany,
      refresh,
    }),
    [token, user, me.isPending, company, signIn, signOut, selectCompany, refresh],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession 必须在 SessionProvider 内使用')
  return value
}
