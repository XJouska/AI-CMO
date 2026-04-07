import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Lightbulb, MessageCircle, Users, Zap } from 'lucide-react';
import type { OverallStrategy } from '../types';

interface Props {
  strategy: OverallStrategy;
}

export default function StrategyPanel({ strategy }: Props) {
  const { t } = useTranslation();
  const [showMore, setShowMore] = useState(false);

  const hasContent = strategy.priority_actions?.length || strategy.market_insights || strategy.hot_topics?.length;
  if (!hasContent) return null;

  return (
    <div className="strategy-slim">
      {/* Market Insights */}
      {strategy.market_insights && (
        <div className="strategy-insight-box">
          <Lightbulb size={14} />
          <span>{strategy.market_insights}</span>
        </div>
      )}

      {/* Hot Topics Word Cloud */}
      {strategy.hot_topics && strategy.hot_topics.length > 0 && (
        <div className="strategy-section-block">
          <div className="strategy-section-title">{t('strategy.hotTopics')}</div>
          <div className="strategy-tags">
            {strategy.hot_topics.map((topic, i) => (
              <span key={i} className="strategy-tag" style={{ fontSize: `${0.75 + Math.random() * 0.35}rem`, opacity: 0.7 + Math.random() * 0.3 }}>
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* User Pain Points + Competitors side by side */}
      <div className="strategy-two-col">
        {strategy.user_pain_points && strategy.user_pain_points.length > 0 && (
          <div className="strategy-section-block">
            <div className="strategy-section-title"><MessageCircle size={12} /> {t('strategy.painPoints')}</div>
            <ul className="strategy-compact-list">
              {strategy.user_pain_points.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </div>
        )}
        {strategy.competitor_mentions && strategy.competitor_mentions.length > 0 && (
          <div className="strategy-section-block">
            <div className="strategy-section-title"><Users size={12} /> {t('strategy.competitors')}</div>
            <div className="strategy-tags">
              {strategy.competitor_mentions.map((c, i) => (
                <span key={i} className="strategy-competitor-tag">{c}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Content Angles */}
      {strategy.content_angles && strategy.content_angles.length > 0 && (
        <div className="strategy-section-block">
          <div className="strategy-section-title"><Zap size={12} /> {t('strategy.contentAngles')}</div>
          <ul className="strategy-compact-list">
            {strategy.content_angles.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}

      {/* Priority Actions */}
      {strategy.priority_actions && strategy.priority_actions.length > 0 && (
        <div className="strategy-section-block">
          <div className="strategy-section-title">{t('result.priorityActions')}</div>
          <ol className="strategy-actions-list">
            {strategy.priority_actions.map((action, i) => <li key={i}>{action}</li>)}
          </ol>
        </div>
      )}

      {/* Platform Breakdown */}
      {strategy.platform_breakdown && Object.keys(strategy.platform_breakdown).length > 0 && (
        <div className="strategy-section-block">
          <div className="strategy-section-title">{t('strategy.platformInsights')}</div>
          <div className="strategy-platform-grid">
            {Object.entries(strategy.platform_breakdown).map(([platform, insight]) => (
              <div key={platform} className="strategy-platform-item">
                <strong>{platform}</strong>
                <span>{insight}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expandable: weekly plan, kpi, budget */}
      {(strategy.weekly_plan || strategy.kpi_targets || strategy.budget_suggestion) && (
        <>
          <button className="strategy-more-btn" onClick={() => setShowMore(!showMore)}>
            {showMore ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {showMore ? t('strategy.collapse') : t('strategy.showMore')}
          </button>
          {showMore && (
            <div className="strategy-detail">
              {strategy.weekly_plan && <div className="strategy-detail-item"><strong>{t('result.weeklyPlan')}</strong><p>{strategy.weekly_plan}</p></div>}
              {strategy.kpi_targets && <div className="strategy-detail-item"><strong>{t('result.kpiTargets')}</strong><p>{strategy.kpi_targets}</p></div>}
              {strategy.budget_suggestion && <div className="strategy-detail-item"><strong>Budget</strong><p>{strategy.budget_suggestion}</p></div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
