import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RenderPolicyProvider } from '@yb/library/RenderPolicy'
import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate, RouterProvider, type RouteObject } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { AssistantPage } from '@/pages/AssistantPage'
import { LeadsPage } from '@/pages/LeadsPage'
import { LeadDetailPage, WatchSettingsPage } from '@/pages/leads/LeadPages'
import { LoginPage, RegisterPage } from '@/pages/LoginPage'
import { MePage } from '@/pages/MePage'
import { AssetsPage, InviteAcceptPage, MembersPage } from '@/pages/me/AccountPages'
import { ProductEditPage, ProductsPage } from '@/pages/me/ProductPages'
import { ProfilePage, ProfileSectionPage } from '@/pages/me/ProfilePages'
import { ExtractionProgressPage, ExtractionReviewPage } from '@/pages/onboarding/ExtractionPages'
import {
  CreateCompanyPage,
  OnboardingChatPage,
  OnboardingFilesPage,
  OnboardingPage,
  OnboardingUrlPage,
} from '@/pages/onboarding/OnboardingPages'
import { SitePage } from '@/pages/SitePage'
import {
  SiteDomainPage,
  SiteHealthPage,
  SiteInquiriesPage,
  SiteInquiryPage,
  SitePreviewPage,
  SiteSectionPage,
  SiteTemplatePage,
  SiteVersionsPage,
} from '@/pages/site/SitePages'
import { GuestOnly, RequireAuth } from '@/session/guards'
import { SessionProvider } from '@/session/session'
import { AppShell } from './AppShell'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // 4xx 是确定性错误，不重试；网络错误和 5xx 最多重试一次。
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
      },
    },
  })
}

const authed = (element: ReactNode, needCompany = true) => <RequireAuth needCompany={needCompany}>{element}</RequireAuth>

export const routes: RouteObject[] = [
  { path: '/', element: <Navigate replace to="/assistant" /> },
  { path: '/login', element: <GuestOnly><LoginPage /></GuestOnly> },
  { path: '/register', element: <GuestOnly><RegisterPage /></GuestOnly> },
  { path: '/invite/:token', element: authed(<InviteAcceptPage />, false) },
  { path: '/onboarding/company', element: authed(<CreateCompanyPage />, false) },
  { path: '/onboarding', element: authed(<OnboardingPage />) },
  { path: '/onboarding/url', element: authed(<OnboardingUrlPage />) },
  { path: '/onboarding/files', element: authed(<OnboardingFilesPage />) },
  { path: '/onboarding/chat', element: authed(<OnboardingChatPage />) },
  { path: '/extractions/:id', element: authed(<ExtractionProgressPage />) },
  { path: '/extractions/:id/review', element: authed(<ExtractionReviewPage />) },
  { path: '/assistant', element: authed(<AssistantPage />) },
  { path: '/leads', element: authed(<LeadsPage />) },
  { path: '/leads/:id', element: authed(<LeadDetailPage />) },
  { path: '/me/watches', element: authed(<WatchSettingsPage />) },
  { path: '/site', element: authed(<SitePage />) },
  { path: '/site/sections/:section', element: authed(<SiteSectionPage />) },
  { path: '/site/preview', element: authed(<SitePreviewPage />) },
  { path: '/site/template', element: authed(<SiteTemplatePage />) },
  { path: '/site/domain', element: authed(<SiteDomainPage />) },
  { path: '/site/versions', element: authed(<SiteVersionsPage />) },
  { path: '/site/inquiries', element: authed(<SiteInquiriesPage />) },
  { path: '/site/inquiries/:id', element: authed(<SiteInquiryPage />) },
  { path: '/site/health', element: authed(<SiteHealthPage />) },
  { path: '/me', element: authed(<MePage />) },
  { path: '/me/profile', element: authed(<ProfilePage />) },
  { path: '/me/profile/:section', element: authed(<ProfileSectionPage />) },
  { path: '/me/products', element: authed(<ProductsPage />) },
  { path: '/me/products/:id', element: authed(<ProductEditPage />) },
  { path: '/me/assets', element: authed(<AssetsPage />) },
  { path: '/me/members', element: authed(<MembersPage />) },
  { path: '*', element: <Navigate replace to="/assistant" /> },
]

const router = createBrowserRouter(routes)
const queryClient = createQueryClient()

export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    // 严格模式：组件缺少渲染器或属性值非法时直接报错，不静默降级。
    <RenderPolicyProvider policy="deliverable-strict">
      <QueryClientProvider client={client}>
        <SessionProvider>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </QueryClientProvider>
    </RenderPolicyProvider>
  )
}

export function App() {
  return (
    <AppProviders client={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  )
}
