import { useRef, useEffect, useState } from 'react';
import { CheckCircle, Loader, Globe, Search, Zap, BarChart3, Star, FileText } from 'lucide-react';

interface LoadingStepsProps {
  currentStep: number;
  stepMessage: string;
  platformResults: Record<string, number>;
  detailMessages: string[];
  thinkingMessages: string[];
}

const PLATFORM_ICONS: Record<string, string> = {
  reddit: '🟠', youtube: '🔴', twitter: '🐦', quora: '🔵',
  producthunt: '🟧', hackernews: '🟡', v2ex: '💚', zhihu: '🔷',
};

const PLATFORM_COLORS: Record<string, string> = {
  reddit: '#FF4500', youtube: '#FF0000', twitter: '#1DA1F2', quora: '#B92B27',
  producthunt: '#DA552F', hackernews: '#FF6600', v2ex: '#333', zhihu: '#0084FF',
};

const STEP_CONFIG = [
  { num: 1, key: 'step1', icon: Search, color: '#ff3b3b', desc: '分析产品' },
  { num: 2, key: 'step2', icon: Zap, color: '#ff9500', desc: '搜索策略' },
  { num: 3, key: 'step3', icon: Globe, color: '#00d26a', desc: '全网搜索' },
  { num: 4, key: 'step4', icon: BarChart3, color: '#1DA1F2', desc: '评估价值' },
  { num: 5, key: 'step5', icon: Star, color: '#ff3b3b', desc: '推荐分析' },
  { num: 6, key: 'step6', icon: FileText, color: '#ff9500', desc: '运营策略' },
];

