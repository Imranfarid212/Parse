import { getFoundationEnv } from './env';

export type SupabaseHealthResult =
  | { ok: true; status: number; durationMs: number; environment: string; mockBackend: boolean }
  | { ok: false; reason: string; status?: number; durationMs?: number; environment: string; mockBackend: boolean };

const t15IntentionalBrokenTypecheck: string = 1;

function restUrl(projectUrl: string) {
  return `${projectUrl.replace(/\/+$/, '')}/rest/v1/rpc/health_check`;
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
      method: 'POST',
      headers: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${env.supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
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

    const value = Number(await response.text());

    if (value !== 1) {
      return {
        ok: false,
        reason: `Supabase health_check returned ${value}.`,
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
