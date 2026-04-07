import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, ExternalLink, ChevronDown, ChevronRight, Shield, AlertTriangle, Sparkles, ThumbsUp, ThumbsDown, Flame, Clock, Info, Eye, MessageCircle, ThumbsUp as ThumbUp } from 'lucide-react';
import { computeItemExposure } from './ValueBanner';
import ContentWriter from './ContentWriter';
import type { Recommendation } from '../types';
import api from '../api';

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const PLATFORM_LOGOS: Record<string, string> = {
  reddit: 'https://cdn.simpleicons.org/reddit/FF4500',
  youtube: 'https://cdn.simpleicons.org/youtube/FF0000',
  twitter: 'https://cdn.simpleicons.org/x/000000',
  quora: 'https://cdn.simpleicons.org/quora/B92B27',
  producthunt: 'https://cdn.simpleicons.org/producthunt/DA552F',
  hackernews: 'https://cdn.simpleicons.org/ycombinator/FF6600',
};

function parseUrgency(timing: string | undefined): { label: string; level: 'hot' | 'today' | 'normal' } | null {
  if (!timing) return null;
  const t = timing.toLowerCase();
  const hourMatch = t.match(/(\d+)\s*(h|hour|小时)/);
  if (hourMatch && parseInt(hourMatch[1]) <= 6) return { label: `${hourMatch[1]}h`, level: 'hot' };
  if (t.includes('hour') || t.includes('小时') || t.includes('24') || t.includes('today') || t.includes('今天'))
    return { label: '今日', level: 'today' };
  return null;
}

interface Props {
  recommendations: Recommendation[];
  isPremium: boolean;
  conversationId?: string;
}

