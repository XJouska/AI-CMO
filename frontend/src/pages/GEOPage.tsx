import { useTranslation } from 'react-i18next';
import { Radar, Globe } from 'lucide-react';

export default function GEOPage() {
  const { t } = useTranslation();

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><Radar size={24} /> {t('nav.geo')}</h1>
      </div>
      <div className="empty-state">
        <Globe size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
        <h3>{t('geo.title')}</h3>
        <p>{t('geo.description')}</p>
        <div className="geo-platforms">
          {['ChatGPT', 'Claude', 'Perplexity', 'Gemini'].map(p => (
            <span key={p} className="geo-platform-badge">{p}</span>
          ))}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '1rem' }}>
          {t('geo.comingSoon')}
        </p>
      </div>
    </div>
  );
}
