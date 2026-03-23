import { create } from 'zustand';
import api from '../api';
import type { Conversation } from '../types';

interface HistoryState {
  conversations: Conversation[];
  loading: boolean;
  fetchHistory: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  getConversationDetail: (id: string) => Promise<Conversation | null>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  conversations: [],
  loading: false,

  fetchHistory: async () => {
    set({ loading: true });
    try {
      const { data } = await api.get('/api/v1/chat/history');
      set({ conversations: data.conversations || [] });
    } catch {
      // Ignore
    } finally {
      set({ loading: false });
    }
  },

  deleteConversation: async (id: string) => {
    try {
      await api.delete(`/api/v1/chat/history/${id}`);
      set({ conversations: get().conversations.filter(c => c.id !== id) });
    } catch {
      // Ignore
    }
  },

  getConversationDetail: async (id: string) => {
    try {
      const { data } = await api.get(`/api/v1/chat/history/${id}`);
      return data;
    } catch {
      return null;
    }
  },
}));
