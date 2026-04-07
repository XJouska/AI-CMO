import { create } from 'zustand';
import api from '../api';
import type { UserInfo } from '../types';

interface AuthState {
  user: UserInfo | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  register: (username: string, email: string, password: string, referralCode?: string, responseLang?: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateSettings: (settings: { response_language?: string }) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: (() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  })(),

  login: async (email, password) => {
    const { data } = await api.post('/api/v1/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    set({ user: data.user });
  },

  loginWithGoogle: async (credential) => {
    const { data } = await api.post('/api/v1/auth/google', { credential });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    set({ user: data.user });
  },

  register: async (username, email, password, referralCode, responseLang) => {
    const { data } = await api.post('/api/v1/auth/register', {
      username, email, password,
      referral_code: referralCode || undefined,
      response_language: responseLang || 'en',
    });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    set({ user: data.user });
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    set({ user: null });
  },

  refreshUser: async () => {
    try {
      const { data } = await api.get('/api/v1/auth/me');
      set({ user: data.user });
      localStorage.setItem('user', JSON.stringify(data.user));
    } catch {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      set({ user: null });
    }
  },

  updateSettings: async (settings) => {
    const { data } = await api.put('/api/v1/auth/settings', settings);
    if (data.user) {
      set({ user: data.user });
      localStorage.setItem('user', JSON.stringify(data.user));
    }
  },
}));
