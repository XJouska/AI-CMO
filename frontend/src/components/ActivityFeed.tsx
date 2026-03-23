import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Search, Radar, Shield, Clock } from 'lucide-react';
import api from '../api';

interface ActivityItem {
  id: string;
  event_type: string;
  title: string;
  detail: Record<string, unknown>;
  created_at: string;
}

const EVENT_ICONS: Record<string, typeof Search> = {
  analysis_completed: Search,
  geo_scan_requested: Radar,
  seo_check_requested: Shield,
};

function getRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return diffMin + 'm ago';
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + 'h ago';
  const diffDay = Math.floor(diffHr / 24);
  return diffDay + 'd ago';
}

export default function ActivityFeed() {
  useTranslation();
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  useEffect(() => {
    fetchActivities();
  }, []);

  const fetchActivities = async () => {
    try {
      const { data } = await api.get('/api/v1/dashboard/recent-activity');
      setActivities(data.activities || []);
    } catch { /* ignore */ }
  };

  if (activities.length === 0) return null;

  return (
    <div className="dashboard-card">
      <h3><Activity size={18} /> Activity Feed</h3>
      <div className="activity-feed">
        {activities.map(a => {
          const Icon = EVENT_ICONS[a.event_type] || Activity;
          return (
            <div key={a.id} className="activity-item">
              <div className="activity-item-icon">
                <Icon size={14} />
              </div>
              <div className="activity-item-body">
                <div className="activity-item-title">{a.title}</div>
                <div className="activity-item-time">
                  <Clock size={10} /> {getRelativeTime(a.created_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
