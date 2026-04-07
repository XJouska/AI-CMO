import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Coins, Sparkles, Search, Radar, Users, Shield, Zap, ChevronDown, ChevronUp, Loader } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import api from '../api';

const PACKAGES = [
  {
    name: 'Starter',
    price: 7.99,
    credits: 7,
    tagline: 'A full week of daily analysis',
    popular: false,
  },
  {
    name: 'Standard',
    price: 14.99,
    credits: 15,
    tagline: 'Two weeks of insights, plus extras',
    popular: true,
  },
  {
    name: 'Pro',
    price: 22.99,
    credits: 25,
    tagline: 'A full month of daily analysis',
    popular: false,
  },
  {
    name: 'Ultra',
    price: 99.99,
    credits: 115,
    tagline: '4+ months of daily usage, best value',
    popular: false,
  },
];

const FEATURES = [
  { icon: Search, name: 'Social Media Analysis', cost: '1 credit', included: true },
  { icon: Radar, name: 'GEO Visibility Scan', cost: '1 credit', included: true },
  { icon: Users, name: 'Competitor Deep Analysis', cost: '1 credit', included: true },
  { icon: Shield, name: 'SEO Health Check', cost: 'Free', included: true },
  { icon: Sparkles, name: 'AI Content Generation', cost: 'Free', included: true },
  { icon: Zap, name: 'Competitor Auto-Discovery', cost: 'Free', included: true },
];

const FAQ = [
  {
    q: 'What is a credit?',
    a: 'Each credit allows you to run one analysis (social media scan, GEO visibility check, or competitor analysis). SEO checks and AI content generation are always free.',
  },
  {
    q: 'Do credits expire?',
    a: 'No. Credits never expire. Use them whenever you need.',
  },
  {
    q: 'What payment methods are accepted?',
    a: 'We accept Visa, Mastercard, PayPal, WeChat Pay, Alipay, and other international cards via our payment partner.',
  },
];

export default function PricingPage() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuthStore();
  const [loading, setLoading] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const handlePurchase = async (pkgName: string) => {
    setLoading(pkgName);
    try {
      const { data } = await api.post('/api/v1/credits/checkout', { package_name: pkgName });
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
        <p className="pricing-subtitle">Power your marketing with credits. Pay only for what you use.</p>
        <div className="pricing-balance">
          <Coins size={18} />
          <span>{t('pricing.balance')}: <strong>{user?.credit_balance ?? 0}</strong> {t('pricing.credits')}</span>
        </div>
      </div>

      <div className="pricing-grid">
        {PACKAGES.map(pkg => (
          <div key={pkg.name} className={`pricing-card ${pkg.popular ? 'pricing-card-popular' : ''}`}>
            {pkg.popular && <div className="pricing-popular-badge">POPULAR</div>}
            <div className="pricing-card-name">{pkg.name}</div>
            <div className="pricing-card-price">
              <span className="pricing-currency">S$</span>
              <span className="pricing-amount">{pkg.price}</span>
            </div>
            <div className="pricing-card-credits">
              <Coins size={14} /> {pkg.credits} credits
            </div>
            <div className="pricing-card-tagline">{pkg.tagline}</div>
            <button className="btn btn-primary pricing-buy-btn"
              onClick={() => handlePurchase(pkg.name)}
              disabled={!!loading}>
              {loading === pkg.name ? <Loader size={14} className="spin" /> : 'Buy Now'}
            </button>
            <div className="pricing-card-unit">
              S${(pkg.price / pkg.credits).toFixed(2)} per credit
            </div>
          </div>
        ))}
      </div>

      <div className="pricing-features">
        <h2>What you can do with credits</h2>
        <div className="pricing-features-grid">
          {FEATURES.map((f, i) => (
            <div key={i} className="pricing-feature-item">
              <f.icon size={18} />
              <div>
                <div className="pricing-feature-name">{f.name}</div>
                <div className="pricing-feature-cost">{f.cost}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pricing-faq">
        <h2>FAQ</h2>
        {FAQ.map((item, i) => (
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
