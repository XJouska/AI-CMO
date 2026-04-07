import { useState, useEffect } from 'react';
import { Search, Plus, Minus, X, Users, CreditCard, Globe, TrendingUp, Eye } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import api from '../../api';

interface UserRow {
  id: number; username: string; email: string; credit_balance: number;
  is_premium: boolean; is_admin: boolean; is_active: boolean;
  analysis_count: number; country: string; last_login_at: string | null; created_at: string | null;
}

interface UserStats {
  total_users: number; premium_count: number; paid_count: number; paid_ratio: number;
  reg_today: number; reg_week: number; reg_month: number;
  avg_credits: number; total_credits_purchased: number;
  countries: { country: string; count: number }[];
  languages: { language: string; count: number }[];
}

interface UserDetail {
  info: {
    id: number; username: string; email: string; credit_balance: number;
    is_premium: boolean; is_admin: boolean; is_active: boolean;
    response_language: string; brand_voice: string; primary_url: string;
    referral_code: string; referred_by: number | null;
    register_ip: string; last_login_ip: string; country: string;
    last_login_at: string | null; created_at: string | null;
  };
  transactions: { id: number; type: string; amount: number; balance_after: number; description: string; created_at: string | null }[];
  orders: { order_number: string; amount: number; credit_amount: number; status: string; paid_at: string | null }[];
  analyses: { id: string; title: string; status: string; input_type: string; input_value: string; created_at: string | null }[];
  seo_count: number;
  geo_count: number;
  referrer: { username: string; email: string } | null;
  referred_count: number;
}

