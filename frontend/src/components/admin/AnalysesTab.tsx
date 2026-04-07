import { useState, useEffect } from 'react';
import { BarChart3, CheckCircle, XCircle, Shield, Radar, Users } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import api from '../../api';

interface AnalysisStats {
  total_analyses: number; analyses_today: number; completed: number; failed: number;
  success_rate: number; avg_per_user: number;
  seo: { total: number; today: number };
  geo: { total: number; today: number };
  competitors: { total: number };
}

interface AnalysisRow {
  id: string; title: string; username: string; input_type: string;
  input_value: string; status: string; rec_count: number; created_at: string | null;
}

const STATUS_COLORS: Record<string, string> = { completed: 'var(--success)', analyzing: 'var(--warning)', failed: 'var(--error)' };
const CHART_COLORS = ['#10b981', '#ef4444', '#f97316'];

export default function AnalysesTab() {
  const [stats, setStats] = useState<AnalysisStats | null>(null);
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, listRes] = await Promise.all([
        api.get('/api/v1/admin/analyses/stats'),
        api.get('/api/v1/admin/analyses', { params: { page, limit: 30, ...(statusFilter ? { status: statusFilter } : {}) } }),
      ]);
      setStats(statsRes.data);
      setAnalyses(listRes.data.analyses);
      setTotal(listRes.data.total);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [page, statusFilter]);

  const totalPages = Math.ceil(total / 30);
  const pieData = stats ? [
    { name: '成功', value: stats.completed },
    { name: '失败', value: stats.failed },
    { name: '进行中', value: stats.total_analyses - stats.completed - stats.failed },
  ].filter(d => d.value > 0) : [];

  return (
    <div>
      {stats && (
        <>
          <div className="admin-kpi-grid">
            <div className="admin-kpi-card">
              <div className="admin-kpi-icon" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}><BarChart3 size={20} /></div>
              <div className="admin-kpi-body">
                <div className="admin-kpi-label">总分析</div>
                <div className="admin-kpi-value">{stats.total_analyses}</div>
                <div className="admin-kpi-sub">今日 +{stats.analyses_today} | 成功率 {stats.success_rate}%</div>
              </div>
            </div>
            <div className="admin-kpi-card">
              <div className="admin-kpi-icon" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}><Shield size={20} /></div>
              <div className="admin-kpi-body">
                <div className="admin-kpi-label">SEO 检查</div>
                <div className="admin-kpi-value">{stats.seo.total}</div>
                <div className="admin-kpi-sub">今日 +{stats.seo.today}</div>
              </div>
            </div>
            <div className="admin-kpi-card">
              <div className="admin-kpi-icon" style={{ background: 'rgba(249,115,22,0.12)', color: '#f97316' }}><Radar size={20} /></div>
              <div className="admin-kpi-body">
                <div className="admin-kpi-label">GEO 扫描</div>
                <div className="admin-kpi-value">{stats.geo.total}</div>
                <div className="admin-kpi-sub">今日 +{stats.geo.today}</div>
              </div>
            </div>
            <div className="admin-kpi-card">
              <div className="admin-kpi-icon" style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}><Users size={20} /></div>
              <div className="admin-kpi-body">
                <div className="admin-kpi-label">竞品追踪</div>
                <div className="admin-kpi-value">{stats.competitors.total}</div>
                <div className="admin-kpi-sub">人均 {stats.avg_per_user} 次分析</div>
              </div>
            </div>
          </div>

          {pieData.length > 0 && (
            <div className="dashboard-card" style={{ marginBottom: '1rem' }}>
              <h3>分析状态分布</h3>
              <div style={{ height: 180 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                      {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        {['', 'completed', 'analyzing', 'failed'].map(s => (
          <button key={s} className={`btn ${statusFilter === s ? 'btn-primary' : ''}`}
            onClick={() => { setStatusFilter(s); setPage(1); }}>
            {s === '' ? '全部' : s === 'completed' ? '完成' : s === 'analyzing' ? '进行中' : '失败'}
          </button>
        ))}
      </div>

      <div className="dashboard-card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr><th>标题</th><th>用户</th><th>类型</th><th>状态</th><th>推荐数</th><th>创建时间</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>加载中...</td></tr>
            ) : analyses.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>暂无数据</td></tr>
            ) : analyses.map(a => (
              <tr key={a.id}>
                <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</td>
                <td>{a.username}</td>
                <td>{a.input_type}</td>
                <td>
                  <span style={{ color: STATUS_COLORS[a.status] || 'var(--text-muted)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    {a.status === 'completed' ? <CheckCircle size={12} /> : a.status === 'failed' ? <XCircle size={12} /> : null}
                    {a.status}
                  </span>
                </td>
                <td>{a.rec_count}</td>
                <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{a.created_at?.slice(0, 16).replace('T', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="admin-pagination">
          <button className="btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
          <span>{page} / {totalPages}</span>
          <button className="btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
        </div>
      )}
    </div>
  );
}
