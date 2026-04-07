import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useAnalysisStore } from '../stores/analysisStore';
import { useHistoryStore } from '../stores/historyStore';
import { useAuthStore } from '../stores/authStore';
import ChatInterface from '../components/ChatInterface';
import api from '../api';
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
    refreshUser();
  }, []);

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
      if (analysisState.done && analysisState.recommendations.length > 0) {
        setViewingHistory(null);
        setPendingAnalysis(null);
      } else {
        setViewingHistory(null);
        setPendingAnalysis({ input_value: detail.input_value });
      }
      stopPolling();
      pollRef.current = setInterval(async () => {
        const updated = await getConversationDetail(id);
        if (updated && updated.status !== 'analyzing') {
          stopPolling();
          localStorage.removeItem('aicmo_analysis_state');
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

  const lastConvIdRef = useRef<string | null>(null);

  const handleAnalyze = (input: string) => {
    setViewingHistory(null);
    setPendingAnalysis(null);
    stopPolling();
    analysisState.startAnalysis(input);
    setTimeout(() => refreshUser(), 2000);
  };

  // Track the latest conversation ID from history for cancel
  useEffect(() => {
    if (conversationId) lastConvIdRef.current = conversationId;
  }, [conversationId]);

  // Also track from history store when a new analysis starts
  useEffect(() => {
    if (analysisState.isAnalyzing) {
      fetchHistory().then(() => {
        const convs = useHistoryStore.getState().conversations;
        if (convs.length > 0 && convs[0].status === 'analyzing') {
          lastConvIdRef.current = convs[0].id;
        }
      });
    }
  }, [analysisState.isAnalyzing]);

  const handleDismissPending = async () => {
    stopPolling();
    if (conversationId) {
      try { await api.post(`/api/v1/chat/cancel/${conversationId}`); } catch { /* ignore */ }
    }
    setPendingAnalysis(null);
    analysisState.reset();
    refreshUser();
  };

  const handleStop = async () => {
    analysisState.stopAnalysis();
    const cid = lastConvIdRef.current || conversationId;
    if (cid) {
      try { await api.post(`/api/v1/chat/cancel/${cid}`); } catch { /* ignore */ }
    }
    refreshUser();
  };

  return (
    <ChatInterface
      analysisState={analysisState}
      onAnalyze={handleAnalyze}
      onStop={handleStop}
      isPremium={user?.is_premium ?? false}
      creditBalance={user?.credit_balance ?? 0}
      viewingHistory={viewingHistory}
      conversationId={conversationId}
      initialInput={initialInput}
      pendingAnalysis={pendingAnalysis}
      onDismissPending={handleDismissPending}
    />
  );
}
