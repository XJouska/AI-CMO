import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Target, Calendar, BarChart3, DollarSign, ChevronDown } from 'lucide-react';
import type { OverallStrategy } from '../types';

interface StrategyPanelProps {
  strategy: OverallStrategy;
}

export default function StrategyPanel({ strategy }: StrategyPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="strategy-panel">
      <button className="strategy-toggle" onClick={() => setExpanded(!expanded)}>
        <h3>📋 {t('result.strategy')}</h3>
        <ChevronDown size={18} className={`strategy-toggle-icon ${expanded ? 'expanded' : ''}`} />
      </button>

      <div className={`strategy-body ${expanded ? 'expanded' : 'collapsed'}`}>
        {strategy.priority_actions && Array.isArray(strategy.priority_actions) && (
          <div className="strategy-section">
            <h4>
              <span className="strategy-section-header">
                <Target size={14} className="strategy-section-icon" />
                {t('result.priorityActions')}
              </span>
            </h4>
            <ul>
              {strategy.priority_actions.map((action, i) => (
                <li key={i}>{action}</li>
              ))}
            </ul>
          </div>
        )}

        {strategy.weekly_plan && (
          <div className="strategy-section">
            <h4>
              <span className="strategy-section-header">
                <Calendar size={14} className="strategy-section-icon" />
                {t('result.weeklyPlan')}
              </span>
            </h4>
            <p>{strategy.weekly_plan}</p>
          </div>
        )}

        {strategy.content_calendar && (
          <div className="strategy-section">
            <h4>
              <span className="strategy-section-header">
                <Calendar size={14} className="strategy-section-icon" />
                Content Calendar
              </span>
            </h4>
            <p>{strategy.content_calendar}</p>
          </div>
        )}

        {strategy.kpi_targets && (
          <div className="strategy-section">
            <h4>
              <span className="strategy-section-header">
                <BarChart3 size={14} className="strategy-section-icon" />
                {t('result.kpiTargets')}
              </span>
            </h4>
            <p>{strategy.kpi_targets}</p>
          </div>
        )}

        {strategy.budget_suggestion && (
          <div className="strategy-section">
            <h4>
              <span className="strategy-section-header">
                <DollarSign size={14} className="strategy-section-icon" />
                Budget Suggestion
              </span>
            </h4>
            <p>{strategy.budget_suggestion}</p>
          </div>
        )}
      </div>
    </div>
  );
}
