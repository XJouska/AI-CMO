import { useState, useCallback } from 'react';
import api, { API_URL } from '../api';
import type { UserInfo, Recommendation, OverallStrategy, StepStatus, PlatformDone, Conversation, ProductInfo } from '../types';

export function useAuth() {
  const [user, setUser] = useState<UserInfo | null>(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/api/v1/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  };

  const register = async (username: string, email: string, password: string, referralCode?: string, responseLang?: string) => {
    const { data } = await api.post('/api/v1/auth/register', {
      username, email, password, referral_code: referralCode || undefined,
      response_language: responseLang || 'en',
    });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const { data } = await api.get('/api/v1/auth/me');
      setUser(data.user);
      localStorage.setItem('user', JSON.stringify(data.user));
    } catch {
      logout();
    }
  };

  return { user, login, register, logout, refreshUser };
}

export interface AnalysisState {
  isAnalyzing: boolean;
  currentStep: number;
  stepMessage: string;
  thinkingMessages: string[];
  detailMessages: string[];
  platformResults: Record<string, number>;
  recommendations: Recommendation[];
  strategy: OverallStrategy | null;
  productInfo: ProductInfo | null;
  error: string | null;
  done: boolean;
}

export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>({
    isAnalyzing: false,
    currentStep: 0,
    stepMessage: '',
    thinkingMessages: [],
    detailMessages: [],
    platformResults: {},
    recommendations: [],
    strategy: null,
    productInfo: null,
    error: null,
    done: false,
  });

  const startAnalysis = useCallback(async (input: string) => {
    setState({
      isAnalyzing: true,
      currentStep: 1,
      stepMessage: '🔍 正在分析您的产品...',
      thinkingMessages: [],
      detailMessages: [],
      platformResults: {},
      recommendations: [],
      strategy: null,
      productInfo: null,
      error: null,
      done: false,
    });

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/chat/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ input }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Analysis failed' }));
        throw new Error(err.detail || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Normalize \r\n to \n (sse-starlette sends \r\n)
        buffer = buffer.replace(/\r\n/g, '\n');

        // SSE events are separated by double newline
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed || trimmed.startsWith(':')) continue; // skip empty or ping

          let eventType = '';
          let eventData = '';

          for (const line of trimmed.split('\n')) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              eventData = line.slice(5).trim();
            }
            // Skip ping lines (": ping ...")
          }

          if (eventType && eventData) {
            try {
              const data = JSON.parse(eventData);
              processSSEEvent(eventType, data);
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setState(prev => ({ ...prev, error: message, isAnalyzing: false }));
    }
  }, []);

  const processSSEEvent = (type: string, data: unknown) => {
    switch (type) {
      case 'status': {
        const d = data as StepStatus;
        setState(prev => ({
          ...prev,
          currentStep: d.step,
          stepMessage: d.message,
        }));
        break;
      }
      case 'thinking': {
        const d = data as { content: string };
        setState(prev => ({
          ...prev,
          thinkingMessages: [...prev.thinkingMessages, d.content],
        }));
        break;
      }
      case 'detail': {
        const d = data as { message: string };
        setState(prev => ({
          ...prev,
          detailMessages: [...prev.detailMessages, d.message],
        }));
        break;
      }
      case 'product_info': {
        const d = data as ProductInfo;
        setState(prev => ({
          ...prev,
          productInfo: d,
        }));
        break;
      }
      case 'platform_done': {
        const d = data as PlatformDone;
        setState(prev => ({
          ...prev,
          platformResults: { ...prev.platformResults, [d.platform]: d.count },
        }));
        break;
      }
      case 'result': {
        const rec = data as Recommendation;
        setState(prev => ({
          ...prev,
          recommendations: [...prev.recommendations, rec],
        }));
        break;
      }
      case 'strategy': {
        setState(prev => ({
          ...prev,
          strategy: data as OverallStrategy,
        }));
        break;
      }
      case 'error': {
        const d = data as { message: string };
        setState(prev => ({ ...prev, error: d.message }));
        break;
      }
      case 'done': {
        setState(prev => ({ ...prev, done: true, isAnalyzing: false }));
        break;
      }
    }
  };

  const reset = () => {
    setState({
      isAnalyzing: false, currentStep: 0, stepMessage: '',
      thinkingMessages: [], detailMessages: [], platformResults: {},
      recommendations: [], strategy: null, productInfo: null, error: null, done: false,
    });
  };

  return { state, startAnalysis, reset };
}

export function useHistory() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/v1/chat/history');
      setConversations(data.conversations || []);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  const deleteConversation = async (id: string) => {
    try {
      await api.delete(`/api/v1/chat/history/${id}`);
      setConversations(prev => prev.filter(c => c.id !== id));
    } catch {
      // Ignore
    }
  };

  const getConversationDetail = async (id: string): Promise<Conversation | null> => {
    try {
      const { data } = await api.get(`/api/v1/chat/history/${id}`);
      return data;
    } catch {
      return null;
    }
  };

  return { conversations, loading, fetchHistory, deleteConversation, getConversationDetail };
}
