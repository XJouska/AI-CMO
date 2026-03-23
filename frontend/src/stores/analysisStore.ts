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
}

interface AnalysisActions {
  startAnalysis: (input: string) => Promise<void>;
  stopAnalysis: () => void;
  reset: () => void;
}

const initialState: AnalysisState = {
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
};

let _abortController: AbortController | null = null;

export const useAnalysisStore = create<AnalysisState & AnalysisActions>((set, get) => ({
  ...initialState,

  startAnalysis: async (input: string) => {
    _abortController?.abort();
    _abortController = new AbortController();
    const signal = _abortController.signal;

    set({
      ...initialState,
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
    set(initialState);
  },
}));

function processSSEEvent(
  set: (partial: Partial<AnalysisState>) => void,
  get: () => AnalysisState,
  type: string,
  data: unknown
) {
  const state = get();
  switch (type) {
    case 'status': {
      const d = data as StepStatus;
      set({ currentStep: d.step, stepMessage: d.message });
      break;
    }
    case 'thinking': {
      const d = data as { content: string };
      set({ thinkingMessages: [...state.thinkingMessages, d.content] });
      break;
    }
    case 'detail': {
      const d = data as { message: string };
      set({ detailMessages: [...state.detailMessages, d.message] });
      break;
    }
    case 'product_info': {
      set({ productInfo: data as ProductInfo });
      break;
    }
    case 'platform_done': {
      const d = data as PlatformDone;
      set({ platformResults: { ...state.platformResults, [d.platform]: d.count } });
      break;
    }
    case 'result': {
      set({ recommendations: [...state.recommendations, data as Recommendation] });
      break;
    }
    case 'strategy': {
      set({ strategy: data as OverallStrategy });
      break;
    }
    case 'error': {
      const d = data as { message: string };
      set({ error: d.message });
      break;
    }
    case 'done': {
      set({ done: true, isAnalyzing: false });
      break;
    }
  }
}
