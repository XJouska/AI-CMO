import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RenderPolicyProvider } from '@yb/library/RenderPolicy'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { AssistantPage } from '@/pages/AssistantPage'
import { LeadsPage } from '@/pages/LeadsPage'
import { LoginPage } from '@/pages/LoginPage'
import { MePage } from '@/pages/MePage'
import { SitePage } from '@/pages/SitePage'
import { AppShell } from './AppShell'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // 4xx 是确定性错误，不重试；网络错误和 5xx 最多重试一次。
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
    },
  },
})

const router = createBrowserRouter([
  { path: '/', element: <Navigate replace to="/assistant" /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/assistant', element: <AssistantPage /> },
  { path: '/leads', element: <LeadsPage /> },
  { path: '/site', element: <SitePage /> },
  { path: '/me', element: <MePage /> },
  { path: '*', element: <Navigate replace to="/assistant" /> },
])

export function App() {
  return (
    // 严格模式：组件缺少渲染器或属性值非法时直接报错，不静默降级。
    <RenderPolicyProvider policy="deliverable-strict">
      <QueryClientProvider client={queryClient}>
        <AppShell>
          <RouterProvider router={router} />
        </AppShell>
      </QueryClientProvider>
    </RenderPolicyProvider>
  )
}
