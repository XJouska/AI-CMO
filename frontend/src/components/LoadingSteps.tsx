import { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Loader, Globe, Search, Zap, BarChart3, Star, FileText } from 'lucide-react';

interface LoadingStepsProps {
  currentStep: number;
  stepMessage: string;
  platformResults: Record<string, number>;
  detailMessages: string[];
  thinkingMessages: string[];
}

const PLATFORM_LOGOS: Record<string, string> = {
  reddit: 'https://cdn.simpleicons.org/reddit/FF4500',
  youtube: 'https://cdn.simpleicons.org/youtube/FF0000',
  twitter: 'https://cdn.simpleicons.org/x/000000',
  quora: 'https://cdn.simpleicons.org/quora/B92B27',
  producthunt: 'https://cdn.simpleicons.org/producthunt/DA552F',
  hackernews: 'https://cdn.simpleicons.org/ycombinator/FF6600',
  v2ex: 'https://cdn.simpleicons.org/v/4CCF95',
  zhihu: 'https://cdn.simpleicons.org/zhihu/0084FF',
  linkedin: 'https://cdn.simpleicons.org/linkedin/0A66C2',
  tiktok: 'https://cdn.simpleicons.org/tiktok/000000',
  instagram: 'https://cdn.simpleicons.org/instagram/E4405F',
  facebook: 'https://cdn.simpleicons.org/facebook/0866FF',
};

const PLATFORM_COLORS: Record<string, string> = {
  reddit: '#FF4500', youtube: '#FF0000', twitter: '#1DA1F2', quora: '#B92B27',
  producthunt: '#DA552F', hackernews: '#FF6600', v2ex: '#333', zhihu: '#0084FF',
};

