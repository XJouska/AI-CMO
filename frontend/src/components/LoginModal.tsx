import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Globe } from 'lucide-react';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
];

interface LoginModalProps {
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (username: string, email: string, password: string, referralCode?: string, responseLang?: string) => Promise<void>;
}

export default function LoginModal({ onClose, onLogin, onRegister }: LoginModalProps) {
  const { t } = useTranslation();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [responseLang, setResponseLang] = useState('en');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        await onRegister(username, email, password, referralCode || undefined, responseLang);
      } else {
        await onLogin(email, password);
      }
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || (err instanceof Error ? err.message : 'Error');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>{isRegister ? t('auth.register') : t('auth.login')}</h2>
          <button className="btn-icon" onClick={onClose}><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          {isRegister && (
            <div className="form-group">
              <label>{t('auth.username')}</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} required />
            </div>
          )}

          <div className="form-group">
            <label>{t('auth.email')}</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>

          <div className="form-group">
            <label>{t('auth.password')}</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
          </div>

          {isRegister && (
            <>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Globe size={14} />
                  {t('auth.responseLang') || 'Response Language'}
                </label>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.4rem',
                }}>
                  {LANGUAGES.map(lang => (
                    <button type="button" key={lang.code}
                      onClick={() => setResponseLang(lang.code)}
                      style={{
                        padding: '0.5rem 0.6rem',
                        background: responseLang === lang.code ? 'rgba(255, 59, 59, 0.15)' : 'var(--bg-elevated)',
                        border: responseLang === lang.code ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        color: responseLang === lang.code ? 'var(--text-primary)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontFamily: 'inherit',
                        display: 'flex', alignItems: 'center', gap: '0.4rem',
                        transition: 'all 0.15s ease',
                      }}>
                      <span>{lang.flag}</span>
                      <span>{lang.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>{t('auth.referralCode')}</label>
                <input type="text" value={referralCode} onChange={e => setReferralCode(e.target.value)} />
              </div>
            </>
          )}

          {error && <div className="form-error">{error}</div>}

          <button type="submit" className="btn btn-primary" disabled={loading}
            style={{ width: '100%', justifyContent: 'center', marginTop: '1rem', padding: '0.875rem' }}>
            {loading ? t('common.loading') : (isRegister ? t('auth.register') : t('auth.login'))}
          </button>
        </form>

        <div className="form-footer">
          {isRegister ? t('auth.hasAccount') : t('auth.noAccount')}{' '}
          <a onClick={() => { setIsRegister(!isRegister); setError(''); }}>
            {isRegister ? t('auth.login') : t('auth.register')}
          </a>
        </div>
      </div>
    </div>
  );
}
