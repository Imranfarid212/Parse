import { Share } from 'react-native';

import {
  REFERRED_REWARD_SCANS,
  REFERRER_REWARD_SCANS,
  USER_REFERRAL_MAX_REWARDS,
  normalizeReferralCode,
  type ReferralEntryMethod,
  type ReferralRedeemResponse,
  type ReferralSummary,
} from '@/../packages/contracts/src/referrals';
import { getDeviceId } from '@/lib/auth/device';
import { supabase } from '@/lib/auth/supabase';
import { getFoundationEnv } from '@/lib/foundations/env';
import { createReferralAttestation } from '@/lib/referrals/integrity';

export class ReferralError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ReferralError';
  }
}

function asErrorPayload(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function functionErrorPayload(data: unknown, error: unknown) {
  const direct = asErrorPayload(data);
  if (direct) return direct;

  // FunctionsHttpError may carry a response created by a different fetch
  // implementation/realm on native. Use its response shape rather than
  // `instanceof Response`, which is unreliable with Expo and React Native.
  const context = (error as { context?: unknown } | null)?.context as {
    clone?: () => unknown;
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  } | null | undefined;
  if (!context || (typeof context.json !== 'function' && typeof context.text !== 'function')) return null;

  let readable = context;
  if (typeof context.clone === 'function') {
    try { readable = context.clone() as typeof context; } catch { /* use the original response */ }
  }
  if (typeof readable.json === 'function') {
    try {
      const parsed = asErrorPayload(await readable.json());
      if (parsed) return parsed;
    } catch { /* fall through to text when available */ }
  }
  if (typeof readable.text === 'function') {
    try { return asErrorPayload(await readable.text()); } catch { return null; }
  }
  return null;
}

export async function getReferralSummary(): Promise<ReferralSummary> {
  if (getFoundationEnv().mockBackend) {
    return { code: 'PARSE2', rewarded: 0, max_rewards: USER_REFERRAL_MAX_REWARDS, referred: false };
  }
  const { data, error } = await supabase.rpc('get_referral_summary');
  if (error) throw new ReferralError('Could not load your referral details.', error.code ?? 'SUMMARY_FAILED');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.out_code) throw new ReferralError('Your referral code is not ready yet.', 'SUMMARY_MISSING');
  return {
    code: row.out_code,
    rewarded: Number(row.out_rewarded ?? 0),
    max_rewards: Number(row.out_max_rewards ?? USER_REFERRAL_MAX_REWARDS),
    referred: row.out_referred === true,
  };
}

export async function redeemReferral(codeInput: string, entryMethod: ReferralEntryMethod): Promise<ReferralRedeemResponse> {
  const code = normalizeReferralCode(codeInput);
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new ReferralError('Sign in before applying a referral code.', 'UNAUTHORIZED');
  const attestation = await createReferralAttestation(userId, code, entryMethod);
  const deviceId = await getDeviceId();
  const { data, error } = await supabase.functions.invoke('referral-redeem', {
    body: { code, entry_method: entryMethod, attestation },
    headers: { 'x-rf-device-id': deviceId },
  });
  if (error) {
    const payload = await functionErrorPayload(data, error);
    const message = typeof payload?.message === 'string' ? payload.message : 'Could not apply the referral code.';
    throw new ReferralError(message, typeof payload?.code === 'string' ? payload.code : 'REDEEM_FAILED');
  }
  return data as ReferralRedeemResponse;
}

export async function shareReferral(code: string): Promise<void> {
  const appStoreUrl = process.env.EXPO_PUBLIC_IOS_APP_STORE_URL?.trim();
  const lines = [
    'Try Parse to scan and organize your receipts.',
    appStoreUrl ? `Download Parse: ${appStoreUrl}` : 'Download Parse from the App Store.',
    `Referral code: ${code}`,
    `After signing in, open Menu → Plan and enter this code to receive ${REFERRED_REWARD_SCANS} extra scans.`,
  ];
  await Share.share({ title: 'Invite a friend to Parse', message: lines.join('\n\n') });
}

export const referralRewardCopy = {
  referrer: REFERRER_REWARD_SCANS,
  friend: REFERRED_REWARD_SCANS,
};
