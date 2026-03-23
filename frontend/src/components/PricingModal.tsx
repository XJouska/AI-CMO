import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Coins, Check, ExternalLink, Loader } from 'lucide-react';
import api from '../api';

interface PricingModalProps {
  onClose: () => void;
  balance: number;
  onBalanceUpdate?: () => void;
}

const PACKAGES = [
  { name: 'Starter', priceSgd: 5, priceCny: 25, credits: 25, popular: false },
  { name: 'Standard', priceSgd: 15, priceCny: 68, credits: 80, popular: true },
  { name: 'Pro', priceSgd: 30, priceCny: 128, credits: 180, popular: false },
];

export default function PricingModal({ onClose, balance, onBalanceUpdate }: PricingModalProps) {
  const { t, i18n } = useTranslation();
  const isCN = i18n.language.startsWith('zh');
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string; url?: string } | null>(null);

  const handlePurchase = async (pkg: typeof PACKAGES[0]) => {
    setLoading(pkg.name);
    setResult(null);
    try {
      const currency = isCN ? 'CNY' : 'SGD';
      const amount = isCN ? pkg.priceCny : pkg.priceSgd;
      const { data } = await api.post('/api/v1/credits/checkout', { amount, currency });

      if (data.checkout_url) {
        window.open(data.checkout_url, '_blank');
        setResult({
          success: true,
          message: `${isCN ? '请在新窗口完成支付' : 'Please complete payment in the new window'}`,
          url: data.checkout_url,
        });
      } else {
        setResult({
          success: true,
          message: `${isCN ? '订单已创建' : 'Order created'}: ${data.order_number}\n${data.message}\n\n${isCN ? '支付功能即将上线，敬请期待！' : 'Payment integration coming soon!'}`,
        });
      }
      if (onBalanceUpdate) onBalanceUpdate();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Error';
      setResult({ success: false, message: msg });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: '520px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ margin: 0 }}>{t('pricing.title')}</h2>
          <button className="btn-icon" onClick={onClose}><X size={20} /></button>
        </div>

        {/* Balance display */}
        <div style={{
          padding: '1rem', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)',
          marginBottom: '1.5rem', textAlign: 'center'
        }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('pricing.balance')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <Coins size={24} /> {balance}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('pricing.credits')}</div>
        </div>

        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', textAlign: 'center' }}>
          {t('pricing.perAnalysis')}
        </div>

        {/* Package cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {PACKAGES.map((pkg) => (
            <div key={pkg.name}
              onClick={() => !loading && handlePurchase(pkg)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '1rem 1.25rem', background: 'var(--bg-card)',
                border: pkg.popular ? '2px solid var(--primary)' : '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', cursor: loading ? 'wait' : 'pointer',
                transition: 'all 0.2s', position: 'relative', overflow: 'hidden',
                opacity: loading && loading !== pkg.name ? 0.5 : 1,
              }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = pkg.popular ? 'var(--primary)' : 'var(--border)'; e.currentTarget.style.transform = 'none'; }}>
              {pkg.popular && (
                <div style={{
                  position: 'absolute', top: 0, right: 0,
                  background: 'linear-gradient(135deg, var(--primary), var(--accent))',
                  color: '#fff', fontSize: '0.6rem', fontWeight: 700,
                  padding: '0.15rem 0.6rem', borderRadius: '0 0 0 8px',
                }}>
                  {isCN ? '推荐' : 'POPULAR'}
                </div>
              )}
              <div>
                <div style={{ fontWeight: 600, fontSize: '1rem' }}>{pkg.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Coins size={12} /> {pkg.credits} {t('pricing.credits')}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>
                  {isCN ? `¥${pkg.priceCny}` : `S$${pkg.priceSgd}`}
                </div>
                <button className="btn btn-primary"
                  disabled={!!loading}
                  style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
                  {loading === pkg.name ? <Loader size={14} className="spin" /> : (isCN ? '购买' : 'Buy')}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Result message */}
        {result && (
          <div style={{
            marginTop: '1rem', padding: '0.875rem',
            background: result.success ? 'rgba(0, 210, 106, 0.1)' : 'rgba(255, 71, 87, 0.1)',
            border: `1px solid ${result.success ? 'var(--success)' : 'var(--error)'}`,
            borderRadius: 'var(--radius-sm)', fontSize: '0.85rem',
            color: result.success ? 'var(--success)' : 'var(--error)',
            whiteSpace: 'pre-line',
          }}>
            {result.success ? <Check size={14} style={{ marginRight: 4 }} /> : '⚠️ '}
            {result.message}
            {result.url && (
              <a href={result.url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.5rem', color: 'var(--primary)' }}>
                <ExternalLink size={12} /> {isCN ? '打开支付页面' : 'Open payment page'}
              </a>
            )}
          </div>
        )}

        {/* Footer hint */}
        <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {isCN ? '支持支付宝 (CNY) 和 Visa/PayPal (SGD)' : 'Supports Alipay (CNY) and Visa/PayPal (SGD)'}
        </div>
      </div>
    </div>
  );
}
