import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart3, Search, Globe, Coins, ArrowRight, TrendingUp, Clock } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useDashboardStore } from '../stores/dashboardStore';
import { useAuthStore } from '../stores/authStore';
import ActivityFeed from '../components/ActivityFeed';

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#06b6d4', '#eab308', '#ef4444'];

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { overview, fetchOverview } = useDashboardStore();
  const { user } = useAuthStore();

  useEffect(() => { fetchOverview(); }, []);

  const platformData = overview?.platform_distribution
    ? Object.entries(overview.platform_distribution).map(([name, value], i) => ({
        name, value, fill: COLORS[i % COLORS.length]
      }))
    : [];

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t('nav.dashboard')}</h1>
        <button className="btn btn-primary" onClick={() => navigate('/analyze')}>
          <Search size={14} /> {t('chat.newAnalysis')}
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1' }}>
            <BarChart3 size={20} />
          </div>
          <div className="stat-card-body">
            <div className="stat-card-value">{overview?.total_analyses ?? 0}</div>
            <div className="stat-card-label">{t('dashboard.totalAnalyses')}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>
            <TrendingUp size={20} />
          </div>
          <div className="stat-card-body">
            <div className="stat-card-value">{overview?.total_recommendations ?? 0}</div>
            <div className="stat-card-label">{t('dashboard.totalRecommendations')}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
            <Globe size={20} />
          </div>
          <div className="stat-card-body">
            <div className="stat-card-value">{overview?.platforms_covered ?? 0}</div>
            <div className="stat-card-label">{t('dashboard.platformsCovered')}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
            <Coins size={20} />
          </div>
          <div className="stat-card-body">
            <div className="stat-card-value">{user?.credit_balance ?? 0}</div>
            <div className="stat-card-label">{t('dashboard.credits')}</div>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-card">
          <h3>{t('dashboard.platformDistribution')}</h3>
          {platformData.length > 0 ? (
            <div>
              <div style={{ height: 250 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={platformData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                      outerRadius={90} innerRadius={50} paddingAngle={2}>
                      {platformData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-legend">
                {platformData.map((entry, i) => (
                  <span key={i} className="chart-legend-item">
                    <span className="chart-legend-dot" style={{ background: entry.fill }} />
                    {entry.name}: {entry.value}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state-small">
              <p>{t('dashboard.noData')}</p>
              <button className="btn btn-primary" onClick={() => navigate('/analyze')}>
                {t('chat.newAnalysis')} <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>

        <div className="dashboard-card">
          <h3>{t('dashboard.recentAnalyses')}</h3>
          {overview?.recent_analyses?.length ? (
            <div className="recent-list">
              {overview.recent_analyses.map(a => (
                <div key={a.id} className="recent-item" onClick={() => navigate(`/analyze/${a.id}`)}>
                  <div className="recent-item-left">
                    <span className={`status-dot ${a.status === 'completed' ? 'green' : a.status === 'analyzing' ? 'yellow' : 'red'}`} />
                    <span className="recent-item-title">{a.title}</span>
                  </div>
                  <div className="recent-item-right">
                    <span className="recent-item-count">{a.recommendation_count} recs</span>
                    <Clock size={11} style={{ color: 'var(--text-muted)' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state-small">
              <p>{t('dashboard.noAnalyses')}</p>
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        <ActivityFeed />
      </div>
    </div>
  );
}
