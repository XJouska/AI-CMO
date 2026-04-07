import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Search, AlertTriangle, CheckCircle, Info, Clock, RefreshCw } from 'lucide-react';
import api from '../api';

interface SEOIssue {
  check: string;
  value: string;
  severity: 'error' | 'warning' | 'pass';
  hint?: string;
}

interface SEOResult {
  url: string;
  page_speed_score: number | null;
  seo_score: number;
  core_web_vitals: Record<string, number | null>;
  issues: SEOIssue[];
  passed_checks: SEOIssue[];
}

interface SEOHistoryItem {
  id: string;
  url: string;
  page_speed_score: number | null;
  seo_score: number | null;
  created_at: string;
}

function ScoreGauge({ score, label }: { score: number | null; label: string }) {
  const rawScore = typeof score === 'number' && Number.isFinite(score) ? score : null;
  const s = rawScore ?? 0;
  const color = s >= 90 ? 'var(--success)' : s >= 50 ? 'var(--warning)' : 'var(--error)';
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (s / 100) * circumference;

  return (
    <div style={{ textAlign: 'center' }}>
      <svg width="130" height="130" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="54" fill="none" stroke="var(--border)" strokeWidth="8" />
        <circle cx="60" cy="60" r="54" fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 60 60)"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
        <text x="60" y="55" textAnchor="middle" fill={color} fontSize="28" fontWeight="700">
          {rawScore !== null ? rawScore : '—'}
        </text>
        <text x="60" y="75" textAnchor="middle" fill="var(--text-muted)" fontSize="11">
          / 100
        </text>
      </svg>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
        {label}
      </div>
    </div>
  );
}

function CWVCard({ label, value, unit, good, poor }: { label: string; value: number | null | undefined; unit: string; good: number; poor: number }) {
  const numVal = typeof value === 'number' ? value : Number(value);
  const hasValue = value != null && Number.isFinite(numVal);
  const v = hasValue ? numVal : 0;
  const color = !hasValue ? 'var(--text-muted)' : v <= good ? 'var(--success)' : v <= poor ? 'var(--warning)' : 'var(--error)';
  return (
    <div className="dashboard-card" style={{ textAlign: 'center', padding: '1rem' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>
        {hasValue ? `${Math.round(v)}${unit}` : 'N/A'}
      </div>
    </div>
  );
}

export default function SEOPage() {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SEOResult | null>(null);
  const [history, setHistory] = useState<SEOHistoryItem[]>([]);
  const [showPassed, setShowPassed] = useState(false);

  useEffect(() => {
    fetchHistory();
    fetchLatest();
  }, []);

  const fetchHistory = async () => {
    try {
      const { data } = await api.get('/api/v1/seo/history');
      setHistory(data.history || []);
    } catch { /* ignore */ }
  };

  const fetchLatest = async () => {
    try {
      const { data } = await api.get('/api/v1/seo/latest');
      if (data.health) {
        setResult(data.health);
        setUrl(data.health.url || '');
      }
    } catch { /* ignore */ }
  };

  const handleCheck = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const { data } = await api.post('/api/v1/seo/check', { url: url.trim() });
      setResult(data);
      fetchHistory();
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const cwv = result?.core_web_vitals || {};

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><Shield size={24} /> {t('seo.title')}</h1>
      </div>

      <div className="dashboard-card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input value={url} onChange={e => setUrl(e.target.value)}
            placeholder={t('seo.urlPlaceholder')}
            onKeyDown={e => e.key === 'Enter' && !loading && handleCheck()}
            style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={handleCheck} disabled={loading || !url.trim()}>
            {loading ? <><RefreshCw size={14} className="spin" /> {t('seo.checking')}</> : <><Search size={14} /> {t('seo.startCheck')}</>}
          </button>
        </div>
      </div>

      {result && (
        <>
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <ScoreGauge score={result.page_speed_score} label={t('seo.performanceScore')} />
            <ScoreGauge score={result.seo_score} label={t('seo.seoScore')} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <CWVCard label="FCP" value={cwv.fcp} unit="ms" good={1800} poor={3000} />
            <CWVCard label="LCP" value={cwv.lcp} unit="ms" good={2500} poor={4000} />
            <CWVCard label="CLS" value={cwv.cls} unit="" good={0.1} poor={0.25} />
            <CWVCard label="TBT" value={cwv.tbt} unit="ms" good={200} poor={600} />
          </div>

          {result.issues.length > 0 && (
            <div className="dashboard-card" style={{ marginBottom: '1rem' }}>
              <h3><AlertTriangle size={16} /> {t('seo.issues')} ({result.issues.length})</h3>
              <div className="seo-issues-list">
                {result.issues.map((issue, i) => (
                  <div key={i} className="seo-issue-item" style={{ borderLeft: `3px solid ${issue.severity === 'error' ? 'var(--error)' : 'var(--warning)'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {issue.severity === 'error' ? <AlertTriangle size={14} color="var(--error)" /> : <Info size={14} color="var(--warning)" />}
                      <strong>{issue.check}</strong>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{issue.value}</span>
                    </div>
                    {issue.hint && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem', paddingLeft: '1.5rem' }}>{issue.hint}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.passed_checks.length > 0 && (
            <div className="dashboard-card" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ cursor: 'pointer' }} onClick={() => setShowPassed(!showPassed)}>
                <CheckCircle size={16} color="var(--success)" /> {t('seo.passed')} ({result.passed_checks.length})
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                  {showPassed ? '[-]' : '[+]'}
                </span>
              </h3>
              {showPassed && (
                <div className="seo-issues-list">
                  {result.passed_checks.map((item, i) => (
                    <div key={i} className="seo-issue-item" style={{ borderLeft: '3px solid var(--success)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <CheckCircle size={14} color="var(--success)" />
                        <strong>{item.check}</strong>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{item.value}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {history.length > 0 && (
        <div className="dashboard-card">
          <h3><Clock size={16} /> {t('seo.history')}</h3>
          <div className="recent-list">
            {history.map(h => (
              <div key={h.id} className="recent-item" onClick={() => { setUrl(h.url); }}>
                <div className="recent-item-left">
                  <span className={`status-dot ${(h.seo_score ?? 0) >= 70 ? 'green' : (h.seo_score ?? 0) >= 40 ? 'yellow' : 'red'}`} />
                  <span className="recent-item-title">{h.url}</span>
                </div>
                <div className="recent-item-right">
                  <span className="recent-item-count">SEO {h.seo_score ?? '-'}</span>
                  <span className="recent-item-count">Speed {h.page_speed_score ?? '-'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
