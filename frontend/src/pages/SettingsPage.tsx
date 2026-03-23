import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, Globe, Palette, Key, Plus, Trash2, Copy, Check, Languages } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import api from '../api';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
];

interface ApiKeyInfo {
  id: number;
  name: string;
  prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string | null;
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { user, updateSettings } = useAuthStore();
  const [responseLang, setResponseLang] = useState(user?.response_language || 'en');
  const [brandVoice, setBrandVoice] = useState(user?.brand_voice || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => { fetchApiKeys(); }, []);

  const fetchApiKeys = async () => {
    try {
      const { data } = await api.get('/api/v1/auth/api-keys');
      setApiKeys(data.api_keys || []);
    } catch { /* ignore */ }
  };

  const handleSaveLanguage = async (code: string) => {
    setResponseLang(code);
    setSaving(true);
    try {
      await updateSettings({ response_language: code });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleSaveBrandVoice = async () => {
    setSaving(true);
    try {
      await updateSettings({ brand_voice: brandVoice } as any);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleCreateKey = async () => {
    try {
      const { data } = await api.post('/api/v1/auth/api-keys', { name: newKeyName || 'Default' });
      setNewKey(data.api_key);
      setNewKeyName('');
      fetchApiKeys();
    } catch { /* ignore */ }
  };

  const handleRevokeKey = async (id: number) => {
    try {
      await api.delete(`/api/v1/auth/api-keys/${id}`);
      fetchApiKeys();
    } catch { /* ignore */ }
  };

  const handleCopyKey = () => {
    navigator.clipboard.writeText(newKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1><Settings size={24} /> {t('nav.settings')}</h1>
      </div>

      <div className="dashboard-card settings-section">
        <h3><Globe size={18} /> {t('settings.responseLanguage')}</h3>
        <p className="settings-desc">{t('settings.responseLanguageDesc')}</p>
        <div className="language-grid">
          {LANGUAGES.map(lang => (
            <button key={lang.code}
              className={`language-option ${responseLang === lang.code ? 'active' : ''}`}
              onClick={() => handleSaveLanguage(lang.code)} disabled={saving}>
              <span>{lang.flag}</span>
              <span>{lang.label}</span>
              {responseLang === lang.code && <Check size={14} />}
            </button>
          ))}
        </div>
        {saved && <div className="settings-saved">{t('settings.saved')}</div>}
      </div>

      <div className="dashboard-card settings-section">
        <h3><Languages size={18} /> {t('settings.interfaceLanguage')}</h3>
        <p className="settings-desc">{t('settings.interfaceLanguageDesc')}</p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className={`language-option ${i18n.language.startsWith('en') ? 'active' : ''}`}
            onClick={() => i18n.changeLanguage('en')}>🇺🇸 English</button>
          <button className={`language-option ${i18n.language.startsWith('zh') ? 'active' : ''}`}
            onClick={() => i18n.changeLanguage('zh')}>🇨🇳 中文</button>
        </div>
      </div>

      <div className="dashboard-card settings-section">
        <h3><Palette size={18} /> {t('settings.brandVoice')}</h3>
        <p className="settings-desc">{t('settings.brandVoiceDesc')}</p>
        <textarea className="settings-textarea" value={brandVoice}
          onChange={e => setBrandVoice(e.target.value)}
          placeholder={t('settings.brandVoicePlaceholder')} rows={4} />
        <button className="btn btn-primary" onClick={handleSaveBrandVoice}
          disabled={saving} style={{ marginTop: '0.75rem' }}>
          {saving ? t('common.loading') : t('common.save')}
        </button>
      </div>

      <div className="dashboard-card settings-section">
        <h3><Key size={18} /> {t('settings.apiKeys')}</h3>
        <p className="settings-desc">{t('settings.apiKeysDesc')}</p>

        {newKey && (
          <div className="api-key-new">
            <code>{newKey}</code>
            <button className="btn-icon" onClick={handleCopyKey}>
              {copiedKey ? <Check size={14} /> : <Copy size={14} />}
            </button>
            <p style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '0.5rem' }}>
              {t('settings.apiKeyWarning')}
            </p>
          </div>
        )}

        <div className="api-key-create">
          <input value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
            placeholder={t('settings.apiKeyName')} />
          <button className="btn btn-primary" onClick={handleCreateKey}>
            <Plus size={14} /> {t('settings.createKey')}
          </button>
        </div>

        {apiKeys.length > 0 && (
          <div className="api-keys-list">
            {apiKeys.map(key => (
              <div key={key.id} className="api-key-item">
                <div>
                  <strong>{key.name}</strong>
                  <code className="api-key-prefix">{key.prefix}...</code>
                  {!key.is_active && <span className="api-key-revoked">{t('settings.revoked')}</span>}
                </div>
                {key.is_active && (
                  <button className="btn-icon" onClick={() => handleRevokeKey(key.id)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
