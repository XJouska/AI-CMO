import { CheckCircle, Search, Clock, BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Recommendation } from '../../types';

interface Props {
  recommendations: Recommendation[];
  platformResults: Record<string, number>;
  isPremium: boolean;
  onExportCSV: () => void;
}

export default function AnalysisSummaryCard({ recommendations, platformResults, isPremium, onExportCSV }: Props) {
  const { t } = useTranslation();
  const totalResults = recommendations.length;
  const platformCount = Object.keys(platformResults).length;
  const avgScore = recommendations.length
    ? Math.round(recommendations.reduce((sum, r) => sum + (r.composite_score || 0), 0) / recommendations.length)
    : 0;

  return (
    <div className="analysis-summary fadein">
      <div className="analysis-summary-icon"><CheckCircle size={24} /></div>
      <div className="analysis-summary-body">
        <div className="analysis-summary-title">Analysis Complete</div>
        <div className="analysis-summary-stats">
          <span><Search size={12} /> {totalResults} results</span>
          <span><Clock size={12} /> {platformCount} platforms</span>
          <span><BarChart3 size={12} /> Avg: {avgScore}</span>
        </div>
      </div>
      {isPremium ? (
        <button className="export-pill" onClick={onExportCSV}>
          {t('result.exportCSV')}
        </button>
      ) : (
        <button className="export-pill export-pill-locked" disabled>
          {t('result.exportCSVLocked')}
        </button>
      )}
    </div>
  );
}
