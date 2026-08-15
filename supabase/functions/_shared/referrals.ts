// @ts-nocheck - shared by Supabase Edge Functions under Deno.
export const REFERRER_REWARD_SCANS = 10;
export const REFERRED_REWARD_SCANS = 5;
export const USER_REFERRAL_MAX_REWARDS = 4;
export const REFERRAL_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

export function parseReferralRequest(value: unknown) {
  const body = value as Record<string, unknown> | null;
  const code = normalizeReferralCode(body?.code);
  const entryMethod = body?.entry_method;
  const attestation = body?.attestation as Record<string, unknown> | null;
  if (!code) return { error: 'Enter a valid 6-character referral code.' } as const;
  if (entryMethod !== 'link' && entryMethod !== 'code') return { error: 'Invalid referral entry method.' } as const;
  if (!attestation || (attestation.platform !== 'ios' && attestation.platform !== 'android')) {
    return { error: 'Device verification is required.' } as const;
  }
  if (typeof attestation.token !== 'string' || attestation.token.length < 16 || attestation.token.length > 16_384) {
    return { error: 'Device verification is invalid.' } as const;
  }
  return {
    request: {
      code,
      entryMethod,
      attestation: {
        platform: attestation.platform,
        token: attestation.token,
        key_id: typeof attestation.key_id === 'string' ? attestation.key_id : null,
        challenge: typeof attestation.challenge === 'string' ? attestation.challenge : null,
      },
    },
  } as const;
}

const hex = (bytes: Uint8Array) => [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');

export async function hashIp(ip: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(ip))));
}

export type VerifiedAttestation = { valid: boolean; verdict: string; fraudFlags: Record<string, unknown> };

async function callIntegrityVerifier(input: {
  action: 'referral_redeem' | 'signup_integrity';
  proof: Record<string, unknown>;
  context: Record<string, unknown>;
}): Promise<VerifiedAttestation> {
  const url = Deno.env.get('APP_INTEGRITY_VERIFIER_URL');
  const authorization = Deno.env.get('APP_INTEGRITY_VERIFIER_AUTH');
  if (!url || !authorization) throw new Error('attestation verifier is not configured');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization}` },
    body: JSON.stringify({
      action: input.action,
      proof: input.proof,
      context: input.context,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`attestation verifier returned ${response.status}`);
  const verdict = await response.json();
  if (typeof verdict?.valid !== 'boolean' || typeof verdict?.verdict !== 'string') {
    throw new Error('attestation verifier returned an invalid response');
  }
  return {
    valid: verdict.valid,
    verdict: verdict.verdict.slice(0, 120),
    fraudFlags: verdict.risk_signals && typeof verdict.risk_signals === 'object' ? verdict.risk_signals : {},
  };
}

/**
 * App Attest and Play Integrity tokens are platform-signed opaque objects. A
 * dedicated verifier terminates those vendor protocols and returns only the
 * normalized verdict used by the transaction. The Edge Function fails closed
 * when that verifier is absent or unreachable.
 */
export async function verifyAttestation(input: {
  proof: Record<string, unknown>;
  userId: string;
  deviceId: string;
  code: string;
  entryMethod: 'link' | 'code';
}): Promise<VerifiedAttestation> {
  return callIntegrityVerifier({
    action: 'referral_redeem',
    proof: input.proof,
    context: {
      user_id: input.userId,
      device_id: input.deviceId,
      code: input.code,
      entry_method: input.entryMethod,
    },
  });
}

export async function verifySignupAttestation(input: {
  proof: Record<string, unknown>;
  userId: string;
  deviceId: string;
}): Promise<VerifiedAttestation> {
  return callIntegrityVerifier({
    action: 'signup_integrity',
    proof: input.proof,
    context: { user_id: input.userId, device_id: input.deviceId },
  });
}
