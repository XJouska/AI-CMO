import { create } from 'zustand';
import { API_URL } from '../api';
import type { Recommendation, OverallStrategy, ProductInfo, StepStatus, PlatformDone } from '../types';

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
  estimatedAdValue: number;
}

interface AnalysisActions {
  startAnalysis: (input: string) => Promise<void>;
  stopAnalysis: () => void;
  reset: () => void;
  restoreFromCache: () => void;
}

const defaultState: AnalysisState = {
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
  estimatedAdValue: 0,
};

function getInitialState(): AnalysisState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached.recommendations?.length > 0) {
        return {
          ...defaultState,
          currentStep: cached.currentStep || 0,
          stepMessage: cached.stepMessage || '',
          platformResults: cached.platformResults || {},
          recommendations: cached.recommendations || [],
          strategy: cached.strategy || null,
          productInfo: cached.productInfo || null,
          done: true,
          isAnalyzing: false,
          estimatedAdValue: cached.estimatedAdValue || 0,
        };
      }
    }
  } catch { /* ignore */ }
  return defaultState;
}

const initialState = getInitialState();

let _abortController: AbortController | null = null;

const STORAGE_KEY = 'aicmo_analysis_state';

function saveToStorage(state: AnalysisState) {
  try {
    const toSave = {
      currentStep: state.currentStep,
      stepMessage: state.stepMessage,
      platformResults: state.platformResults,
      recommendations: state.recommendations,
      strategy: state.strategy,
      productInfo: state.productInfo,
      done: state.done,
      estimatedAdValue: state.estimatedAdValue,
      isAnalyzing: state.isAnalyzing,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch { /* ignore */ }
}

function clearStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export const useAnalysisStore = create<AnalysisState & AnalysisActions>((set, get) => ({
  ...initialState,

  startAnalysis: async (input: string) => {
    _abortController?.abort();
    _abortController = new AbortController();
    const signal = _abortController.signal;
    clearStorage();

    set({
      ...defaultState,
      isAnalyzing: true,
      currentStep: 1,
      stepMessage: '🔍 正在分析您的产品...',
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
        signal,
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
        buffer = buffer.replace(/\r\n/g, '\n');

        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          let eventType = '';
          let eventData = '';

          for (const line of trimmed.split('\n')) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              eventData = line.slice(5).trim();
            }
          }

          if (eventType && eventData) {
            try {
              const data = JSON.parse(eventData);
              processSSEEvent(set, get, eventType, data);
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        set({ isAnalyzing: false, error: null, stepMessage: 'Analysis stopped.' });
        return;
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      set({ error: message, isAnalyzing: false });
    }
  },

  stopAnalysis: () => {
    _abortController?.abort();
    _abortController = null;
    set({ isAnalyzing: false, stepMessage: '' });
  },

  reset: () => {
    _abortController?.abort();
    _abortController = null;
    clearStorage();
    set(defaultState);
  },

  restoreFromCache: () => {},
}));

function processSSEEvent(
  set: (partial: Partial<AnalysisState>) => void,
  get: () => AnalysisState,
  type: string,
  data: unknown
) {
  const state = get();
  const _set = (partial: Partial<AnalysisState>) => {
    set(partial);
    saveToStorage({ ...get() });
  };

  switch (type) {
    case 'status': {
      const d = data as StepStatus;
      _set({ currentStep: d.step, stepMessage: d.message });
      break;
    }
    case 'thinking': {
      const d = data as { content: string };
      _set({ thinkingMessages: [...state.thinkingMessages, d.content] });
      break;
    }
    case 'detail': {
      const d = data as { message: string };
      _set({ detailMessages: [...state.detailMessages, d.message] });
      break;
    }
    case 'product_info': {
      _set({ productInfo: data as ProductInfo });
      break;
    }
    case 'platform_done': {
      const d = data as PlatformDone;
      _set({ platformResults: { ...state.platformResults, [d.platform]: d.count } });
      break;
    }
    case 'result': {
      _set({ recommendations: [...state.recommendations, data as Recommendation] });
      break;
    }
    case 'strategy': {
      _set({ strategy: data as OverallStrategy });
      break;
    }
    case 'error': {
      const d = data as { message: string };
      set({ error: d.message });
      clearStorage();
      break;
    }
    case 'done': {
      const d = data as { estimated_ad_value?: number };
      set({ done: true, isAnalyzing: false, estimatedAdValue: d.estimated_ad_value || 0 });
      clearStorage();
      break;
    }
  }
}
