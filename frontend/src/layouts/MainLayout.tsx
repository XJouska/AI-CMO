import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard, Search, Users, Radar, Shield, Settings, LogOut, Coins, Globe,
  Sun, Moon, ChevronLeft, ChevronRight, Plus, Trash2, Lock, BookOpen
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useHistoryStore } from '../stores/historyStore';
import PricingModal from '../components/PricingModal';


export default function MainLayout() {
  const { t, i18n } = useTranslation();
  const { user, logout, refreshUser } = useAuthStore();
  const { conversations, fetchHistory, deleteConversation } = useHistoryStore();
  const navigate = useNavigate();
  const [showPricing, setShowPricing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (user) {
      fetchHistory();
      refreshUser();
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const handler = () => { logout(); navigate('/'); };
    window.addEventListener('auth-expired', handler);
    return () => window.removeEventListener('auth-expired', handler);
  }, []);

  const toggleLang = () => {
    i18n.changeLanguage(i18n.language.startsWith('zh') ? 'en' : 'zh');
  };

  const isAdmin = user?.is_admin || user?.email === 'lixin.time@gmail.com';

  const navItems = [
    { to: '/analyze', icon: Search, label: t('nav.analyze') },
    { to: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard') },
    { to: '/competitors', icon: Users, label: t('nav.competitors') },
    { to: '/seo', icon: Shield, label: t('nav.seo') },
    { to: '/geo', icon: Radar, label: t('nav.geo') },
    { to: '/settings', icon: Settings, label: t('nav.settings') },
    { to: '/api-docs', icon: BookOpen, label: 'API Docs' },
    ...(isAdmin ? [{ to: '/admin', icon: Lock, label: 'Admin' }] : []),
  ];

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="header-logo" onClick={() => navigate('/analyze')} style={{ cursor: 'pointer' }}>
            <img src="/logo.png?v=2" alt="AI-CMO" style={{ width: 24, height: 24, borderRadius: 4, verticalAlign: 'middle', marginRight: 6, background: 'transparent' }} />
            AI-CMO
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('common.tagline')}</span>
        </div>
        <div className="header-right">
          <button className="btn-icon" onClick={toggleLang} title="Language"><Globe size={18} /></button>
          <button className="btn-icon" onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')} title="Toggle theme">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {user && (
            <>
              <div className="credit-badge" onClick={() => navigate('/pricing')}>
                <Coins size={14} /> {user.credit_balance ?? 0}
              </div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{user.username}</span>
              <button className="btn-icon" onClick={() => { logout(); navigate('/'); }} title={t('auth.logout')}>
                <LogOut size={18} />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="main-layout">
        <nav className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <div className="sidebar-nav">
            {navItems.map(item => (
              <NavLink key={item.to} to={item.to}
                className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
                <item.icon size={18} />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </NavLink>
            ))}
          </div>

          {!sidebarCollapsed && (
            <>
              <div className="sidebar-divider" />
              <div className="sidebar-section-title">
                <span>{t('chat.history')}</span>
                <button className="btn-icon" onClick={() => navigate('/analyze')} title={t('chat.newAnalysis')}>
                  <Plus size={14} />
                </button>
              </div>
              <div className="sidebar-filter">
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search..." className="sidebar-search" />
              </div>
              <div className="sidebar-list">
                {conversations
                  .filter(c => !searchQuery || c.title.toLowerCase().includes(searchQuery.toLowerCase()))
                  .slice(0, 15).length === 0 ? (
                  <div className="sidebar-empty">{t('chat.noHistory')}</div>
                ) : (
                  conversations
                    .filter(c => !searchQuery || c.title.toLowerCase().includes(searchQuery.toLowerCase()))
                    .slice(0, 15).map(conv => (
                    <div key={conv.id} className="sidebar-item"
                      onClick={() => navigate(`/analyze/${conv.id}`)}>
                      <div className="sidebar-item-left">
                        {conv.status === 'analyzing' && <span className="sidebar-loading-dots"><span /><span /><span /></span>}
                        <span className="sidebar-item-title">{conv.title}</span>
                      </div>
                      <div className="sidebar-item-right">
                        <button className="btn-icon" style={{ padding: '0.2rem' }}
                          onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          <div className="sidebar-footer">
            <button className="btn-icon sidebar-collapse-btn"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
              {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
        </nav>

        <main className="main-content">
          <Outlet />
        </main>
      </div>

      {showPricing && <PricingModal onClose={() => setShowPricing(false)} balance={user?.credit_balance ?? 0} onBalanceUpdate={refreshUser} />}
    </div>
  );
}
