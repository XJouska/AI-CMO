import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, Radar, Users, MessageSquare, BarChart3, Shield, ArrowRight, Sparkles, Globe, Sun, Moon } from 'lucide-react';
import LoginModal from '../components/LoginModal';
import { useAuthStore } from '../stores/authStore';

export default function LandingPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, login, register } = useAuthStore();
  const [showLogin, setShowLogin] = useState(false);
  const [url, setUrl] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  const handleStart = () => {
    if (user) {
      navigate('/analyze', { state: { initialInput: url } });
    } else {
      setShowLogin(true);
    }
  };

  const features = [
    { icon: Search, title: t('landing.featureSEO'), desc: t('landing.featureSEODesc') },
    { icon: Radar, title: t('landing.featureGEO'), desc: t('landing.featureGEODesc') },
    { icon: BarChart3, title: t('landing.featureAnalysis'), desc: t('landing.featureAnalysisDesc') },
    { icon: Users, title: t('landing.featureCompetitors'), desc: t('landing.featureCompetitorsDesc') },
    { icon: MessageSquare, title: t('landing.featureChat'), desc: t('landing.featureChatDesc') },
    { icon: Shield, title: t('landing.featureMonitor'), desc: t('landing.featureMonitorDesc') },
  ];

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <span className="header-logo">🚀 AI-CMO</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('common.tagline')}</span>
        </div>
        <div className="header-right">
          <button className="btn-icon" onClick={() => i18n.changeLanguage(i18n.language.startsWith('zh') ? 'en' : 'zh')}><Globe size={18} /></button>
          <button className="btn-icon" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {user ? (
            <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>
              {t('nav.dashboard')} <ArrowRight size={14} />
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => setShowLogin(true)}>
              {t('auth.login')}
            </button>
          )}
        </div>
      </header>

      <div className="landing-page">
        <section className="landing-hero">
          <div className="landing-hero-badge">
            <Sparkles size={14} /> {t('landing.badge')}
          </div>
          <h1>{t('landing.title')}</h1>
          <p>{t('landing.subtitle')}</p>
          <div className="landing-search">
            <input type="text" value={url} onChange={e => setUrl(e.target.value)}
              placeholder={t('landing.searchPlaceholder')}
              onKeyDown={e => e.key === 'Enter' && url.trim() && handleStart()} />
            <button className="btn btn-primary" onClick={handleStart} disabled={!url.trim()}>
              {t('landing.startAnalysis')} <ArrowRight size={14} />
            </button>
          </div>
        </section>

        <section className="landing-features">
          <h2>{t('landing.featuresTitle')}</h2>
          <div className="landing-features-grid">
            {features.map((f, i) => (
              <div key={i} className="landing-feature-card">
                <div className="landing-feature-icon"><f.icon size={24} /></div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {showLogin && (
        <LoginModal onClose={() => setShowLogin(false)}
          onLogin={async (email, pwd) => { await login(email, pwd); navigate('/dashboard'); }}
          onRegister={async (u, e, p, r, l) => { await register(u, e, p, r, l); navigate('/dashboard'); }} />
      )}
    </div>
  );
}
