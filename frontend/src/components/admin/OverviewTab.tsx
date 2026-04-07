import { useState, useEffect } from 'react';
import { Users, BarChart3, DollarSign, Zap, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../../api';

interface OverviewData {
  kpi: {
    total_users: number; users_today: number; users_yesterday: number;
    total_analyses: number; analyses_today: number; analyses_yesterday: number;
    total_revenue: number; revenue_today: number;
    total_credits_consumed: number; active_7d: number;
  };
  trends: {
    registrations: { date: string; count: number }[];
    analyses: { date: string; count: number }[];
    revenue: { date: string; amount: number }[];
  };
  platform_distribution: { platform: string; count: number }[];
}

const COLORS = ['#6366f1', '#10b981', '#f97316', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return <span className="admin-delta neutral"><Minus size={10} /> --</span>;
  const pct = previous > 0 ? Math.round(((current - previous) / previous) * 100) : current > 0 ? 100 : 0;
  if (pct > 0) return <span className="admin-delta up"><TrendingUp size={10} /> +{pct}%</span>;
  if (pct < 0) return <span className="admin-delta down"><TrendingDown size={10} /> {pct}%</span>;
  return <span className="admin-delta neutral"><Minus size={10} /> 0%</span>;
}

export default function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/v1/admin/stats/overview')
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>加载中...</div>;
  if (!data) return <div style={{ padding: '2rem', color: 'var(--error)' }}>加载失败</div>;

  const { kpi, trends, platform_distribution } = data;

  return (
    <div>
      <div className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <div className="admin-kpi-icon" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}><Users size={20} /></div>
          <div className="admin-kpi-body">
            <div className="admin-kpi-label">总用户</div>
            <div className="admin-kpi-value">{kpi.total_users}</div>
            <div className="admin-kpi-sub">今日 +{kpi.users_today} <DeltaBadge current={kpi.users_today} previous={kpi.users_yesterday} /></div>
          </div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-icon" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}><BarChart3 size={20} /></div>
          <div className="admin-kpi-body">
            <div className="admin-kpi-label">总分析</div>
            <div className="admin-kpi-value">{kpi.total_analyses}</div>
            <div className="admin-kpi-sub">今日 +{kpi.analyses_today} <DeltaBadge current={kpi.analyses_today} previous={kpi.analyses_yesterday} /></div>
          </div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-icon" style={{ background: 'rgba(249,115,22,0.12)', color: '#f97316' }}><DollarSign size={20} /></div>
          <div className="admin-kpi-body">
            <div className="admin-kpi-label">总收入</div>
            <div className="admin-kpi-value">S${kpi.total_revenue.toFixed(2)}</div>
            <div className="admin-kpi-sub">今日 S${kpi.revenue_today.toFixed(2)}</div>
          </div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-icon" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}><Zap size={20} /></div>
          <div className="admin-kpi-body">
            <div className="admin-kpi-label">积分消耗</div>
            <div className="admin-kpi-value">{kpi.total_credits_consumed}</div>
            <div className="admin-kpi-sub">7日活跃 {kpi.active_7d} 人</div>
          </div>
        </div>
      </div>

      <div className="admin-charts-grid">
        <div className="dashboard-card">
          <h3>注册趋势 (30天)</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={trends.registrations}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} />
                <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} name="注册数" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="dashboard-card">
          <h3>分析趋势 (30天)</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={trends.analyses}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} />
                <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} dot={false} name="分析数" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="dashboard-card">
          <h3>收入趋势 (30天)</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={trends.revenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} formatter={(v: any) => [`S$${Number(v).toFixed(2)}`, '收入']} />
                <Bar dataKey="amount" fill="#f97316" radius={[4, 4, 0, 0]} name="收入" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="dashboard-card">
          <h3>平台分布</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={platform_distribution} dataKey="count" nameKey="platform" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                  {platform_distribution.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
