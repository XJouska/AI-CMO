import { Eye, Target, Layers, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Recommendation } from '../types';

interface Props {
  recommendations: Recommendation[];
  platformCount: number;
}

function formatExposure(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function computeItemExposure(rec: Recommendation): number {
  const views = rec.engagement_stats?.views || 0;
  const upvotes = rec.engagement_stats?.upvotes || 0;
  const comments = rec.engagement_stats?.comments || 0;
  const base = views > 0 ? views : upvotes * 12 + comments * 5;
  const commentReach = Math.min(base * 0.02, 200);
  return Math.max(Math.round(commentReach), 5);
}

function computeTotalExposure(recs: Recommendation[]): number {
  let total = 0;
  for (const r of recs) {
    total += computeItemExposure(r);
  }
  return total;
}

export default function ValueBanner({ recommendations, platformCount }: Props) {
  const { t } = useTranslation();
  const totalRecs = recommendations.length;
  const avgScore = totalRecs > 0
    ? Math.round(recommendations.reduce((s, r) => s + (r.composite_score || 0), 0) / totalRecs)
    : 0;

  const totalExposure = computeTotalExposure(recommendations);

  return (
    <div className="value-banner">
      <div className="value-banner-main">
        <div className="value-banner-dollar">
          <Eye size={24} />
          <span className="value-banner-amount">~{formatExposure(totalExposure)}</span>
        </div>
        <div className="value-banner-label">{t('valueBanner.label')}</div>
      </div>
      <div className="value-banner-stats">
        <div className="value-banner-stat">
          <Target size={14} />
          <span><strong>{totalRecs}</strong> {t('valueBanner.spots')}</span>
        </div>
        <div className="value-banner-stat">
          <Layers size={14} />
          <span><strong>{platformCount}</strong> {t('valueBanner.platforms')}</span>
        </div>
        <div className="value-banner-stat">
          <TrendingUp size={14} />
          <span>{t('valueBanner.avgScore')} <strong>{avgScore}</strong>/100</span>
        </div>
      </div>
    </div>
  );
}
