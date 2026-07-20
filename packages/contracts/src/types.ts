export type Category = {
  id: number;
  name: string;
  is_default: boolean;
  is_system: boolean;
};

export type OnboardingState = {
  user_id: string;
  country: string | null;
  default_currency: string;
  onboarding_complete: boolean;
  selected_category_ids: number[];
};

export type SessionShape = {
  user_id: string;
  email: string | null;
  access_token_expires_at: string | null;
};
