import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, RouterProvider, type RouteObject } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { AppLayout } from '@/layout/AppLayout'
import { AuthLayout } from '@/layout/AuthLayout'
import { PublicLayout } from '@/layout/PublicLayout'
import { AssistantPage } from '@/pages/AssistantPage'
import { HomePage } from '@/pages/HomePage'
import { LeadsPage } from '@/pages/LeadsPage'
import { LoginPage, RegisterPage } from '@/pages/LoginPage'
import { MePage } from '@/pages/MePage'
import { ExtractionProgressPage, ExtractionReviewPage } from '@/pages/onboarding/ExtractionPages'
import { CreateCompanyPage, OnboardingChatPage, OnboardingFilesPage, OnboardingPage, OnboardingUrlPage } from '@/pages/onboarding/OnboardingPages'
import { SitePage } from '@/pages/SitePage'
import { GuestOnly, RequireAuth } from '@/session/guards'
import { SessionProvider } from '@/session/session'
import { Centered, Spinner, ToastProvider } from '@/ui'
import { ThemeProvider } from './theme'

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

const fallback = (
  <Centered>
    <Spinner />
  </Centered>
)

// 二级页面按路由分包（商机详情、官网编辑、开发信、设置中心、运营工作台），首屏只加载首页、登录 / 建档与四个主页面
function page<M extends Record<string, unknown>>(loader: () => Promise<M>, name: keyof M & string) {
  const Component = lazy(async () => ({ default: (await loader())[name] as ComponentType }))
  return (
    <Suspense fallback={fallback}>
      <Component />
    </Suspense>
  )
}
const site = () => import('@/pages/site/SitePages')
const outreach = () => import('@/pages/outreach/OutreachPages')
const draft = () => import('@/pages/outreach/DraftPage')
const extras = () => import('@/pages/me/AccountExtrasPages')
const ops = () => import('@/pages/ops/OpsPages')
const leadPages = () => import('@/pages/leads/LeadPages')
const account = () => import('@/pages/me/AccountPages')
const products = () => import('@/pages/me/ProductPages')
const profile = () => import('@/pages/me/ProfilePages')

const PolicyPageLazy = lazy(async () => ({ default: (await extras()).PolicyPage }))
function PolicyRoute({ kind }: { kind: 'privacy' | 'terms' }) {
  return (
    <Suspense fallback={fallback}>
      <PolicyPageLazy kind={kind} />
    </Suspense>
  )
}

/** 需要登录；needCompany 为 true 时还需要已选择企业。 */
const authed = (element: ReactNode, needCompany = true) => <RequireAuth needCompany={needCompany}>{element}</RequireAuth>

export const routes: RouteObject[] = [
  // 公开页面
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/privacy', element: <PolicyRoute kind="privacy" /> },
      { path: '/terms', element: <PolicyRoute kind="terms" /> },
      { path: '/data-request', element: page(extras, 'DataRequestPage') },
    ],
  },
  // 登录、注册、邀请与建档流程
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: <GuestOnly><LoginPage /></GuestOnly> },
      { path: '/register', element: <GuestOnly><RegisterPage /></GuestOnly> },
      { path: '/invite/:token', element: authed(page(account, 'InviteAcceptPage'), false) },
      { path: '/onboarding/company', element: authed(<CreateCompanyPage />, false) },
      { path: '/onboarding', element: authed(<OnboardingPage />) },
      { path: '/onboarding/url', element: authed(<OnboardingUrlPage />) },
      { path: '/onboarding/files', element: authed(<OnboardingFilesPage />) },
      { path: '/onboarding/chat', element: authed(<OnboardingChatPage />) },
      { path: '/extractions/:id', element: authed(<ExtractionProgressPage />) },
      { path: '/extractions/:id/review', element: authed(<ExtractionReviewPage />) },
    ],
  },
  // 工作台
  {
    element: authed(<AppLayout />, false),
    children: [
      { path: '/assistant', element: authed(<AssistantPage />) },
      { path: '/leads', element: authed(<LeadsPage />) },
      { path: '/leads/:id', element: authed(page(leadPages, 'LeadDetailPage')) },
      { path: '/leads/:id/draft', element: authed(page(draft, 'DraftPage')) },
      { path: '/me', element: authed(<MePage />) },
      { path: '/me/watches', element: authed(page(leadPages, 'WatchSettingsPage')) },
      { path: '/me/mail-accounts', element: authed(page(outreach, 'MailAccountsPage')) },
      { path: '/me/mail-accounts/new', element: authed(page(outreach, 'MailAccountNewPage')) },
      { path: '/me/reports', element: authed(page(outreach, 'ReportsPage')) },
      { path: '/me/reports/:id', element: authed(page(outreach, 'ReportDetailPage')) },
      { path: '/me/billing', element: authed(page(extras, 'BillingPage')) },
      { path: '/me/notifications', element: authed(page(extras, 'NotificationsPage')) },
      { path: '/me/notifications/settings', element: authed(page(extras, 'NotificationSettingsPage')) },
      { path: '/me/privacy', element: authed(page(extras, 'PrivacySettingsPage')) },
      { path: '/me/profile', element: authed(page(profile, 'ProfilePage')) },
      { path: '/me/profile/:section', element: authed(page(profile, 'ProfileSectionPage')) },
      { path: '/me/products', element: authed(page(products, 'ProductsPage')) },
      { path: '/me/products/:id', element: authed(page(products, 'ProductEditPage')) },
      { path: '/me/assets', element: authed(page(account, 'AssetsPage')) },
      { path: '/me/members', element: authed(page(account, 'MembersPage')) },
      { path: '/site', element: authed(<SitePage />) },
      { path: '/site/sections/:section', element: authed(page(site, 'SiteSectionPage')) },
      { path: '/site/preview', element: authed(page(site, 'SitePreviewPage')) },
      { path: '/site/template', element: authed(page(site, 'SiteTemplatePage')) },
      { path: '/site/domain', element: authed(page(site, 'SiteDomainPage')) },
      { path: '/site/versions', element: authed(page(site, 'SiteVersionsPage')) },
      { path: '/site/inquiries', element: authed(page(site, 'SiteInquiriesPage')) },
      { path: '/site/inquiries/:id', element: authed(page(site, 'SiteInquiryPage')) },
      { path: '/site/health', element: authed(page(site, 'SiteHealthPage')) },
      { path: '/ops', element: authed(page(ops, 'OpsHomePage'), false) },
      { path: '/ops/customers', element: authed(page(ops, 'OpsCustomersPage'), false) },
      { path: '/ops/customers/:id', element: authed(page(ops, 'OpsCustomerPage'), false) },
      { path: '/ops/review', element: authed(page(ops, 'OpsReviewPage'), false) },
      { path: '/ops/audit', element: authed(page(ops, 'OpsAuditPage'), false) },
      { path: '/ops/sources', element: authed(page(ops, 'OpsSourcesPage'), false) },
      { path: '/ops/costs', element: authed(page(ops, 'OpsCostsPage'), false) },
      { path: '/ops/evals', element: authed(page(ops, 'OpsEvalsPage'), false) },
      { path: '/ops/data-requests', element: authed(page(ops, 'OpsDataRequestsPage'), false) },
    ],
  },
  { path: '*', element: <Navigate replace to="/" /> },
]

const router = createBrowserRouter(routes)
const queryClient = createQueryClient()

export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export function App() {
  return (
    <AppProviders client={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  )
}
