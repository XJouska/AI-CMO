import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { Conversation } from '../types';

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function getRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d`;
  return `${Math.floor(diffDay / 30)}mo`;
}

function getStatusDotClass(status: string): string {
  switch (status) {
    case 'completed': return 'green';
    case 'analyzing': return 'yellow';
    case 'failed': return 'red';
    default: return 'green';
  }
}

export default function Sidebar({ conversations, activeId, onSelect, onNew, onDelete }: SidebarProps) {
  const { t } = useTranslation();

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <button className="btn btn-primary" onClick={onNew} style={{ width: '100%', justifyContent: 'center' }}>
          <Plus size={15} /> {t('chat.newAnalysis')}
        </button>
      </div>
      <div className="sidebar-list">
        {conversations.length === 0 ? (
          <div className="sidebar-empty">{t('chat.noHistory')}</div>
        ) : (
          conversations.map((conv) => (
            <div key={conv.id}
              className={`sidebar-item ${conv.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(conv.id)}>
              <div className="sidebar-item-left">
                <span className={`status-dot ${getStatusDotClass(conv.status)}`} />
                <span className="sidebar-item-title">{conv.title}</span>
              </div>
              <div className="sidebar-item-right">
                <span className="sidebar-time">{getRelativeTime(conv.created_at)}</span>
                <button className="btn-icon"
                  style={{ padding: '0.2rem' }}
                  onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
