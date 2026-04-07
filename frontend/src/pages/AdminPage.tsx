import { useState } from 'react';
import { LayoutDashboard, Users, DollarSign, BarChart3, Activity } from 'lucide-react';
import OverviewTab from '../components/admin/OverviewTab';
import UsersTab from '../components/admin/UsersTab';
import RevenueTab from '../components/admin/RevenueTab';
import AnalysesTab from '../components/admin/AnalysesTab';
import ActivityTab from '../components/admin/ActivityTab';

const TABS = [
  { id: 'overview', label: '总览', icon: LayoutDashboard },
  { id: 'users', label: '用户', icon: Users },
  { id: 'revenue', label: '收入', icon: DollarSign },
  { id: 'analyses', label: '分析', icon: BarChart3 },
  { id: 'activity', label: '活动', icon: Activity },
] as const;

type TabId = typeof TABS[number]['id'];

export default function AdminPage() {
  const [tab, setTab] = useState<TabId>('overview');

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><LayoutDashboard size={24} /> Admin Panel</h1>
      </div>

      <div className="admin-tabs">
        {TABS.map(t => (
          <button key={t.id}
            className={`admin-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}>
            <t.icon size={15} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="admin-tab-content">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'revenue' && <RevenueTab />}
        {tab === 'analyses' && <AnalysesTab />}
        {tab === 'activity' && <ActivityTab />}
      </div>
    </div>
  );
}
