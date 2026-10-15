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
  { name: 'Starter', priceSgd: 4.99, priceCny: 25, credits: 25, popular: false },
  { name: 'Standard', priceSgd: 8.99, priceCny: 45, credits: 50, popular: true },
  { name: 'Pro', priceSgd: 16.99, priceCny: 85, credits: 100, popular: false },
];

export default function PricingModal({ onClose, balance, onBalanceUpdate }: PricingModalProps) {
  const { t, i18n } = useTranslation();
  const isCN = i18n.language.startsWith('zh');
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<{ success: boolean; message: string; url?: string } | null>(null);
  const [paygoAmount, setPaygoAmount] = useState(5);

  const handleCheckout = async (packageName: string, amount?: number) => {
    setLoading(packageName);
    setResult(null);
    try {
      const body: Record<string, unknown> = { package_name: packageName };
      if (amount) body.amount = amount;
      const { data } = await api.post('/api/v1/credits/checkout', body);

      if (data.checkout_url) {
        window.open(data.checkout_url, '_blank');
        setResult({
          success: true,
          message: t('pricing.paymentRedirect'),
          url: data.checkout_url,
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

        {/* Pay As You Go */}
        <div style={{
          padding: '0.875rem 1.25rem', marginBottom: '0.75rem',
          background: 'var(--bg-elevated)', border: '2px solid var(--accent)',
          borderRadius: 'var(--radius-md)',
        }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: '0.5rem' }}>
            {t('pricing.paygo')} — S$1 = 5 {t('pricing.credits')}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontWeight: 600 }}>S$</span>
            <input type="number" min={1} max={200} step={1} value={paygoAmount}
              onChange={e => setPaygoAmount(Math.max(1, Math.min(200, Number(e.target.value))))}
              style={{ width: 60, padding: '0.4rem', fontSize: '1rem', fontWeight: 700, textAlign: 'center', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>=</span>
            <span style={{ fontWeight: 800, color: 'var(--accent)' }}>{paygoAmount * 5}</span>
            <Coins size={14} style={{ color: 'var(--accent)' }} />
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary"
              disabled={!!loading || paygoAmount < 1}
              onClick={() => handleCheckout('PayAsYouGo', paygoAmount)}
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
              {loading === 'PayAsYouGo' ? <Loader size={14} className="spin" /> : t('pricing.buy')}
            </button>
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0.5rem' }}>
          — {t('pricing.orBundle')} —
        </div>

        {/* Package cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {PACKAGES.map((pkg) => (
            <div key={pkg.name}
              onClick={() => !loading && handleCheckout(pkg.name)}
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
                  {t('pricing.popular')}
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
                  {loading === pkg.name ? <Loader size={14} className="spin" /> : t('pricing.buy')}
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
            {result.success ? <Check size={14} style={{ marginRight: 4 }} /> : null}
            {result.message}
            {result.url && (
              <a href={result.url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.5rem', color: 'var(--primary)' }}>
                <ExternalLink size={12} /> {t('pricing.openPayment')}
              </a>
            )}
          </div>
        )}

        {/* Footer hint */}
        <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {t('pricing.paymentFooter')}
        </div>
      </div>
    </div>
  );
}
