import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Coins, Sparkles, Search, Radar, Users, Shield, Zap, ChevronDown, ChevronUp, Loader } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import api from '../api';

const PACKAGES = [
  { name: 'Starter', price: 4.99, credits: 25, taglineKey: 'pricing.tagStarter', popular: false },
  { name: 'Standard', price: 8.99, credits: 50, taglineKey: 'pricing.tagStandard', popular: true },
  { name: 'Pro', price: 16.99, credits: 100, taglineKey: 'pricing.tagPro', popular: false },
  { name: 'Ultra', price: 39.99, credits: 250, taglineKey: 'pricing.tagUltra', popular: false },
];

const FEATURES = [
  { icon: Search, nameKey: 'pricing.featureSocial', costKey: 'pricing.perAnalysis' },
  { icon: Radar, nameKey: 'pricing.featureGeo', costKey: 'pricing.perAnalysis' },
  { icon: Users, nameKey: 'pricing.featureCompetitor', costKey: 'pricing.perAnalysis' },
  { icon: Shield, nameKey: 'pricing.featureSeo', costKey: 'pricing.free' },
  { icon: Sparkles, nameKey: 'pricing.featureAi', costKey: 'pricing.free' },
  { icon: Zap, nameKey: 'pricing.featureDiscover', costKey: 'pricing.free' },
];

export default function PricingPage() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuthStore();
  const [loading, setLoading] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [paygoAmount, setPaygoAmount] = useState(5);

  const faq = [
    { q: t('pricing.faqCreditQ'), a: t('pricing.faqCreditA') },
    { q: t('pricing.faqExpireQ'), a: t('pricing.faqExpireA') },
    { q: t('pricing.faqPaymentQ'), a: t('pricing.faqPaymentA') },
  ];

  const handlePurchase = async (pkgName: string, amount?: number) => {
    setLoading(pkgName);
    try {
      const body: Record<string, unknown> = { package_name: pkgName };
      if (amount) body.amount = amount;
      const { data } = await api.post('/api/v1/credits/checkout', body);
      if (data.checkout_url) {
        window.open(data.checkout_url, '_blank');
      }
      refreshUser();
    } catch { /* ignore */ } finally {
      setLoading(null);
    }
  };

  return (
    <div className="page-container">
      <div className="pricing-hero">
        <h1>{t('pricing.title')}</h1>
        <p className="pricing-subtitle">{t('pricing.subtitle')}</p>
        <div className="pricing-balance">
          <Coins size={18} />
          <span>{t('pricing.balance')}: <strong>{user?.credit_balance ?? 0}</strong> {t('pricing.credits')}</span>
        </div>
      </div>

      {/* Payment badges */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('pricing.weAccept')}</span>
        {[
          { label: 'VISA', color: '#1a1f71', bg: '#fff', italic: true },
          { label: 'MC', color: '#fff', bg: '#2d2d2d' },
          { label: 'PayPal', color: '#009cde', bg: '#2d2d2d' },
          { label: 'Alipay', color: '#1bb76e', bg: '#2d2d2d' },
          { label: 'WeChat Pay', color: '#07c160', bg: '#2d2d2d' },
        ].map(b => (
          <span key={b.label} style={{
            padding: '0.25rem 0.7rem', borderRadius: '5px', fontSize: '0.8rem', fontWeight: 700,
            color: b.color, background: b.bg, border: '1px solid var(--border)',
            fontStyle: b.italic ? 'italic' : 'normal',
          }}>{b.label}</span>
        ))}
      </div>
      <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2rem' }}>{t('pricing.paygoHint')}</div>

      <div className="pricing-grid">
        {PACKAGES.map(pkg => (
          <div key={pkg.name} className={`pricing-card ${pkg.popular ? 'pricing-card-popular' : ''}`}>
            {pkg.popular && <div className="pricing-popular-badge">{t('pricing.popular')}</div>}
            <div className="pricing-card-name">{pkg.name}</div>
            <div className="pricing-card-price">
              <span className="pricing-currency">S$</span>
              <span className="pricing-amount">{pkg.price}</span>
            </div>
            <div className="pricing-card-credits">
              <Coins size={14} /> {pkg.credits} {t('pricing.credits')}
            </div>
            <div className="pricing-card-tagline">{t(pkg.taglineKey)}</div>
            <button className="btn btn-primary pricing-buy-btn"
              onClick={() => handlePurchase(pkg.name)}
              disabled={!!loading}>
              {loading === pkg.name ? <Loader size={14} className="spin" /> : t('pricing.buyNow')}
            </button>
            <div className="pricing-card-unit">
              S${(pkg.price / pkg.credits).toFixed(2)} {t('pricing.perCredit')}
            </div>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', margin: '1.5rem 0' }}>— {t('pricing.orPaygo')} —</div>

      {/* Pay As You Go */}
      <div className="pricing-paygo" style={{ maxWidth: 480, margin: '0 auto 2rem', padding: '1.5rem', background: 'var(--bg-card)', border: '2px solid var(--accent)', borderRadius: 'var(--radius-lg)', textAlign: 'center' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: '0.5rem' }}>{t('pricing.paygo')}</div>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>{t('pricing.paygoDesc')}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>S$</span>
          <input type="number" min={1} max={200} step={1} value={paygoAmount}
            onChange={e => setPaygoAmount(Math.max(1, Math.min(200, Number(e.target.value))))}
            style={{ width: 80, padding: '0.5rem', fontSize: '1.2rem', fontWeight: 700, textAlign: 'center', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }} />
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>=</span>
          <span style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--accent)' }}>{paygoAmount * 5}</span>
          <Coins size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{t('pricing.credits')}</span>
        </div>
        <button className="btn btn-primary" style={{ padding: '0.6rem 2rem', display: 'block', margin: '0 auto' }}
          onClick={() => handlePurchase('PayAsYouGo', paygoAmount)}
          disabled={!!loading || paygoAmount < 1}>
          {loading === 'PayAsYouGo' ? <Loader size={14} className="spin" /> : t('pricing.buyCredits', { credits: paygoAmount * 5, amount: paygoAmount })}
        </button>
      </div>

      <div className="pricing-features">
        <h2>{t('pricing.featuresTitle')}</h2>
        <div className="pricing-features-grid">
          {FEATURES.map((f, i) => (
            <div key={i} className="pricing-feature-item">
              <f.icon size={18} />
              <div>
                <div className="pricing-feature-name">{t(f.nameKey)}</div>
                <div className="pricing-feature-cost">{t(f.costKey)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pricing-faq">
        <h2>{t('pricing.faq')}</h2>
        {faq.map((item, i) => (
          <div key={i} className="pricing-faq-item" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
            <div className="pricing-faq-q">
              <span>{item.q}</span>
              {openFaq === i ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
            {openFaq === i && <div className="pricing-faq-a">{item.a}</div>}
          </div>
        ))}
      </div>

    </div>
  );
}
