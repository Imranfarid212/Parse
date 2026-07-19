import { getFoundationEnv } from './env';

export type SupabaseHealthResult =
  | { ok: true; status: number; durationMs: number; environment: string; mockBackend: boolean }
  | { ok: false; reason: string; status?: number; durationMs?: number; environment: string; mockBackend: boolean };

function restUrl(projectUrl: string) {
  return `${projectUrl.replace(/\/+$/, '')}/rest/v1/`;
}

export async function checkSupabaseHealth(): Promise<SupabaseHealthResult> {
  const env = getFoundationEnv();

  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return {
      ok: false,
      reason: 'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.',
      environment: env.environment,
      mockBackend: env.mockBackend,
    };
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(restUrl(env.supabaseUrl), {
      headers: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${env.supabaseAnonKey}`,
      },
    });
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        ok: false,
        reason: `Supabase REST responded with HTTP ${response.status}.`,
        status: response.status,
        durationMs,
        environment: env.environment,
        mockBackend: env.mockBackend,
      };
    }

    return {
      ok: true,
      status: response.status,
      durationMs,
      environment: env.environment,
      mockBackend: env.mockBackend,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Supabase REST round-trip failed.',
      durationMs: Date.now() - startedAt,
      environment: env.environment,
      mockBackend: env.mockBackend,
    };
  }
}
