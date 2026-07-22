export type FoundationEnv = {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
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
    environment: normalize(process.env.EXPO_PUBLIC_ENV) ?? 'local',
    mockBackend: mockBackend === '1',
  };
}
