import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Radar, Globe, Search, RefreshCw, CheckCircle, XCircle, AlertCircle, Link2 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../api';

interface GEOMention {
  query: string;
  mentioned: boolean;
  context: string;
  sentiment: string;
  prominence: number;
  link_cited?: boolean;
}

interface GEOPlatformResult {
  platform: string;
  visibility_score: number;
  status: string;
  mentions: GEOMention[];
}

interface GEOHistoryItem {
  id: string;
  brand_name: string;
  platform: string;
  visibility_score: number;
  checked_at: string;
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; labelKey: string }> = {
  mentioned: { icon: CheckCircle, color: 'var(--success)', labelKey: 'geo.mentioned' },
  not_found: { icon: XCircle, color: 'var(--error)', labelKey: 'geo.notFound' },
  partial: { icon: AlertCircle, color: 'var(--warning)', labelKey: 'geo.partial' },
  error: { icon: XCircle, color: 'var(--text-muted)', labelKey: 'common.error' },
};

const PLATFORM_COLORS = ['#6366f1', '#10b981', '#f97316'];

export default function GEOPage() {
  const { t } = useTranslation();
  const [brandName, setBrandName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [keywords, setKeywords] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ overall_score: number; platforms: GEOPlatformResult[] } | null>(null);
  const [latestData, setLatestData] = useState<GEOPlatformResult[]>([]);
  const [history, setHistory] = useState<GEOHistoryItem[]>([]);

  useEffect(() => {
    fetchLatest();
    fetchHistory();
  }, []);

  const fetchLatest = async () => {
    try {
      const { data } = await api.get('/api/v1/geo/latest');
      if (data.visibility && data.visibility.length > 0) {
        setLatestData(data.visibility.map((v: any) => ({
          platform: v.platform,
          visibility_score: v.visibility_score,
          status: v.visibility_score > 0 ? 'mentioned' : 'not_found',
          mentions: v.mentions || [],
        })));
      }
    } catch { /* ignore */ }
  };

  const fetchHistory = async () => {
    try {
      const { data } = await api.get('/api/v1/geo/history');
      setHistory(data.history || []);
    } catch { /* ignore */ }
  };

  const handleScan = async () => {
    if (!brandName.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const kws = keywords.split(',').map(k => k.trim()).filter(Boolean);
      const { data } = await api.post('/api/v1/geo/scan', {
        brand_name: brandName.trim(),
        url: websiteUrl.trim() || undefined,
        keywords: kws,
      });
      setResult({ overall_score: data.overall_score, platforms: data.platforms });
      fetchHistory();
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const displayPlatforms = result?.platforms || latestData;
  const overallScore = result?.overall_score ?? (displayPlatforms.length > 0
    ? Math.round(displayPlatforms.reduce((s, p) => s + p.visibility_score, 0) / displayPlatforms.length)
    : 0);

  const chartData = history.reduce((acc: Record<string, any>[], item) => {
    const date = item.checked_at?.split('T')[0] || '';
    let entry = acc.find(e => e.date === date);
    if (!entry) { entry = { date }; acc.push(entry); }
    entry[item.platform] = item.visibility_score;
    return acc;
  }, []).slice(-10);

  const scoreColor = (s: number) => s >= 60 ? 'var(--success)' : s >= 30 ? 'var(--warning)' : 'var(--error)';

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><Radar size={24} /> {t('geo.title')}</h1>
      </div>

      <div className="dashboard-card" style={{ marginBottom: '1.5rem' }}>
        <div className="form-row" style={{ alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>{t('geo.brandName')}</label>
            <input value={brandName} onChange={e => setBrandName(e.target.value)}
              placeholder="e.g. Notion, Figma..."
              onKeyDown={e => e.key === 'Enter' && !loading && handleScan()} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>{t('geo.websiteUrl')}</label>
            <input value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)}
              placeholder="e.g. notion.so"
              onKeyDown={e => e.key === 'Enter' && !loading && handleScan()} />
          </div>
          <div className="form-group" style={{ flex: 2 }}>
            <label>{t('geo.keywords')}</label>
            <input value={keywords} onChange={e => setKeywords(e.target.value)}
              placeholder={t('geo.keywordsPlaceholder')} />
          </div>
          <button className="btn btn-primary" onClick={handleScan} disabled={loading || !brandName.trim()}
            style={{ height: '40px', whiteSpace: 'nowrap', marginBottom: '0.25rem' }}>
            {loading ? <><RefreshCw size={14} className="spin" /> {t('geo.scanning')}</> : <><Search size={14} /> {t('geo.startScan')}</>}
          </button>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          {t('geo.formHint')}
        </div>
      </div>

      {displayPlatforms.length > 0 ? (
        <>
          <div className="geo-overview">
            <div className="geo-overall-score">
              <svg width="120" height="120" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border)" strokeWidth="7" />
                <circle cx="60" cy="60" r="50" fill="none" stroke={scoreColor(overallScore)} strokeWidth="7"
                  strokeDasharray={2 * Math.PI * 50}
                  strokeDashoffset={2 * Math.PI * 50 * (1 - overallScore / 100)}
                  strokeLinecap="round" transform="rotate(-90 60 60)"
                  style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
                <text x="60" y="56" textAnchor="middle" fill={scoreColor(overallScore)} fontSize="26" fontWeight="700">{overallScore}</text>
                <text x="60" y="74" textAnchor="middle" fill="var(--text-muted)" fontSize="10">/ 100</text>
              </svg>
              <div className="geo-overall-label">{t('geo.overallScore')}</div>
            </div>
          </div>

          <div className="geo-platforms-grid">
            {displayPlatforms.map((p) => {
              const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.error;
              const Icon = cfg.icon;
              return (
                <div key={p.platform} className="dashboard-card geo-platform-card">
                  <div className="geo-platform-name">{p.platform}</div>
                  <div className="geo-score-big" style={{ color: scoreColor(p.visibility_score) }}>
                    {p.visibility_score}
                  </div>
                  <div className="geo-status-row">
                    <Icon size={13} color={cfg.color} />
                    <span style={{ color: cfg.color }}>{t(cfg.labelKey)}</span>
                  </div>
                  {p.mentions?.some(m => m.link_cited) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--success)', marginTop: '0.25rem' }}>
                      <Link2 size={12} /> {t('geo.linkCited')}
                    </div>
                  )}
                  {p.mentions?.filter(m => m.context).map((m, i) => (
                    <div key={i} className="geo-mention-snippet">
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{m.query}</span>
                      <div>"{m.context}"</div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {chartData.length > 1 && (
            <div className="dashboard-card" style={{ marginTop: '1.5rem' }}>
              <h3>{t('geo.history')}</h3>
              <div style={{ height: 200 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                    <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} />
                    {['Perplexity', 'Google AI Overview', 'Bing Copilot'].map((name, i) => (
                      <Line key={name} type="monotone" dataKey={name} stroke={PLATFORM_COLORS[i]} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="empty-state">
          <Globe size={48} className="empty-state-icon" />
          <h3>{t('geo.title')}</h3>
          <p>{t('geo.noScans')}</p>
          <div className="geo-platforms">
            {['Perplexity', 'Google AI', 'Bing Copilot'].map(p => (
              <span key={p} className="geo-platform-badge">{p}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
