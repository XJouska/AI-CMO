import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RenderPolicyProvider } from '@yb/library/RenderPolicy'
import type { ReactElement, ReactNode } from 'react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/app/AppShell'

/** 用与生产相同的外壳（严格渲染策略 + HostCanvas + Toast）渲染组件。 */
export function renderWithShell(ui: ReactElement, options?: RenderOptions) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RenderPolicyProvider policy="deliverable-strict">
        <QueryClientProvider client={client}>
          <AppShell>{children}</AppShell>
        </QueryClientProvider>
      </RenderPolicyProvider>
    )
  }
  return { client, ...render(ui, { wrapper: Wrapper, ...options }) }
}

/** 在内存路由中渲染页面，返回 router 以便断言跳转。 */
export function renderRoutes(routes: RouteObject[], initialPath: string) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] })
  const result = renderWithShell(<RouterProvider router={router} />)
  return { router, ...result }
}
