import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, RouterProvider, type RouteObject } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { AppLayout } from '@/layout/AppLayout'
import { AuthLayout } from '@/layout/AuthLayout'
import { PublicLayout } from '@/layout/PublicLayout'
import { StartLayout } from '@/layout/StartLayout'
import { BuyerDetailPage, BuyersPage } from '@/pages/customer/BuyersPages'
import { CustomerHomePage } from '@/pages/customer/HomePage'
import { MaterialsPage } from '@/pages/customer/MaterialsPage'
import { MySitePage } from '@/pages/customer/MySitePage'
import { StartPage } from '@/pages/customer/StartPage'
import { HomePage } from '@/pages/HomePage'
import { LoginPage, RegisterPage } from '@/pages/LoginPage'
import { GuestOnly, RequireAuth, RequireStaff } from '@/session/guards'
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
// 运营代操作工具（客户看不到）
const assistant = () => import('@/pages/AssistantPage')
const leadsList = () => import('@/pages/LeadsPage')
const mePage = () => import('@/pages/MePage')
const sitePage = () => import('@/pages/SitePage')
const onboarding = () => import('@/pages/onboarding/OnboardingPages')
const extraction = () => import('@/pages/onboarding/ExtractionPages')

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
/** 只给运营人员（代操作工具）。 */
const staff = (element: ReactNode, needCompany = true) => <RequireStaff needCompany={needCompany}>{element}</RequireStaff>

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
  // 登录、注册、邀请
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: <GuestOnly><LoginPage /></GuestOnly> },
      { path: '/register', element: <GuestOnly><RegisterPage /></GuestOnly> },
      { path: '/invite/:token', element: authed(page(account, 'InviteAcceptPage'), false) },
      // 运营用：从网址 / 文件 / 文字自动整理工厂信息
      { path: '/onboarding', element: staff(page(onboarding, 'OnboardingPage')) },
      { path: '/onboarding/url', element: staff(page(onboarding, 'OnboardingUrlPage')) },
      { path: '/onboarding/files', element: staff(page(onboarding, 'OnboardingFilesPage')) },
      { path: '/onboarding/chat', element: staff(page(onboarding, 'OnboardingChatPage')) },
      { path: '/extractions/:id', element: staff(page(extraction, 'ExtractionProgressPage')) },
      { path: '/extractions/:id/review', element: staff(page(extraction, 'ExtractionReviewPage')) },
    ],
  },
  // 开通向导（客户）
  {
    element: authed(<StartLayout />, false),
    children: [{ path: '/start', element: <StartPage /> }],
  },
  { path: '/onboarding/company', element: <Navigate replace to="/start" /> },
  // 工作台
  {
    element: authed(<AppLayout />, false),
    children: [
      // 客户：四个入口 + 账号
      { path: '/home', element: authed(<CustomerHomePage />) },
      { path: '/my-site', element: authed(<MySitePage />) },
      { path: '/buyers', element: authed(<BuyersPage />) },
      { path: '/buyers/:id', element: authed(<BuyerDetailPage />) },
      { path: '/materials', element: authed(<MaterialsPage />) },
      { path: '/account/security', element: authed(page(extras, 'SecurityPage'), false) },
      { path: '/account/billing', element: authed(page(extras, 'BillingPage')) },
      { path: '/account/notifications', element: authed(page(extras, 'NotificationsPage')) },
      { path: '/account/notifications/settings', element: authed(page(extras, 'NotificationSettingsPage')) },
      // 运营代操作工具
      { path: '/assistant', element: staff(page(assistant, 'AssistantPage')) },
      { path: '/leads', element: staff(page(leadsList, 'LeadsPage')) },
      { path: '/leads/:id', element: staff(page(leadPages, 'LeadDetailPage')) },
      { path: '/leads/:id/draft', element: staff(page(draft, 'DraftPage')) },
      { path: '/me', element: staff(page(mePage, 'MePage')) },
      { path: '/me/watches', element: staff(page(leadPages, 'WatchSettingsPage')) },
      { path: '/me/mail-accounts', element: staff(page(outreach, 'MailAccountsPage')) },
      { path: '/me/mail-accounts/new', element: staff(page(outreach, 'MailAccountNewPage')) },
      { path: '/me/reports', element: staff(page(outreach, 'ReportsPage')) },
      { path: '/me/reports/:id', element: staff(page(outreach, 'ReportDetailPage')) },
      { path: '/me/billing', element: staff(page(extras, 'BillingPage')) },
      { path: '/me/notifications', element: staff(page(extras, 'NotificationsPage')) },
      { path: '/me/notifications/settings', element: staff(page(extras, 'NotificationSettingsPage')) },
      { path: '/me/privacy', element: staff(page(extras, 'PrivacySettingsPage')) },
      { path: '/me/security', element: <Navigate replace to="/account/security" /> },
      { path: '/me/profile', element: staff(page(profile, 'ProfilePage')) },
      { path: '/me/profile/:section', element: staff(page(profile, 'ProfileSectionPage')) },
      { path: '/me/products', element: staff(page(products, 'ProductsPage')) },
      { path: '/me/products/:id', element: staff(page(products, 'ProductEditPage')) },
      { path: '/me/assets', element: staff(page(account, 'AssetsPage')) },
      { path: '/me/members', element: staff(page(account, 'MembersPage')) },
      { path: '/site', element: staff(page(sitePage, 'SitePage')) },
      { path: '/site/sections/:section', element: staff(page(site, 'SiteSectionPage')) },
      { path: '/site/preview', element: staff(page(site, 'SitePreviewPage')) },
      { path: '/site/template', element: staff(page(site, 'SiteTemplatePage')) },
      { path: '/site/domain', element: staff(page(site, 'SiteDomainPage')) },
      { path: '/site/versions', element: staff(page(site, 'SiteVersionsPage')) },
      { path: '/site/inquiries', element: staff(page(site, 'SiteInquiriesPage')) },
      { path: '/site/inquiries/:id', element: staff(page(site, 'SiteInquiryPage')) },
      { path: '/site/health', element: staff(page(site, 'SiteHealthPage')) },
      { path: '/ops', element: authed(page(ops, 'OpsHomePage'), false) },
      { path: '/ops/customers', element: authed(page(ops, 'OpsCustomersPage'), false) },
      { path: '/ops/tasks', element: authed(page(ops, 'OpsTasksPage'), false) },
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
