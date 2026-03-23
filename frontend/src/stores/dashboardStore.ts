import { create } from 'zustand';
import api from '../api';

interface DashboardOverview {
  total_analyses: number;
  total_recommendations: number;
  platforms_covered: number;
  credit_balance: number;
  recent_analyses: Array<{
    id: string;
    title: string;
    status: string;
    created_at: string;
    recommendation_count: number;
  }>;
  platform_distribution: Record<string, number>;
}

interface DashboardState {
  overview: DashboardOverview | null;
  loading: boolean;
  fetchOverview: () => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  overview: null,
  loading: false,

  fetchOverview: async () => {
    set({ loading: true });
    try {
      const { data } = await api.get('/api/v1/dashboard/overview');
      set({ overview: data });
    } catch {
      // Ignore
    } finally {
      set({ loading: false });
    }
  },
}));
