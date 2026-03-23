import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Sparkles, Search, Globe, RefreshCw, Square } from 'lucide-react';
import LoadingSteps from './LoadingSteps';
import RecommendCard from './RecommendCard';
import StrategyPanel from './StrategyPanel';
import TerminalLog from './TerminalLog';
import AnalysisSummaryCard from './analysis/AnalysisSummaryCard';
import PlatformBreakdown from './analysis/PlatformBreakdown';
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
}

const EXAMPLE_PROMPTS = [
  { label: 'u2foru.site', desc: 'Analyze a website URL' },
  { label: 'Notion', desc: 'Search by product name' },
  { label: 'ChatGPT', desc: 'Find growth opportunities' },
];

export default function ChatInterface({
  analysisState, onAnalyze, onStop, isPremium, creditBalance, viewingHistory, conversationId, initialInput, pendingAnalysis
}: ChatInterfaceProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState(initialInput || '');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [userMessage, setUserMessage] = useState('');

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
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

  const totalResults = showRecs.length;
  const platformsSearched = Object.keys(analysisState.platformResults).length;

  const handleExportCSV = () => {
    if (!isPremium) return;
    const headers = ['Rank', 'Platform', 'Title', 'URL', 'Score', 'Upvotes', 'Comments', 'Views', 'Exposure', 'Best Timing', 'Risk', 'Why Recommend', 'Suggested Comment'];
    const escape = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
    const rows = showRecs.map(r => [
      r.rank,
      r.platform,
      escape(r.title),
      r.url,
      r.composite_score ?? '',
      r.engagement_stats?.upvotes ?? '',
      r.engagement_stats?.comments ?? '',
      r.engagement_stats?.views ?? '',
      escape(r.estimated_exposure || ''),
      escape(r.best_timing || ''),
      r.risk_level || '',
      escape(r.why_recommend || ''),
      escape(r.suggested_comment || ''),
    ].join(','));

    if (showStrategy) {
      rows.push('');
      rows.push('--- Strategy ---');
      if (showStrategy.priority_actions?.length) {
        rows.push(`Priority Actions,${escape(showStrategy.priority_actions.join('; '))}`);
      }
      if (showStrategy.weekly_plan) rows.push(`Weekly Plan,${escape(showStrategy.weekly_plan)}`);
      if (showStrategy.kpi_targets) rows.push(`KPI Targets,${escape(showStrategy.kpi_targets)}`);
      if (showStrategy.budget_suggestion) rows.push(`Budget,${escape(showStrategy.budget_suggestion)}`);
    }

    const bom = '\uFEFF';
    const csv = bom + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-cmo-analysis-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="chat-area">
      <div className="chat-messages">
        {!isActive ? (
          <div className="welcome">
            <div className="welcome-icon">
              <Sparkles size={30} color="var(--primary)" />
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
            {/* User message */}
            {showInput && (
              <div className="message message-user">
                <div className="message-content">{showInput}</div>
              </div>
            )}

            {/* Product info card */}
            {analysisState.productInfo && (
              <div className="product-info-card fadein">
                <div className="product-info-card-header">
                  <Globe size={14} style={{ color: 'var(--accent)' }} />
                  <span>Product Detected</span>
                </div>
                <div className="product-info-card-title">{analysisState.productInfo.title}</div>
                <div className="product-info-card-meta">
                  {analysisState.productInfo.product_name && (
                    <span>{analysisState.productInfo.product_name}</span>
                  )}
                  {analysisState.productInfo.product_type && (
                    <span>{analysisState.productInfo.product_type}</span>
                  )}
                </div>
                {analysisState.productInfo.content && (
                  <div className="product-info-card-content">
                    {analysisState.productInfo.content}
                  </div>
                )}
              </div>
            )}

            {/* Pending analysis (page refreshed during analysis) */}
            {pendingAnalysis && !analysisState.isAnalyzing && (
              <div className="pending-analysis fadein">
                <div className="pending-analysis-icon">
                  <RefreshCw size={24} className="spin" />
                </div>
                <div className="pending-analysis-body">
                  <div className="pending-analysis-title">{t('chat.analyzing')}</div>
                  <div className="pending-analysis-desc">
                    {t('chat.pendingDesc') || 'Analysis is running on the server. Results will appear automatically when ready...'}
                  </div>
                </div>
              </div>
            )}

            {/* Loading Steps (only during active SSE analysis) */}
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

            {/* Completed summary card */}
            {analysisState.done && !viewingHistory && totalResults > 0 && (
              <AnalysisSummaryCard
                recommendations={showRecs}
                platformResults={analysisState.platformResults}
                isPremium={isPremium}
                onExportCSV={handleExportCSV}
              />
            )}

            {/* Summary card for history viewing */}
            {viewingHistory && showRecs.length > 0 && (
              <AnalysisSummaryCard
                recommendations={showRecs}
                platformResults={{}}
                isPremium={isPremium}
                onExportCSV={handleExportCSV}
              />
            )}

            {/* Platform breakdown chart */}
            {analysisState.done && !viewingHistory && platformsSearched > 0 && (
              <PlatformBreakdown platformResults={analysisState.platformResults} />
            )}

            {/* Terminal log during analysis */}
            {analysisState.isAnalyzing && (
              <TerminalLog
                messages={analysisState.detailMessages}
                thinkingMessages={analysisState.thinkingMessages}
              />
            )}

            {/* Skeleton cards while loading */}
            {analysisState.isAnalyzing && analysisState.currentStep >= 4 && showRecs.length === 0 && (
              <>
                <div className="skeleton skeleton-card" />
                <div className="skeleton skeleton-card" />
                <div className="skeleton skeleton-card" />
              </>
            )}

            {/* Recommendation cards */}
            {showRecs.map((rec, i) => (
              <RecommendCard key={i} recommendation={rec} isPremium={isPremium} index={i} />
            ))}

            {/* Strategy panel */}
            {showStrategy && <StrategyPanel strategy={showStrategy} />}

            {/* Error */}
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

      {/* Input area */}
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

      {/* AI Chat Panel (visible after analysis or when viewing history) */}
      {(analysisState.done || viewingHistory) && (
        <AIChatPanel conversationId={conversationId} />
      )}
    </div>
  );
}
