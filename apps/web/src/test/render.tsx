import { render, type RenderOptions } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { AppProviders, createQueryClient, routes as appRoutes } from '@/app/App'

/** 用与生产相同的外壳（严格渲染策略 + 会话 + HostCanvas + Toast）渲染组件。 */
export function renderWithShell(ui: ReactElement, options?: RenderOptions & { client?: QueryClient }) {
  const client = options?.client ?? createQueryClient()
  client.setDefaultOptions({ queries: { retry: false, staleTime: 0 }, mutations: { retry: false } })
  const result = render(<AppProviders client={client}>{ui}</AppProviders>, options)
  return { client, ...result }
}

/** 在内存路由中渲染（默认使用应用的全部路由），返回 router 以便断言跳转。 */
export function renderRoutes(initialPath: string, routes: RouteObject[] = appRoutes) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] })
  const result = renderWithShell(<RouterProvider router={router} />)
  return { router, ...result }
}
