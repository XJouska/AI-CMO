import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Search, Globe, RefreshCw, Square, X } from 'lucide-react';
import LoadingSteps from './LoadingSteps';
import ValueBanner from './ValueBanner';
import ActionList from './ActionList';
import StrategyPanel from './StrategyPanel';
import AIChatPanel from './AIChatPanel';
import type { AnalysisState } from '../stores/analysisStore';
import type { Recommendation, OverallStrategy } from '../types';

interface ChatInterfaceProps {
  analysisState: AnalysisState;
  onAnalyze: (input: string) => void;
  onStop?: () => void;
  isPremium: boolean;
  creditBalance: number;
  viewingHistory?: {
    recommendations: Recommendation[];
    strategy?: OverallStrategy | null;
    input_value: string;
  } | null;
  conversationId?: string;
  initialInput?: string;
  pendingAnalysis?: { input_value: string } | null;
  onDismissPending?: () => void;
}

const EXAMPLE_PROMPTS = [
  { label: 'u2foru.site', desc: 'Analyze a website URL' },
  { label: 'Notion', desc: 'Search by product name' },
  { label: 'ChatGPT', desc: 'Find growth opportunities' },
];

export default function ChatInterface({
  analysisState, onAnalyze, onStop, isPremium, creditBalance, viewingHistory, conversationId, initialInput, pendingAnalysis, onDismissPending
}: ChatInterfaceProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState(initialInput || '');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [userMessage, setUserMessage] = useState('');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [analysisState.recommendations.length, analysisState.currentStep, analysisState.strategy, analysisState.detailMessages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || analysisState.isAnalyzing) return;
    setUserMessage(input.trim());
    onAnalyze(input.trim());
    setInput('');
  };

  const handleChipClick = (prompt: string) => {
    if (analysisState.isAnalyzing) return;
    setUserMessage(prompt);
    onAnalyze(prompt);
  };

  const isActive = analysisState.isAnalyzing || analysisState.done || viewingHistory || pendingAnalysis;
  const showRecs = viewingHistory ? viewingHistory.recommendations : analysisState.recommendations;
  const showStrategy = viewingHistory ? viewingHistory.strategy : analysisState.strategy;
  const showInput = viewingHistory ? viewingHistory.input_value : pendingAnalysis ? pendingAnalysis.input_value : userMessage;

  const platformCount = new Set(showRecs.map(r => r.platform)).size;

  return (
    <div className="chat-area">
      <div className="chat-messages">
        {!isActive ? (
          <div className="welcome">
            <div className="welcome-icon">
              <img src="/logo.png?v=2" alt="AI-CMO" style={{ width: 48, height: 48, borderRadius: 10, background: 'transparent' }} />
            </div>
            <h1>AI-CMO</h1>
            <p>{t('chat.welcomeDesc')}</p>
            <div className="welcome-chips">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button key={prompt.label} className="welcome-chip" onClick={() => handleChipClick(prompt.label)}>
                  <Search size={14} style={{ opacity: 0.5 }} />
                  <span>{prompt.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {showInput && (
              <div className="message message-user">
                <div className="message-content">{showInput}</div>
              </div>
            )}

            {analysisState.productInfo && (
              <div className="product-info-card fadein">
                <div className="product-info-card-header">
                  <Globe size={14} style={{ color: 'var(--accent)' }} />
                  <span>Product Detected</span>
                </div>
                <div className="product-info-card-title">{analysisState.productInfo.title}</div>
                <div className="product-info-card-meta">
                  {analysisState.productInfo.product_name && <span>{analysisState.productInfo.product_name}</span>}
                  {analysisState.productInfo.product_type && <span>{analysisState.productInfo.product_type}</span>}
                </div>
                {analysisState.productInfo.description && (
                  <div className="product-info-card-desc">{analysisState.productInfo.description}</div>
                )}
                {analysisState.productInfo.target_audience && analysisState.productInfo.target_audience.length > 0 && (
                  <div className="product-info-card-audience">
                    {analysisState.productInfo.target_audience.map((a, i) => (
                      <span key={i} className="audience-tag">{a}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {pendingAnalysis && !analysisState.isAnalyzing && (
              <div className="pending-analysis fadein">
                <div className="pending-analysis-body">
                  <RefreshCw size={18} className="spin" style={{ color: 'var(--primary)' }} />
                  <div style={{ flex: 1 }}>
                    <div className="pending-analysis-title">{t('chat.analyzing')}</div>
                    <div className="pending-analysis-desc">{t('chat.pendingDesc')}</div>
                  </div>
                  {onDismissPending && (
                    <button className="btn btn-stop" onClick={onDismissPending} style={{ flexShrink: 0 }}>
                      <X size={14} /> {t('chat.stop')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {analysisState.isAnalyzing && (
              <div className="message message-assistant">
                <LoadingSteps
                  currentStep={analysisState.currentStep}
                  stepMessage={analysisState.stepMessage}
                  platformResults={analysisState.platformResults}
                  detailMessages={analysisState.detailMessages}
                  thinkingMessages={analysisState.thinkingMessages}
                />
              </div>
            )}

            {/* Value Banner + Action List + Strategy — the new compact results */}
            {showRecs.length > 0 && (
              <div className="results-container fadein">
                <ValueBanner
                  recommendations={showRecs}
                  platformCount={platformCount}
                />
                <ActionList
                  recommendations={showRecs}
                  isPremium={isPremium}
                  conversationId={conversationId}
                />
                {showStrategy && <StrategyPanel strategy={showStrategy} />}
              </div>
            )}

            {analysisState.error && (
              <div style={{
                padding: '1rem 1.25rem', background: 'rgba(255, 71, 87, 0.06)',
                border: '1px solid rgba(255, 71, 87, 0.15)', borderRadius: 'var(--radius-md)',
                color: 'var(--error)', fontSize: '0.875rem',
              }}>
                {analysisState.error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {!viewingHistory && (
        <div className="chat-input-area">
          <form className="chat-input-wrapper" onSubmit={handleSubmit}>
            <input
              className="chat-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={t('chat.placeholder')}
              disabled={analysisState.isAnalyzing}
            />
            {analysisState.isAnalyzing ? (
              <button type="button" className="btn btn-stop" onClick={onStop}>
                <Square size={14} /> {t('chat.stop') || 'Stop'}
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
                <Send size={14} /> {t('chat.send')}
              </button>
            )}
          </form>
          <div className="chat-input-info">
            <span>{t('pricing.perAnalysis')}</span>
            <span>{t('pricing.balance')}: {creditBalance} {t('pricing.credits')}</span>
          </div>
        </div>
      )}

      {(analysisState.done || viewingHistory) && (
        <AIChatPanel conversationId={conversationId} />
      )}
    </div>
  );
}
