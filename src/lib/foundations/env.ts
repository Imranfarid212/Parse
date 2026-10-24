export type FoundationEnv = {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  /**
   * The WEB-type Google OAuth client id, which is what Supabase validates the
   * `aud` claim of a Google id token against. Native sign-in cannot produce a
   * usable token without it, so its absence is what selects the browser flow.
   */
  googleWebClientId: string | null;
  environment: string;
  mockBackend: boolean;
};

const normalize = (value: string | undefined) => {
  return value && value.trim().length > 0 ? value.trim() : null;
};

export function getFoundationEnv(): FoundationEnv {
  const mockBackend = normalize(process.env.EXPO_PUBLIC_MOCK_BACKEND) ?? normalize(process.env.MOCK_BACKEND) ?? '1';

  return {
    supabaseUrl: normalize(process.env.EXPO_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: normalize(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
    googleWebClientId: normalize(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
    environment: normalize(process.env.EXPO_PUBLIC_ENV) ?? 'local',
    mockBackend: mockBackend === '1',
  };
}