const COLORS = ['#6366f1', '#10b981', '#f97316', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#eab308', '#64748b'];
const TX_COLORS: Record<string, string> = { recharge: 'var(--success)', consume: 'var(--error)', refund: 'var(--warning)' };
const STATUS_COLORS: Record<string, string> = { completed: 'var(--success)', analyzing: 'var(--warning)', failed: 'var(--error)' };

export default function UsersTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState<{ userId: number; amount: string } | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'info' | 'credits' | 'analyses'>('info');

  const fetchUsers = async (p = page, s = search) => {
    setLoading(true);
    try {
      const params: any = { page: p, limit: 20 };
      if (s) params.search = s;
      const { data } = await api.get('/api/v1/admin/users', { params });
      setUsers(data.users);
      setTotal(data.total);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const fetchStats = async () => {
    try {
      const { data } = await api.get('/api/v1/admin/users/stats');
      setStats(data);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchUsers(); fetchStats(); }, [page]);

  const handleSearch = () => { setPage(1); fetchUsers(1, search); };

  const handleAdjust = async (userId: number, amount: number) => {
    if (!amount) return;
    try {
      await api.put(`/api/v1/admin/users/${userId}/credits`, { amount, reason: '管理员调整' });
      fetchUsers();
      fetchStats();
      setAdjusting(null);
    } catch { /* ignore */ }
  };

  const openDetail = async (userId: number) => {
    setDetailLoading(true);
    setDetail(null);
    setDetailTab('info');
    try {
      const { data } = await api.get(`/api/v1/admin/users/${userId}/detail`);
      setDetail(data);
    } catch { /* ignore */ }
    setDetailLoading(false);
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      {/* User Overview Stats */}
      {stats && (
        <>
          <div className="admin-kpi-grid">
            <div className="admin-kpi-card">
              <div className="admin-kpi-icon" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}><Users size={20} /></div>
              <div className="admin-kpi-body">
                <div className="admin-kpi-label">总用户</div>
                <div className="admin-kpi-value">{stats.total_users}</div>
                <div className="admin-kpi-sub">今日 +{stats.reg_today} | 本周 +{stats.reg_week} | 本月 +{stats.reg_month}</div>
              </div>
            </div>
            <div className="admin-kpi-card">
              <div className="admin-kpi-icon" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}><CreditCard size={20} /></div>
              <div className="admin-kpi-body">
                <div className="admin-kpi-label">付费用户</div>
                <div className="admin-kpi-value">{stats.paid_count}</div>
                <div className="admin-kpi-sub">付费率 {stats.paid_ratio}% | Premium {stats.premium_count} 人</div>
              </div>
            </div>
            <div className="admin-kpi-card">
              <div className="admin-kpi-icon" style={{ background: 'rgba(249,115,22,0.12)', color: '#f97316' }}><TrendingUp size={20} /></div>
              <div className="admin-kpi-body">
                <div className="admin-kpi-label">积分数据</div>
                <div className="admin-kpi-value">{stats.total_credits_purchased}</div>
                <div className="admin-kpi-sub">总购买积分 | 人均余额 {stats.avg_credits}</div>
              </div>
            </div>
            <div className="admin-kpi-card">
              <div className="admin-kpi-icon" style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}><Globe size={20} /></div>
              <div className="admin-kpi-body">
                <div className="admin-kpi-label">国家分布</div>
                <div className="admin-kpi-sub" style={{ marginTop: '0.25rem' }}>
                  {stats.countries.slice(0, 5).map(c => (
                    <span key={c.country} style={{ marginRight: '0.5rem' }}>{c.country}: {c.count}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="admin-charts-grid" style={{ marginBottom: '1.5rem' }}>
            {stats.countries.length > 0 && (
              <div className="dashboard-card">
                <h3>用户国家分布</h3>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer>
                    <BarChart data={stats.countries.slice(0, 10)} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                      <YAxis type="category" dataKey="country" width={80} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                      <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} />
                      <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            {stats.languages.length > 0 && (
              <div className="dashboard-card">
                <h3>语言偏好</h3>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={stats.languages} dataKey="count" nameKey="language" cx="50%" cy="50%" outerRadius={70}
                        label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                        {stats.languages.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* User Table */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜索用户名或邮箱..." style={{ flex: 1 }}
          onKeyDown={e => e.key === 'Enter' && handleSearch()} />
        <button className="btn btn-primary" onClick={handleSearch}><Search size={14} /> 搜索</button>
      </div>

      <div className="dashboard-card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th><th>用户名</th><th>邮箱</th><th>积分</th>
              <th>国家</th><th>Premium</th><th>分析数</th><th>最后登录</th><th>注册时间</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>加载中...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>无数据</td></tr>
            ) : users.map(u => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td><strong>{u.username}</strong></td>
                <td>{u.email}</td>
                <td style={{ fontWeight: 600 }}>{u.credit_balance}</td>
                <td style={{ fontSize: '0.8rem' }}>{u.country || '-'}</td>
                <td>{u.is_premium ? <span style={{ color: 'var(--success)' }}>Yes</span> : 'No'}</td>
                <td>{u.analysis_count}</td>
                <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{u.last_login_at?.slice(0, 10) || '-'}</td>
                <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{u.created_at?.slice(0, 10)}</td>
                <td>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button className="btn" style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
                      onClick={() => openDetail(u.id)} title="查看详情">
                      <Eye size={12} />
                    </button>
                    {adjusting?.userId === u.id ? (
                      <>
                        <input value={adjusting.amount} onChange={e => setAdjusting({ ...adjusting, amount: e.target.value })}
                          style={{ width: 50, fontSize: '0.75rem' }} placeholder="+/-" type="number" />
                        <button className="btn" style={{ fontSize: '0.65rem', padding: '0.15rem 0.3rem' }}
                          onClick={() => handleAdjust(u.id, parseInt(adjusting.amount) || 0)}>OK</button>
                        <button className="btn" style={{ fontSize: '0.65rem', padding: '0.15rem 0.3rem' }}
                          onClick={() => setAdjusting(null)}>X</button>
                      </>
                    ) : (
                      <button className="btn" style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
                        onClick={() => setAdjusting({ userId: u.id, amount: '' })} title="调整积分">
                        <Plus size={11} /><Minus size={11} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="admin-pagination">
          <button className="btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
          <span>{page} / {totalPages} (共 {total} 人)</span>
          <button className="btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
        </div>
      )}

      {/* User Detail Modal */}
      {(detail || detailLoading) && (
        <div className="admin-modal-overlay" onClick={() => setDetail(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>{detail ? `${detail.info.username} 的详情` : '加载中...'}</h3>
              <button className="btn-icon" onClick={() => setDetail(null)}><X size={18} /></button>
            </div>

            {detailLoading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>加载中...</div>
            ) : detail && (
              <>
                <div className="admin-detail-tabs">
                  {(['info', 'credits', 'analyses'] as const).map(t => (
                    <button key={t} className={`admin-tab ${detailTab === t ? 'active' : ''}`}
                      onClick={() => setDetailTab(t)}>
                      {t === 'info' ? '基础信息' : t === 'credits' ? '积分流水' : '分析历史'}
                    </button>
                  ))}
                </div>

                <div className="admin-modal-body">
                  {detailTab === 'info' && (
                    <div className="admin-detail-grid">
                      <div className="admin-detail-section">
                        <h4>账户信息</h4>
                        <div className="admin-detail-row"><span>用户ID</span><span>{detail.info.id}</span></div>
                        <div className="admin-detail-row"><span>用户名</span><span><strong>{detail.info.username}</strong></span></div>
                        <div className="admin-detail-row"><span>邮箱</span><span>{detail.info.email}</span></div>
                        <div className="admin-detail-row"><span>积分余额</span><span style={{ fontWeight: 700, color: 'var(--primary)' }}>{detail.info.credit_balance}</span></div>
                        <div className="admin-detail-row"><span>Premium</span><span style={{ color: detail.info.is_premium ? 'var(--success)' : 'var(--text-muted)' }}>{detail.info.is_premium ? 'Yes' : 'No'}</span></div>
                        <div className="admin-detail-row"><span>Admin</span><span>{detail.info.is_admin ? 'Yes' : 'No'}</span></div>
                        <div className="admin-detail-row"><span>邀请码</span><span style={{ fontFamily: 'monospace' }}>{detail.info.referral_code || '-'}</span></div>
                        <div className="admin-detail-row"><span>语言偏好</span><span>{detail.info.response_language}</span></div>
                        {detail.info.primary_url && <div className="admin-detail-row"><span>主产品 URL</span><span>{detail.info.primary_url}</span></div>}
                      </div>

                      <div className="admin-detail-section">
                        <h4>网络与地域</h4>
                        <div className="admin-detail-row"><span>国家</span><span>{detail.info.country || '未知'}</span></div>
                        <div className="admin-detail-row"><span>注册 IP</span><span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{detail.info.register_ip || '-'}</span></div>
                        <div className="admin-detail-row"><span>最后登录 IP</span><span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{detail.info.last_login_ip || '-'}</span></div>
                        <div className="admin-detail-row"><span>最后登录</span><span>{detail.info.last_login_at?.slice(0, 16).replace('T', ' ') || '-'}</span></div>
                        <div className="admin-detail-row"><span>注册时间</span><span>{detail.info.created_at?.slice(0, 16).replace('T', ' ')}</span></div>
                      </div>

                      <div className="admin-detail-section">
                        <h4>使用统计</h4>
                        <div className="admin-detail-row"><span>分析次数</span><span>{detail.analyses.length}+</span></div>
                        <div className="admin-detail-row"><span>SEO 检查</span><span>{detail.seo_count}</span></div>
                        <div className="admin-detail-row"><span>GEO 扫描</span><span>{detail.geo_count}</span></div>
                        <div className="admin-detail-row"><span>支付订单</span><span>{detail.orders.length}</span></div>
                        {detail.referrer && <div className="admin-detail-row"><span>邀请人</span><span>{detail.referrer.username} ({detail.referrer.email})</span></div>}
                        <div className="admin-detail-row"><span>邀请人数</span><span>{detail.referred_count}</span></div>
                      </div>
                    </div>
                  )}

                  {detailTab === 'credits' && (
                    <div>
                      {detail.orders.length > 0 && (
                        <div style={{ marginBottom: '1rem' }}>
                          <h4 style={{ marginBottom: '0.5rem', fontSize: '0.85rem' }}>支付订单</h4>
                          <table className="admin-table">
                            <thead><tr><th>订单号</th><th>金额</th><th>积分</th><th>状态</th><th>时间</th></tr></thead>
                            <tbody>
                              {detail.orders.map(o => (
                                <tr key={o.order_number}>
                                  <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{o.order_number}</td>
                                  <td>S${o.amount}</td>
                                  <td>{o.credit_amount}</td>
                                  <td style={{ color: o.status === 'paid' ? 'var(--success)' : 'var(--warning)', fontWeight: 600 }}>{o.status}</td>
                                  <td style={{ fontSize: '0.8rem' }}>{o.paid_at?.slice(0, 16).replace('T', ' ') || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <h4 style={{ marginBottom: '0.5rem', fontSize: '0.85rem' }}>积分流水</h4>
                      {detail.transactions.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', padding: '1rem', textAlign: 'center' }}>暂无流水</div>
                      ) : (
                        <table className="admin-table">
                          <thead><tr><th>类型</th><th>数量</th><th>余额</th><th>说明</th><th>时间</th></tr></thead>
                          <tbody>
                            {detail.transactions.map(t => (
                              <tr key={t.id}>
                                <td style={{ color: TX_COLORS[t.type] || 'var(--text-muted)', fontWeight: 600 }}>{t.type}</td>
                                <td style={{ fontWeight: 600, color: t.amount > 0 ? 'var(--success)' : 'var(--error)' }}>
                                  {t.amount > 0 ? `+${t.amount}` : t.amount}
                                </td>
                                <td>{t.balance_after}</td>
                                <td style={{ fontSize: '0.8rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</td>
                                <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.created_at?.slice(0, 16).replace('T', ' ')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}

                  {detailTab === 'analyses' && (
                    <div>
                      {detail.analyses.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', padding: '1rem', textAlign: 'center' }}>暂无分析记录</div>
                      ) : (
                        <table className="admin-table">
                          <thead><tr><th>标题</th><th>类型</th><th>状态</th><th>时间</th></tr></thead>
                          <tbody>
                            {detail.analyses.map(a => (
                              <tr key={a.id}>
                                <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</td>
                                <td>{a.input_type}</td>
                                <td style={{ color: STATUS_COLORS[a.status] || 'var(--text-muted)', fontWeight: 600 }}>{a.status}</td>
                                <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{a.created_at?.slice(0, 16).replace('T', ' ')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
