import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Copy, Check, RefreshCw, X } from 'lucide-react';
import api from '../api';

interface ContentWriterProps {
  conversationId: string;
  platform: string;
  onClose: () => void;
}

const CONTENT_TYPES = [
  { id: 'comment', icon: '💬' },
  { id: 'post', icon: '📝' },
  { id: 'blog', icon: '📰' },
  { id: 'tweet', icon: '🐦' },
];

export default function ContentWriter({ conversationId, platform, onClose }: ContentWriterProps) {
  const { t } = useTranslation();
  const [contentType, setContentType] = useState('comment');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setContent('');
    try {
      const { data } = await api.post('/api/v1/content/generate', {
        conversation_id: conversationId,
        platform,
        content_type: contentType,
      });
      setContent(data.content || '');
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="content-writer-modal" onClick={onClose}>
      <div className="content-writer-body" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}><Sparkles size={16} /> {t('content.generate')} - {platform}</h3>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem', display: 'block' }}>{t('content.type')}</label>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {CONTENT_TYPES.map(ct => (
              <button key={ct.id}
                className={`btn ${contentType === ct.id ? 'btn-primary' : ''}`}
                style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
                onClick={() => setContentType(ct.id)}>
                {ct.icon} {t(`content.${ct.id}`)}
              </button>
            ))}
          </div>
        </div>

        <button className="btn btn-primary" onClick={handleGenerate} disabled={loading} style={{ width: '100%' }}>
          {loading ? <><RefreshCw size={14} className="spin" /> {t('content.generating')}</> : <><Sparkles size={14} /> {t('content.generate')}</>}
        </button>

        {content && (
          <>
            <div className="content-output">{content}</div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <button className="btn" onClick={handleCopy}>
                {copied ? <><Check size={14} /> {t('common.copied')}</> : <><Copy size={14} /> {t('content.copyContent')}</>}
              </button>
              <button className="btn" onClick={handleGenerate} disabled={loading}>
                <RefreshCw size={14} /> {t('content.regenerate')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