export default function LoadingSteps({ currentStep, stepMessage, platformResults, detailMessages, thinkingMessages }: LoadingStepsProps) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);

  // Timer
  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [detailMessages.length, thinkingMessages.length]);

  const totalPlatforms = Object.keys(platformResults).length;
  const totalResults = Object.values(platformResults).reduce((a, b) => a + b, 0);

  // Extract planned platform count from step 2 status message
  const plannedPlatformMatch = stepMessage.match(/搜索\s*(\d+)\s*个/);
  const plannedPlatformCount = plannedPlatformMatch ? parseInt(plannedPlatformMatch[1]) : 6;
  const displayPlatformCount = totalPlatforms || plannedPlatformCount;

  return (
    <div className="analysis-panel">
      {/* Progress bar */}
      <div className="progress-header">
        <div className="progress-title">
          <Loader size={14} className="spin" style={{ color: 'var(--primary)' }} />
          <span>{stepMessage || '分析中...'}</span>
        </div>
        <span className="progress-timer">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
      </div>
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${Math.min((currentStep / 6) * 100, 100)}%` }} />
      </div>

      {/* Step pills */}
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

      {/* Active step detail area */}
      <div className="step-detail-area">
        {/* Product Analysis (Step 1) */}
        {currentStep === 1 && (
          <div className="detail-card fadein">
            <div className="detail-card-header">
              <Search size={16} style={{ color: '#ff3b3b' }} />
              <span>产品分析中</span>
            </div>
            <div className="detail-card-body">
              <div className="typing-indicator">
                <span></span><span></span><span></span>
              </div>
              <p className="detail-hint">AI 正在识别产品类型、目标用户和核心关键词...</p>
            </div>
          </div>
        )}

        {/* Search Strategy (Step 2) */}
        {currentStep === 2 && (
          <div className="detail-card fadein">
            <div className="detail-card-header">
              <Zap size={16} style={{ color: '#ff9500' }} />
              <span>搜索策略已生成</span>
            </div>
            <div className="detail-card-body">
              {thinkingMessages.map((msg, i) => (
                <div key={i} className="info-chip fadein" style={{ animationDelay: `${i * 0.15}s` }}>{msg}</div>
              ))}
              {detailMessages.filter(m => m.includes('关键词') || m.includes('竞品') || m.includes('搜索计划')).map((msg, i) => (
                <div key={`d${i}`} className="info-chip fadein" style={{ animationDelay: `${(i + thinkingMessages.length) * 0.15}s` }}>{msg}</div>
              ))}
            </div>
          </div>
        )}

        {/* Platform Scraping (Step 3) — 2-column grid */}
        {currentStep >= 3 && currentStep <= 3 && (
          <div className="detail-card fadein">
            <div className="detail-card-header">
              <Globe size={16} style={{ color: '#00d26a' }} />
              <span>正在搜索 {displayPlatformCount} 个平台</span>
              {totalResults > 0 && <span className="result-badge">{totalResults} 条结果</span>}
            </div>
            <div className="platform-grid">
              {detailMessages
                .filter(m => m.startsWith('🔍') || m.startsWith('✅') || m.startsWith('⚠️'))
                .filter(m => m.includes('正在搜索') || m.includes('找到'))
                .map((msg, i) => {
                  const platMatch = msg.match(/(reddit|youtube|twitter|quora|producthunt|hackernews|v2ex|zhihu)/i);
                  const platform = platMatch ? platMatch[1].toLowerCase() : '';
                  const isDone = msg.includes('找到');
                  const count = platformResults[platform] || 0;
                  const color = PLATFORM_COLORS[platform] || '#666';

                  return (
                    <div key={i} className={`platform-card fadein ${isDone ? 'done' : 'searching'}`}
                         style={{ animationDelay: `${i * 0.08}s` }}>
                      <div className="platform-card-icon" style={{ background: `${color}15`, color }}>
                        {PLATFORM_ICONS[platform] || '🌐'}
                      </div>
                      <div className="platform-card-info">
                        <div className="platform-card-name">{platform || 'unknown'}</div>
                        <div className="platform-card-status">
                          {isDone ? (
                            <><CheckCircle size={11} style={{ color: '#00d26a' }} /> {count} 条</>
                          ) : (
                            <><Loader size={11} className="spin" /> 搜索中...</>
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
              {/* Scrape URLs */}
              {detailMessages.filter(m => m.startsWith('🔗')).length > 0 && (
                <div className="scrape-urls">
                  {detailMessages.filter(m => m.startsWith('🔗')).slice(-4).map((msg, i) => (
                    <div key={i} className="scrape-url-line fadein" style={{ animationDelay: `${i * 0.06}s` }}>
                      {msg}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Scoring (Step 4) */}
        {currentStep === 4 && (
          <div className="detail-card fadein">
            <div className="detail-card-header">
              <BarChart3 size={16} style={{ color: '#1DA1F2' }} />
              <span>AI 正在多维度评分</span>
            </div>
            <div className="detail-card-body">
              <div className="scoring-dims">
                {['互动量', '时效性', '相关性', '推广潜力', '受众匹配'].map((dim, i) => (
                  <div key={dim} className="scoring-dim fadein" style={{ animationDelay: `${i * 0.15}s` }}>
                    <span className="scoring-dim-label">{dim}</span>
                    <div className="scoring-dim-bar">
                      <div className="scoring-dim-fill" style={{
                        animationDelay: `${i * 0.15 + 0.3}s`,
                        background: `hsl(${i * 50}, 60%, 50%)`,
                      }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="detail-hint">正在从 {totalResults} 条内容中筛选 Top 10...</p>
            </div>
          </div>
        )}

        {/* Deep Analysis (Step 5) */}
        {currentStep === 5 && (
          <div className="detail-card fadein">
            <div className="detail-card-header">
              <Star size={16} style={{ color: '#ff3b3b' }} />
              <span>深度分析 Top 推荐</span>
            </div>
            <div className="detail-card-body">
              <div className="typing-indicator"><span></span><span></span><span></span></div>
              <p className="detail-hint">正在为每条推荐生成推广理由、最佳时机和话术...</p>
            </div>
          </div>
        )}

        {/* Strategy (Step 6) */}
        {currentStep === 6 && (
          <div className="detail-card fadein">
            <div className="detail-card-header">
              <FileText size={16} style={{ color: '#ff9500' }} />
              <span>生成运营策略</span>
            </div>
            <div className="detail-card-body">
              <div className="typing-indicator"><span></span><span></span><span></span></div>
              <p className="detail-hint">正在生成每周推广节奏、KPI 目标和预算建议...</p>
            </div>
          </div>
        )}
      </div>

      {/* Live log */}
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
