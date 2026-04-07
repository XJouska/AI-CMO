import { useState, useEffect } from 'react';
import { Clock, Filter } from 'lucide-react';
import api from '../../api';

interface ActivityItem {
  id: string; username: string; event_type: string; title: string;
  detail: any; created_at: string | null;
}

const EVENT_LABELS: Record<string, string> = {
  analysis_completed: '分析完成',
  seo_check_completed: 'SEO 检查',
  geo_scan_completed: 'GEO 扫描',
  credits_purchased: '积分购买',
};

const EVENT_COLORS: Record<string, string> = {
  analysis_completed: '#6366f1',
  seo_check_completed: '#10b981',
  geo_scan_completed: '#f97316',
  credits_purchased: '#8b5cf6',
};

export default function ActivityTab() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [eventTypes, setEventTypes] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 50 };
      if (filter) params.event_type = filter;
      const { data } = await api.get('/api/v1/admin/activity', { params });
      setItems(data.activity);
      setTotal(data.total);
      setEventTypes(data.event_types);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [page, filter]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <Filter size={14} style={{ color: 'var(--text-muted)' }} />
        <button className={`btn ${filter === '' ? 'btn-primary' : ''}`}
          onClick={() => { setFilter(''); setPage(1); }}>
          全部 ({Object.values(eventTypes).reduce((a, b) => a + b, 0)})
        </button>
        {Object.entries(eventTypes).map(([type, count]) => (
          <button key={type} className={`btn ${filter === type ? 'btn-primary' : ''}`}
            onClick={() => { setFilter(type); setPage(1); }}>
            {EVENT_LABELS[type] || type} ({count})
          </button>
        ))}
      </div>

      <div className="admin-activity-list">
        {loading ? (
          <div style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>加载中...</div>
        ) : items.length === 0 ? (
          <div style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>暂无活动记录</div>
        ) : items.map(item => (
          <div key={item.id} className="admin-activity-item">
            <div className="admin-activity-dot" style={{ background: EVENT_COLORS[item.event_type] || 'var(--text-muted)' }} />
            <div className="admin-activity-body">
              <div className="admin-activity-header">
                <span className="admin-activity-badge" style={{ background: `${EVENT_COLORS[item.event_type] || '#666'}20`, color: EVENT_COLORS[item.event_type] || 'var(--text-muted)' }}>
                  {EVENT_LABELS[item.event_type] || item.event_type}
                </span>
                <span style={{ fontWeight: 600 }}>{item.username}</span>
              </div>
              <div className="admin-activity-title">{item.title}</div>
              <div className="admin-activity-time">
                <Clock size={11} /> {item.created_at?.slice(0, 16).replace('T', ' ')}
              </div>
            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="admin-pagination">
          <button className="btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
          <span>{page} / {totalPages} (共 {total} 条)</span>
          <button className="btn" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
        </div>
      )}
    </div>
  );
}
