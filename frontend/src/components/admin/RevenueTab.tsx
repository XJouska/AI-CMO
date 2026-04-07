import { useState, useEffect } from 'react';
import { DollarSign, CreditCard, TrendingUp, ShoppingBag } from 'lucide-react';
import api from '../../api';

interface RevenueStats {
  total_revenue: number; revenue_today: number; revenue_week: number; revenue_month: number;
  total_orders: number; avg_order_value: number;
  packages: { plan: string; count: number; amount: number }[];
}

interface Order {
  id: number; order_number: string; username: string; amount: number;
  credit_amount: number; plan_type: string; status: string;
  paid_at: string | null; created_at: string | null;
}

interface Transaction {
  id: number; username: string; type: string; amount: number;
  balance_after: number; description: string; created_at: string | null;
}

const STATUS_COLORS: Record<string, string> = { paid: 'var(--success)', pending: 'var(--warning)', failed: 'var(--error)' };
const TX_COLORS: Record<string, string> = { recharge: 'var(--success)', consume: 'var(--error)', refund: 'var(--warning)' };

export default function RevenueTab() {
  const [stats, setStats] = useState<RevenueStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'orders' | 'transactions'>('orders');

  useEffect(() => {
    Promise.all([
      api.get('/api/v1/admin/revenue/stats'),
      api.get('/api/v1/admin/revenue'),
    ]).then(([statsRes, revRes]) => {
      setStats(statsRes.data);
      setOrders(revRes.data.orders);
      setTransactions(revRes.data.transactions);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>加载中...</div>;

  return (
    <div>
      {stats && (
        <div className="admin-kpi-grid">
          <div className="admin-kpi-card">
            <div className="admin-kpi-icon" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}><DollarSign size={20} /></div>
            <div className="admin-kpi-body">
              <div className="admin-kpi-label">总收入</div>
              <div className="admin-kpi-value">S${stats.total_revenue.toFixed(2)}</div>
            </div>
          </div>
          <div className="admin-kpi-card">
            <div className="admin-kpi-icon" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}><TrendingUp size={20} /></div>
            <div className="admin-kpi-body">
              <div className="admin-kpi-label">本月收入</div>
              <div className="admin-kpi-value">S${stats.revenue_month.toFixed(2)}</div>
              <div className="admin-kpi-sub">本周 S${stats.revenue_week.toFixed(2)} | 今日 S${stats.revenue_today.toFixed(2)}</div>
            </div>
          </div>
          <div className="admin-kpi-card">
            <div className="admin-kpi-icon" style={{ background: 'rgba(249,115,22,0.12)', color: '#f97316' }}><ShoppingBag size={20} /></div>
            <div className="admin-kpi-body">
              <div className="admin-kpi-label">总订单</div>
              <div className="admin-kpi-value">{stats.total_orders}</div>
              <div className="admin-kpi-sub">均价 S${stats.avg_order_value.toFixed(2)}</div>
            </div>
          </div>
          <div className="admin-kpi-card">
            <div className="admin-kpi-icon" style={{ background: 'rgba(139,92,246,0.12)', color: '#8b5cf6' }}><CreditCard size={20} /></div>
            <div className="admin-kpi-body">
              <div className="admin-kpi-label">套餐分布</div>
              <div className="admin-kpi-sub" style={{ marginTop: '0.25rem' }}>
                {stats.packages.map(p => <span key={p.plan} style={{ marginRight: '0.5rem' }}>{p.plan}: {p.count}单</span>)}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button className={`btn ${tab === 'orders' ? 'btn-primary' : ''}`} onClick={() => setTab('orders')}>支付订单</button>
        <button className={`btn ${tab === 'transactions' ? 'btn-primary' : ''}`} onClick={() => setTab('transactions')}>积分流水</button>
      </div>

      <div className="dashboard-card" style={{ padding: 0, overflow: 'auto' }}>
        {tab === 'orders' ? (
          <table className="admin-table">
            <thead>
              <tr><th>订单号</th><th>用户</th><th>金额</th><th>积分</th><th>套餐</th><th>状态</th><th>支付时间</th></tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>暂无订单</td></tr>
              ) : orders.map(o => (
                <tr key={o.id}>
                  <td style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{o.order_number}</td>
                  <td>{o.username}</td>
                  <td>S${o.amount}</td>
                  <td>{o.credit_amount}</td>
                  <td>{o.plan_type}</td>
                  <td><span style={{ color: STATUS_COLORS[o.status] || 'var(--text-muted)', fontWeight: 600 }}>{o.status}</span></td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{o.paid_at?.slice(0, 16).replace('T', ' ') || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="admin-table">
            <thead>
              <tr><th>用户</th><th>类型</th><th>数量</th><th>余额</th><th>说明</th><th>时间</th></tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>暂无流水</td></tr>
              ) : transactions.map(tx => (
                <tr key={tx.id}>
                  <td>{tx.username}</td>
                  <td><span style={{ color: TX_COLORS[tx.type] || 'var(--text-muted)', fontWeight: 600 }}>{tx.type}</span></td>
                  <td style={{ fontWeight: 600, color: tx.amount > 0 ? 'var(--success)' : 'var(--error)' }}>
                    {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                  </td>
                  <td>{tx.balance_after}</td>
                  <td style={{ fontSize: '0.8rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.description}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{tx.created_at?.slice(0, 16).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
