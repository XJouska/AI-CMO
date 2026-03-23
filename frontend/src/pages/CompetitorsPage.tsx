import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Globe, Users, ExternalLink } from 'lucide-react';
import api from '../api';

interface Competitor {
  id: string;
  name: string;
  url: string;
  description: string;
  created_at: string;
}

export default function CompetitorsPage() {
  const { t } = useTranslation();
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchCompetitors(); }, []);

  const fetchCompetitors = async () => {
    try {
      const { data } = await api.get('/api/v1/competitors');
      setCompetitors(data.competitors || []);
    } catch { /* ignore */ }
  };

  const handleAdd = async () => {
    if (!name.trim() || !url.trim()) return;
    setLoading(true);
    try {
      await api.post('/api/v1/competitors', { name, url, description: desc });
      setName(''); setUrl(''); setDesc(''); setShowAdd(false);
      fetchCompetitors();
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/api/v1/competitors/${id}`);
      setCompetitors(prev => prev.filter(c => c.id !== id));
    } catch { /* ignore */ }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><Users size={24} /> {t('nav.competitors')}</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(!showAdd)}>
          <Plus size={14} /> {t('competitors.add')}
        </button>
      </div>

      {showAdd && (
        <div className="dashboard-card" style={{ marginBottom: '1.5rem' }}>
          <h3>{t('competitors.addNew')}</h3>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>{t('competitors.name')}</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Okara AI" />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>{t('competitors.url')}</label>
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" />
            </div>
          </div>
          <div className="form-group">
            <label>{t('competitors.description')}</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder={t('competitors.descPlaceholder')} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button className="btn btn-primary" onClick={handleAdd} disabled={loading || !name.trim() || !url.trim()}>
              {loading ? t('common.loading') : t('competitors.add')}
            </button>
            <button className="btn" onClick={() => setShowAdd(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {competitors.length === 0 ? (
        <div className="empty-state">
          <Users size={48} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
          <h3>{t('competitors.empty')}</h3>
          <p>{t('competitors.emptyDesc')}</p>
        </div>
      ) : (
        <div className="competitors-grid">
          {competitors.map(comp => (
            <div key={comp.id} className="dashboard-card competitor-card">
              <div className="competitor-card-header">
                <div>
                  <h3>{comp.name}</h3>
                  <a href={comp.url} target="_blank" rel="noopener noreferrer" className="competitor-url">
                    <Globe size={12} /> {comp.url} <ExternalLink size={10} />
                  </a>
                </div>
                <button className="btn-icon" onClick={() => handleDelete(comp.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
              {comp.description && <p className="competitor-desc">{comp.description}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