export default function ActionList({ recommendations, isPremium, conversationId }: Props) {
  const { t } = useTranslation();
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [feedbacks, setFeedbacks] = useState<Record<number, boolean | null>>({});
  const [writerIdx, setWriterIdx] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const visibleRecs = showAll ? recommendations : recommendations.slice(0, 10);
  const hasMore = recommendations.length > 10;

  const handleCopyAndGo = (rec: Recommendation, idx: number) => {
    navigator.clipboard.writeText(rec.suggested_comment || '');
    window.open(rec.url, '_blank');
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const handleFeedback = async (rec: Recommendation, idx: number, useful: boolean) => {
    setFeedbacks(f => ({ ...f, [idx]: useful }));
    try {
      await api.post(`/api/v1/feedback/recommendations/${rec.id || rec.url}`, { is_useful: useful });
    } catch { /* ignore */ }
  };

  return (
    <div className="action-list">
      {visibleRecs.map((rec, i) => {
        const isLocked = !isPremium && (rec.is_premium_only ?? i >= 3);
        const expanded = expandedIdx === i;
        const urgency = parseUrgency(rec.best_timing);
        const itemExposure = computeItemExposure(rec);
        const logo = PLATFORM_LOGOS[rec.platform?.toLowerCase()] || '';
        const riskClass = rec.risk_level === 'high' ? 'risk-high' : rec.risk_level === 'medium' ? 'risk-med' : 'risk-low';

        return (
          <div key={i} className={`action-item ${isLocked ? 'action-locked' : ''} ${expanded ? 'action-expanded' : ''}`}>
            <div className="action-row" onClick={() => !isLocked && setExpandedIdx(expanded ? null : i)}>
              <div className="action-rank">#{rec.rank}</div>
              <div className="action-platform">
                {logo ? <img src={logo} alt={rec.platform} width={16} height={16} /> : <span>{rec.platform}</span>}
              </div>
              <div className="action-title">{rec.title || 'Untitled'}</div>
              <div className="action-meta">
                {urgency && (
                  <span className={`urgency-tag urgency-${urgency.level}`}>
                    {urgency.level === 'hot' ? <Flame size={11} /> : <Clock size={11} />}
                    {urgency.label}
                  </span>
                )}
                {itemExposure > 0 && (
                  <span className="action-value action-tooltip-wrap">
                    ~{itemExposure} views
                    <Info size={10} className="action-info-icon" />
                    <span className="action-tooltip">{t('actionList.exposureTip')}</span>
                  </span>
                )}
                {rec.composite_score != null && (
                  <span className="action-score">{Math.round(rec.composite_score)}</span>
                )}
              </div>
              <div className="action-cta">
                {isLocked ? (
                  <span className="action-lock-text">PRO</span>
                ) : (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={e => { e.stopPropagation(); handleCopyAndGo(rec, i); }}>
                      {copiedIdx === i ? <><Check size={12} /> Done</> : <><Copy size={12} /> Go</>}
                    </button>
                    {!expanded ? <ChevronRight size={14} className="action-chevron" /> : <ChevronDown size={14} className="action-chevron" />}
                  </>
                )}
              </div>
            </div>

            {expanded && !isLocked && (
              <div className="action-detail">
                {(rec.engagement_stats?.views || rec.engagement_stats?.upvotes || rec.engagement_stats?.comments) && (
                  <div className="action-detail-section">
                    <div className="action-detail-label">{t('actionList.postStats')}</div>
                    <div className="action-stats-row">
                      {rec.engagement_stats?.views != null && (
                        <span className="action-stat-chip"><Eye size={12} /> {formatNumber(rec.engagement_stats.views)} {t('actionList.views')}</span>
                      )}
                      {rec.engagement_stats?.upvotes != null && (
                        <span className="action-stat-chip"><ThumbUp size={12} /> {formatNumber(rec.engagement_stats.upvotes)} {t('actionList.upvotes')}</span>
                      )}
                      {rec.engagement_stats?.comments != null && (
                        <span className="action-stat-chip"><MessageCircle size={12} /> {formatNumber(rec.engagement_stats.comments)} {t('actionList.comments')}</span>
                      )}
                    </div>
                  </div>
                )}
                {rec.why_recommend && (
                  <div className="action-detail-section">
                    <div className="action-detail-label">{t('result.whyRecommend')}</div>
                    <div>{rec.why_recommend}</div>
                  </div>
                )}
                {rec.risk_level && (
                  <div className="action-detail-section">
                    <span className={`risk-badge ${riskClass}`}>
                      {rec.risk_level === 'high' ? <AlertTriangle size={11} /> : <Shield size={11} />}
                      {rec.risk_level}
                    </span>
                    {rec.risk_note && <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{rec.risk_note}</span>}
                  </div>
                )}
                {rec.suggested_comment && (
                  <div className="action-detail-section">
                    <div className="action-detail-label">{t('result.suggestedComment')}</div>
                    <div className="action-comment-box">{rec.suggested_comment}</div>
                  </div>
                )}
                <div className="action-detail-actions">
                  {rec.url && (
                    <a href={rec.url} target="_blank" rel="noopener noreferrer" className="btn btn-sm">
                      <ExternalLink size={12} /> {t('result.viewOriginal')}
                    </a>
                  )}
                  {conversationId && (
                    <button className="btn btn-sm" onClick={() => setWriterIdx(i)}>
                      <Sparkles size={12} /> {t('content.generate')}
                    </button>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                    <button className={`btn-icon ${feedbacks[i] === true ? 'feedback-active' : ''}`}
                      onClick={() => handleFeedback(rec, i, true)}
                      style={feedbacks[i] === true ? { color: 'var(--success)' } : {}}>
                      <ThumbsUp size={12} />
                    </button>
                    <button className={`btn-icon ${feedbacks[i] === false ? 'feedback-active' : ''}`}
                      onClick={() => handleFeedback(rec, i, false)}
                      style={feedbacks[i] === false ? { color: 'var(--error)' } : {}}>
                      <ThumbsDown size={12} />
                    </button>
                  </div>
                </div>
                {writerIdx === i && conversationId && (
                  <ContentWriter conversationId={conversationId} platform={rec.platform} onClose={() => setWriterIdx(null)} />
                )}
              </div>
            )}
          </div>
        );
      })}
      {hasMore && (
        <button className="action-expand-btn" onClick={() => setShowAll(!showAll)}>
          {showAll
            ? `Show Top 10 only`
            : `Show all ${recommendations.length} results`
          }
          {showAll ? <ChevronRight size={13} style={{ transform: 'rotate(-90deg)' }} /> : <ChevronDown size={13} />}
        </button>
      )}
    </div>
  );
}
