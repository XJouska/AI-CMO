import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles/globals.css';
import './i18n';
import { useAuthStore } from './stores/authStore';

const MainLayout = lazy(() => import('./layouts/MainLayout'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AnalyzePage = lazy(() => import('./pages/AnalyzePage'));
const CompetitorsPage = lazy(() => import('./pages/CompetitorsPage'));
const GEOPage = lazy(() => import('./pages/GEOPage'));
const SEOPage = lazy(() => import('./pages/SEOPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const PricingPage = lazy(() => import('./pages/PricingPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const APIDocsPage = lazy(() => import('./pages/APIDocsPage'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user);
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user);
  if (!user) return <Navigate to="/" replace />;
  if (!user.is_admin && user.email !== 'lixin.time@gmail.com') return <Navigate to="/analyze" replace />;
  return <>{children}</>;
}

function App() {
  const user = useAuthStore(s => s.user);

  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={user ? <Navigate to="/analyze" replace /> : <LandingPage />} />
          <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/analyze" element={<AnalyzePage />} />
            <Route path="/analyze/:conversationId" element={<AnalyzePage />} />
            <Route path="/competitors" element={<CompetitorsPage />} />
            <Route path="/geo" element={<GEOPage />} />
            <Route path="/seo" element={<SEOPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/api-docs" element={<APIDocsPage />} />
            <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
