export interface UserInfo {
  id: number;
  email: string;
  username: string;
  is_premium?: boolean;
  is_admin?: boolean;
  credit_balance?: number;
  referral_code?: string;
  response_language?: string;
  brand_voice?: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  token?: string;
  user?: UserInfo;
}

export interface ProductInfo {
  title: string;
  content: string;
  product_name: string;
  product_type: string;
  description?: string;
  target_audience?: string[];
}

export interface Recommendation {
  id?: string;
  rank: number;
  platform: string;
  url: string;
  title: string;
  engagement_stats?: {
    upvotes?: number;
    comments?: number;
    views?: number;
    shares?: number;
  };
  composite_score?: number;
  scoring_detail?: Record<string, number>;
  why_recommend?: string;
  estimated_exposure?: string;
  best_timing?: string;
  risk_level?: string;
  risk_note?: string;
  suggested_comment?: string;
  comment_strategy?: string;
  is_premium_only?: boolean;
}

export interface OverallStrategy {
  priority_actions?: string[];
  market_insights?: string;
  content_angles?: string[];
  hot_topics?: string[];
  user_pain_points?: string[];
  competitor_mentions?: string[];
  platform_breakdown?: Record<string, string>;
  weekly_plan?: string;
  content_calendar?: string;
  kpi_targets?: string;
  budget_suggestion?: string;
}

export interface Conversation {
  id: string;
  title: string;
  input_type: string;
  input_value: string;
  status: string;
  created_at: string;
  product_profile?: Record<string, unknown>;
  recommendations?: Recommendation[];
  strategy?: OverallStrategy;
}

export interface SSEEvent {
  event: string;
  data: unknown;
}

export interface StepStatus {
  step: number;
  message: string;
}

export interface PlatformDone {
  platform: string;
  count: number;
}

export interface CreditPackage {
  name: string;
  price_sgd: number;
  price_cny: number;
  credits: number;
}
