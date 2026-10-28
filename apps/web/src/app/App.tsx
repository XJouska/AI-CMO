import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RenderPolicyProvider } from '@yb/library/RenderPolicy'
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { Loading } from '@yb/generated/components'
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

// 低频页面按路由分包（官网编辑、开发信、运营工作台、账户设置），首屏只加载四个 Tab 与登录 / 建档流程
function page<M extends Record<string, unknown>>(loader: () => Promise<M>, name: keyof M & string) {
  const Component = lazy(async () => ({ default: (await loader())[name] as ComponentType }))
  return (
    <Suspense
      fallback={
        <div className="page-empty">
          <Loading>{''}</Loading>
        </div>
      }
    >
      <Component />
    </Suspense>
  )
}
const site = () => import('@/pages/site/SitePages')
const outreach = () => import('@/pages/outreach/OutreachPages')
const draft = () => import('@/pages/outreach/DraftPage')
const extras = () => import('@/pages/me/AccountExtrasPages')
const ops = () => import('@/pages/ops/OpsPages')

const PolicyPageLazy = lazy(async () => ({ default: (await extras()).PolicyPage }))
function PolicyRoute({ kind }: { kind: 'privacy' | 'terms' }) {
  return (
    <Suspense fallback={null}>
      <PolicyPageLazy kind={kind} />
    </Suspense>
  )
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
  { path: '/leads/:id/draft', element: authed(page(draft, 'DraftPage')) },
  { path: '/me/watches', element: authed(<WatchSettingsPage />) },
  { path: '/me/mail-accounts', element: authed(page(outreach, 'MailAccountsPage')) },
  { path: '/me/mail-accounts/new', element: authed(page(outreach, 'MailAccountNewPage')) },
  { path: '/me/reports', element: authed(page(outreach, 'ReportsPage')) },
  { path: '/me/reports/:id', element: authed(page(outreach, 'ReportDetailPage')) },
  { path: '/me/billing', element: authed(page(extras, 'BillingPage')) },
  { path: '/me/notifications', element: authed(page(extras, 'NotificationsPage')) },
  { path: '/me/notifications/settings', element: authed(page(extras, 'NotificationSettingsPage')) },
  { path: '/me/privacy', element: authed(page(extras, 'PrivacySettingsPage')) },
  { path: '/ops', element: authed(page(ops, 'OpsHomePage'), false) },
  { path: '/ops/customers', element: authed(page(ops, 'OpsCustomersPage'), false) },
  { path: '/ops/customers/:id', element: authed(page(ops, 'OpsCustomerPage'), false) },
  { path: '/ops/review', element: authed(page(ops, 'OpsReviewPage'), false) },
  { path: '/ops/audit', element: authed(page(ops, 'OpsAuditPage'), false) },
  { path: '/ops/sources', element: authed(page(ops, 'OpsSourcesPage'), false) },
  { path: '/ops/costs', element: authed(page(ops, 'OpsCostsPage'), false) },
  { path: '/ops/evals', element: authed(page(ops, 'OpsEvalsPage'), false) },
  { path: '/ops/data-requests', element: authed(page(ops, 'OpsDataRequestsPage'), false) },
  { path: '/site', element: authed(<SitePage />) },
  { path: '/site/sections/:section', element: authed(page(site, 'SiteSectionPage')) },
  { path: '/site/preview', element: authed(page(site, 'SitePreviewPage')) },
  { path: '/site/template', element: authed(page(site, 'SiteTemplatePage')) },
  { path: '/site/domain', element: authed(page(site, 'SiteDomainPage')) },
  { path: '/site/versions', element: authed(page(site, 'SiteVersionsPage')) },
  { path: '/site/inquiries', element: authed(page(site, 'SiteInquiriesPage')) },
  { path: '/site/inquiries/:id', element: authed(page(site, 'SiteInquiryPage')) },
  { path: '/site/health', element: authed(page(site, 'SiteHealthPage')) },
  { path: '/me', element: authed(<MePage />) },
  { path: '/me/profile', element: authed(<ProfilePage />) },
  { path: '/me/profile/:section', element: authed(<ProfileSectionPage />) },
  { path: '/me/products', element: authed(<ProductsPage />) },
  { path: '/me/products/:id', element: authed(<ProductEditPage />) },
  { path: '/me/assets', element: authed(<AssetsPage />) },
  { path: '/me/members', element: authed(<MembersPage />) },
  // 公开页面（无需登录）
  { path: '/privacy', element: <PolicyRoute kind="privacy" /> },
  { path: '/terms', element: <PolicyRoute kind="terms" /> },
  { path: '/data-request', element: page(extras, 'DataRequestPage') },
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
