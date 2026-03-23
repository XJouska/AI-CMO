import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Copy, Check, ThumbsUp, ThumbsDown, MessageCircle, Eye, Calendar, AlertTriangle, Shield, Lock, TrendingUp } from 'lucide-react';
import api from '../api';
import type { Recommendation } from '../types';

interface RecommendCardProps {
  recommendation: Recommendation;
  isPremium: boolean;
  index: number;
  onUpgradeClick?: () => void;
}

export default function RecommendCard({ recommendation: rec, isPremium, index, onUpgradeClick }: RecommendCardProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const isLocked = rec.is_premium_only && !isPremium;

  const handleFeedback = async (isUseful: boolean) => {
    setFeedback(isUseful);
    try { await api.post(`/api/v1/feedback/recommendations/${rec.url}`, { is_useful: isUseful }); } catch { /* ignore */ }
  };

  const handleCopy = () => {
    if (rec.suggested_comment) {
      navigator.clipboard.writeText(rec.suggested_comment);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatCount = (n?: number) => {
    if (!n) return '—';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };

  const riskClass = rec.risk_level === 'high' ? 'risk-high' :
                    rec.risk_level === 'medium' ? 'risk-medium' : 'risk-low';

  const rankDisplay = `#${rec.rank}`;

  const platformBadgeClass = `card-platform platform-badge-${rec.platform.toLowerCase().replace(/\s+/g, '')}`;

  return (
    <div className={`recommend-card ${isLocked ? 'locked' : ''}`}
         style={{ animationDelay: `${index * 100}ms` }}>
      {isLocked && (
        <div className="lock-overlay">
          <Lock size={28} color="var(--accent)" />
          <span className="lock-text">{t('result.premiumLock')}</span>
          <button className="btn btn-primary" style={{ fontSize: '0.8125rem' }} onClick={onUpgradeClick}>
            {t('pricing.upgrade')}
          </button>
        </div>
      )}

      <div className="card-content">
        <div className="card-header">
          <span className="card-rank">{rankDisplay}</span>
          <span className={platformBadgeClass}>{rec.platform}</span>
        </div>

        <div className="card-title">{rec.title || 'Untitled'}</div>

        <div className="card-engagement">
          {rec.engagement_stats?.upvotes != null && (
            <span className="engagement-item"><ThumbsUp size={13} /> {formatCount(rec.engagement_stats.upvotes)}</span>
          )}
          {rec.engagement_stats?.comments != null && (
            <span className="engagement-item"><MessageCircle size={13} /> {formatCount(rec.engagement_stats.comments)}</span>
          )}
          {rec.engagement_stats?.views != null && (
            <span className="engagement-item"><Eye size={13} /> {formatCount(rec.engagement_stats.views)}</span>
          )}
          {rec.best_timing && (
            <span className="engagement-item"><Calendar size={13} /> {rec.best_timing}</span>
          )}
        </div>

        {rec.estimated_exposure && (
          <div className="card-section" style={{ marginBottom: '1rem' }}>
            <span className="exposure-badge">
              <TrendingUp size={11} /> {rec.estimated_exposure}
            </span>
          </div>
        )}

        {rec.composite_score != null && (
          <div className="card-score">
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>{t('result.score')}</span>
            <div className="score-bar">
              <div className="score-fill" style={{ width: `${Math.min(rec.composite_score, 100)}%` }} />
            </div>
            <span className="score-value">{Math.round(rec.composite_score)}</span>
          </div>
        )}

        {rec.why_recommend && (
          <div className="card-section">
            <div className="card-section-label">{t('result.whyRecommend')}</div>
            <div className="card-section-content">{rec.why_recommend}</div>
          </div>
        )}

        {rec.risk_level && (
          <div className="card-section" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className={`risk-badge ${riskClass}`}>
              {rec.risk_level === 'high' ? <AlertTriangle size={11} /> : <Shield size={11} />}
              {rec.risk_level}
            </span>
            {rec.risk_note && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{rec.risk_note}</span>}
          </div>
        )}

        {rec.suggested_comment && (
          <div className="card-section">
            <div className="card-section-label">{t('result.suggestedComment')}</div>
            <div className="card-comment-box">{rec.suggested_comment}</div>
          </div>
        )}

        <div className="card-actions">
          {rec.url && (
            <a href={rec.url} target="_blank" rel="noopener noreferrer" className="btn" style={{ textDecoration: 'none' }}>
              <ExternalLink size={13} /> {t('result.viewOriginal')}
            </a>
          )}
          {rec.suggested_comment && (
            <button className="btn" onClick={handleCopy}>
              {copied ? <><Check size={13} /> {t('common.copied')}</> : <><Copy size={13} /> {t('result.copyComment')}</>}
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
            <button className={`btn-icon ${feedback === true ? 'feedback-active' : ''}`}
              onClick={() => handleFeedback(true)} title={t('result.useful')}
              style={feedback === true ? { color: 'var(--success)' } : {}}>
              <ThumbsUp size={13} />
            </button>
            <button className={`btn-icon ${feedback === false ? 'feedback-active' : ''}`}
              onClick={() => handleFeedback(false)} title={t('result.notUseful')}
              style={feedback === false ? { color: 'var(--error)' } : {}}>
              <ThumbsDown size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