export default function LoadingSteps({ currentStep, stepMessage, platformResults, detailMessages, thinkingMessages }: LoadingStepsProps) {
  const { t } = useTranslation();
  const logEndRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);

  const STEP_CONFIG = [
    { num: 1, key: 'step1', icon: Search, color: '#ff3b3b', desc: t('loading.step1') },
    { num: 2, key: 'step2', icon: Zap, color: '#ff9500', desc: t('loading.step2') },
    { num: 3, key: 'step3', icon: Globe, color: '#00d26a', desc: t('loading.step3') },
    { num: 4, key: 'step4', icon: BarChart3, color: '#1DA1F2', desc: t('loading.step4') },
    { num: 5, key: 'step5', icon: Star, color: '#ff3b3b', desc: t('loading.step5') },
    { num: 6, key: 'step6', icon: FileText, color: '#ff9500', desc: t('loading.step6') },
  ];

  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [detailMessages.length, thinkingMessages.length]);

  const totalResults = Object.values(platformResults).reduce((a, b) => a + b, 0);

  const plannedPlatformMatch = stepMessage.match(/(\d+)\s*(个|platform)/);
  const plannedPlatformCount = plannedPlatformMatch ? parseInt(plannedPlatformMatch[1]) : 6;
  const displayPlatformCount = plannedPlatformCount;

  return (
    <div className="analysis-panel">
      <div className="progress-header">
        <div className="progress-title">
          <Loader size={14} className="spin" style={{ color: 'var(--primary)' }} />
          <span>{stepMessage || t('loading.analyzing')}</span>
        </div>
        <span className="progress-timer">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
      </div>
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${Math.min((currentStep / 6) * 100, 100)}%` }} />
      </div>

      <div className="step-pills">
        {STEP_CONFIG.map(({ num, icon: Icon, color, desc }) => {
          const isDone = currentStep > num;
          const isActive = currentStep === num;
          return (
            <div key={num} className={`step-pill ${isDone ? 'done' : isActive ? 'active' : 'pending'}`}>
              <div className="step-pill-icon" style={isDone || isActive ? { background: color, color: '#fff' } : {}}>
                {isDone ? <CheckCircle size={12} /> : isActive ? <Loader size={12} className="spin" /> : <Icon size={12} />}
              </div>
              <span className="step-pill-label">{desc}</span>
            </div>
          );
        })}
      </div>

      <div className="step-detail-area">
        {currentStep === 1 && (
          <div className="detail-card fadein">
            <div className="detail-card-header">
              <Search size={16} style={{ color: '#ff3b3b' }} />
              <span>{t('loading.productAnalyzing')}</span>
            </div>
            <div className="detail-card-body">
              <div className="typing-indicator"><span></span><span></span><span></span></div>
              <p className="detail-hint">{t('loading.productHint')}</p>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="detail-card fadein">
            <div className="detail-card-header">
              <Zap size={16} style={{ color: '#ff9500' }} />
              <span>{t('loading.strategyReady')}</span>
            </div>
            <div className="detail-card-body">
              {thinkingMessages.map((msg, i) => (
                <div key={i} className="info-chip fadein" style={{ animationDelay: `${i * 0.15}s` }}>{msg}</div>
              ))}
            </div>
          </div>
        )}

        {currentStep >= 3 && currentStep <= 3 && (
          <div className="detail-card fadein">
            <div className="detail-card-header">
              <Globe size={16} style={{ color: '#00d26a' }} />
              <span>{t('loading.searching', { count: displayPlatformCount })}</span>
              {totalResults > 0 && <span className="result-badge">{totalResults} {t('loading.results')}</span>}
            </div>
            <div className="platform-grid">
              {detailMessages
                .filter(m => m.startsWith('🔍') || m.startsWith('✅') || m.startsWith('⚠️'))
                .filter(m => {
                  const hasSearch = m.includes('正在搜索') || m.includes('Searching') || m.includes('搜索');
                  const hasFound = m.includes('找到') || m.includes('found') || m.includes('Found');
                  return hasSearch || hasFound;
                })
                .map((msg, i) => {
                  const platMatch = msg.match(/(reddit|youtube|twitter|quora|producthunt|hackernews|v2ex|zhihu)/i);
                  const platform = platMatch ? platMatch[1].toLowerCase() : '';
                  const isDone = msg.includes('找到') || msg.includes('found');
                  const count = platformResults[platform] || 0;
                  const color = PLATFORM_COLORS[platform] || '#666';

                  return (
                    <div key={i} className={`platform-card fadein ${isDone ? 'done' : 'searching'}`}
                         style={{ animationDelay: `${i * 0.08}s` }}>
                      <div className="platform-card-icon" style={{ background: `${color}15` }}>
                        {PLATFORM_LOGOS[platform]
                          ? <img src={PLATFORM_LOGOS[platform]} alt={platform} width={18} height={18} />
                          : <Globe size={18} style={{ color }} />}
                      </div>
                      <div className="platform-card-info">
                        <div className="platform-card-name">{platform || 'unknown'}</div>
                        <div className="platform-card-status">
                          {isDone ? (
                            <><CheckCircle size={11} style={{ color: '#00d26a' }} /> {count} {t('loading.items')}</>
                          ) : (
                            <><Loader size={11} className="spin" /> {t('loading.searchingDots')}</>
                          )}
                        </div>
                      </div>
                      {isDone && (
                        <div className="platform-card-bar">
                          <div className="platform-card-bar-fill" style={{ width: `${Math.min(count * 3, 100)}%`, background: color }} />
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div className="detail-card fadein">
            <div className="detail-card-header">
              <BarChart3 size={16} style={{ color: '#1DA1F2' }} />
              <span>{t('loading.ranking', { count: totalResults })}</span>
            </div>
            <div className="detail-card-body">
              <div className="typing-indicator"><span></span><span></span><span></span></div>
              <p className="detail-hint">{t('loading.rankingHint')}</p>
            </div>
          </div>
        )}

        {currentStep === 5 && (
          <div className="detail-card fadein">
            <div className="detail-card-header">
              <Star size={16} style={{ color: '#ff3b3b' }} />
              <span>{t('loading.deepAnalysis')}</span>
            </div>
            <div className="detail-card-body">
              <div className="typing-indicator"><span></span><span></span><span></span></div>
              <p className="detail-hint">{t('loading.deepHint')}</p>
            </div>
          </div>
        )}

        {currentStep === 6 && (
          <div className="detail-card fadein">
            <div className="detail-card-header">
              <FileText size={16} style={{ color: '#ff9500' }} />
              <span>{t('loading.genStrategy')}</span>
            </div>
            <div className="detail-card-body">
              <div className="typing-indicator"><span></span><span></span><span></span></div>
              <p className="detail-hint">{t('loading.strategyHint')}</p>
            </div>
          </div>
        )}
      </div>

      {detailMessages.length > 0 && (
        <div className="live-log">
          <div className="live-log-header">
            <div className="live-dot" />
            <span>Activity Log</span>
            <span className="live-log-count">{detailMessages.length}</span>
          </div>
          <div className="live-log-body">
            {detailMessages.slice(-6).map((msg, i) => (
              <div key={i} className={`live-log-line ${i === Math.min(detailMessages.length, 6) - 1 ? 'latest' : ''}`}>
                <span className="live-log-msg">{msg}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
