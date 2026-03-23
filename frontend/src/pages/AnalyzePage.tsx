import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useAnalysisStore } from '../stores/analysisStore';
import { useHistoryStore } from '../stores/historyStore';
import { useAuthStore } from '../stores/authStore';
import ChatInterface from '../components/ChatInterface';
import type { Recommendation, OverallStrategy } from '../types';

export default function AnalyzePage() {
  const { conversationId } = useParams();
  const location = useLocation();
  const initialInput = (location.state as { initialInput?: string } | null)?.initialInput;
  const { user, refreshUser } = useAuthStore();
  const analysisState = useAnalysisStore();
  const { getConversationDetail, fetchHistory } = useHistoryStore();
  const [viewingHistory, setViewingHistory] = useState<{
    recommendations: Recommendation[];
    strategy?: OverallStrategy | null;
    input_value: string;
  } | null>(null);
  const [pendingAnalysis, setPendingAnalysis] = useState<{ input_value: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (conversationId) {
      loadConversation(conversationId);
    } else {
      setViewingHistory(null);
      setPendingAnalysis(null);
      stopPolling();
      if (!analysisState.isAnalyzing && !analysisState.done) {
        analysisState.reset();
      }
    }
    return () => stopPolling();
  }, [conversationId]);

  useEffect(() => {
    if (analysisState.done && user) {
      refreshUser();
      fetchHistory();
    }
  }, [analysisState.done]);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const loadConversation = async (id: string) => {
    const detail = await getConversationDetail(id);
    if (!detail) return;

    if (detail.status === 'analyzing') {
      // Analysis still in progress on backend — show waiting UI and poll
      analysisState.reset();
      setViewingHistory(null);
      setPendingAnalysis({ input_value: detail.input_value });
      stopPolling();
      pollRef.current = setInterval(async () => {
        const updated = await getConversationDetail(id);
        if (updated && updated.status !== 'analyzing') {
          stopPolling();
          setPendingAnalysis(null);
          setViewingHistory({
            recommendations: updated.recommendations || [],
            strategy: updated.strategy || null,
            input_value: updated.input_value,
          });
          fetchHistory();
        }
      }, 5000);
    } else {
      // Completed or failed — show results directly
      analysisState.reset();
      setPendingAnalysis(null);
      setViewingHistory({
        recommendations: detail.recommendations || [],
        strategy: detail.strategy || null,
        input_value: detail.input_value,
      });
    }
  };

  const handleAnalyze = (input: string) => {
    setViewingHistory(null);
    setPendingAnalysis(null);
    stopPolling();
    analysisState.startAnalysis(input);
  };

  return (
    <ChatInterface
      analysisState={analysisState}
      onAnalyze={handleAnalyze}
      onStop={analysisState.stopAnalysis}
      isPremium={user?.is_premium ?? false}
      creditBalance={user?.credit_balance ?? 0}
      viewingHistory={viewingHistory}
      conversationId={conversationId}
      initialInput={initialInput}
      pendingAnalysis={pendingAnalysis}
    />
  );
}
