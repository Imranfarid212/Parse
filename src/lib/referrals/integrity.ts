import { Platform } from 'react-native';
import * as AppIntegrity from '@expo/app-integrity';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { fetch } from 'expo/fetch';

import type { ReferralAttestationProof, ReferralEntryMethod } from '@/../packages/contracts/src/referrals';
import { getDeviceId } from '@/lib/auth/device';
import { supabase } from '@/lib/auth/supabase';
import { getFoundationEnv } from '@/lib/foundations/env';

const IOS_KEY_PREFIX = 'receiptflow.app-attest-key.v1';
let androidPrepared: Promise<void> | null = null;

const enrollUrl = () => process.env.EXPO_PUBLIC_APP_ATTEST_ENROLL_URL?.trim() || null;
const playProject = () => process.env.EXPO_PUBLIC_PLAY_INTEGRITY_PROJECT_NUMBER?.trim() || null;

async function edgeFunctionErrorMessage(error: unknown, fallback: string) {
  const context = (error as { context?: { clone?: () => unknown; json?: () => Promise<unknown> } } | null)?.context;
  let readable = context;
  if (typeof context?.clone === 'function') {
    try { readable = context.clone() as typeof context; } catch { /* use the original response */ }
  }
  if (typeof readable?.json === 'function') {
    try {
      const payload = await readable.json() as { message?: unknown } | null;
      if (typeof payload?.message === 'string') return payload.message;
    } catch { /* use the safe fallback */ }
  }
  return fallback;
}

function isStaleAppAttestKey(error: unknown) {
  const value = error as { code?: unknown; message?: unknown };
  const code = typeof value?.code === 'string' ? value.code : '';
  const message = typeof value?.message === 'string' ? value.message : '';
  return /APP_INTEGRITY.*(KEY|ASSERTION)/i.test(code) || /key.*(invalid|not found|unknown|expired)/i.test(message);
}

async function authenticatedPost(body: Record<string, unknown>) {
  const url = enrollUrl();
  if (!url) throw new Error('App Attest enrollment is not configured.');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!anonKey) throw new Error('App Attest enrollment is not configured.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in before verifying this device.');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: anonKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw new Error(typeof payload?.message === 'string' ? payload.message : 'Device verification failed.');
  return payload ?? {};
}

async function iosKey(userId: string, deviceId: string): Promise<string> {
  if (!AppIntegrity.isSupported) throw new Error('App Attest is unavailable on this device.');
  const storageKey = `${IOS_KEY_PREFIX}.${userId}`;
  const stored = await SecureStore.getItemAsync(storageKey);
  if (stored) return stored;

  const keyId = await AppIntegrity.generateKeyAsync();
  const challenge = await authenticatedPost({ action: 'challenge', purpose: 'enroll', key_id: keyId, user_id: userId, device_id: deviceId });
  if (typeof challenge.challenge !== 'string') throw new Error('App Attest challenge was missing.');
  const attestation = await AppIntegrity.attestKeyAsync(keyId, challenge.challenge);
  const result = await authenticatedPost({
    action: 'attest',
    key_id: keyId,
    challenge: challenge.challenge,
    attestation,
    user_id: userId,
    device_id: deviceId,
  });
  if (result.accepted !== true) throw new Error('This app installation could not be verified.');
  await SecureStore.setItemAsync(storageKey, keyId);
  return keyId;
}

/**
 * Completes the platform-integrity gate as soon as an authenticated account
 * claims this installation. Referral redemption still generates a separate,
 * action-bound assertion; enrollment alone never authorizes a reward.
 */
export async function ensureSignupIntegrity(userId: string): Promise<void> {
  if (getFoundationEnv().mockBackend) return;

  const deviceId = await getDeviceId();
  if (Platform.OS === 'ios') {
    await iosKey(userId, deviceId);
    return;
  }

  if (Platform.OS === 'android') {
    const requestContext = `signup_integrity:${userId}:${deviceId}`;
    const token = await androidIntegrityToken(requestContext);
    const { data, error } = await supabase.functions.invoke('app-integrity-admit', {
      body: { device_id: deviceId, attestation: { platform: 'android', token } },
    });
    if (error) throw new Error(await edgeFunctionErrorMessage(error, 'This app installation could not be verified.'));
    if (data?.accepted !== true) throw new Error('This app installation could not be verified.');
    return;
  }

  throw new Error('App integrity requires the iOS or Android app.');
}

async function iosProof(userId: string, code: string, entryMethod: ReferralEntryMethod): Promise<ReferralAttestationProof> {
  const deviceId = await getDeviceId();
  const create = async () => {
    const keyId = await iosKey(userId, deviceId);
    const result = await authenticatedPost({
      action: 'challenge',
      purpose: 'referral_redeem',
      key_id: keyId,
      user_id: userId,
      device_id: deviceId,
      code,
      entry_method: entryMethod,
    });
    if (typeof result.challenge !== 'string') throw new Error('App Attest challenge was missing.');
    return {
      platform: 'ios' as const,
      key_id: keyId,
      challenge: result.challenge,
      token: await AppIntegrity.generateAssertionAsync(keyId, result.challenge),
    };
  };
  try {
    return await create();
  } catch (error) {
    // App Attest keys do not survive reinstall/restore. A stale SecureStore id
    // is discarded once and enrolled again; repeated failure remains closed.
    if (!isStaleAppAttestKey(error)) throw error;
    await SecureStore.deleteItemAsync(`${IOS_KEY_PREFIX}.${userId}`);
    return create();
  }
}

async function androidIntegrityToken(requestContext: string): Promise<string> {
  const projectNumber = playProject();
  if (!projectNumber) throw new Error('Play Integrity is not configured.');
  androidPrepared ??= AppIntegrity.prepareIntegrityTokenProviderAsync(projectNumber).catch((error) => {
    androidPrepared = null;
    throw error;
  });
  await androidPrepared;
  // Play requires a base64url SHA-256 requestHash. The verifier rebuilds this
  // exact action binding from its trusted context before accepting the token.
  const requestHash = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, requestContext, {
    encoding: Crypto.CryptoEncoding.BASE64,
  })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return AppIntegrity.requestIntegrityCheckAsync(requestHash);
}

async function androidProof(userId: string, code: string, entryMethod: ReferralEntryMethod): Promise<ReferralAttestationProof> {
  const deviceId = await getDeviceId();
  const requestContext = `referral_redeem:${userId}:${deviceId}:${code}:${entryMethod}`;
  return { platform: 'android', token: await androidIntegrityToken(requestContext) };
}

export async function createReferralAttestation(
  userId: string,
  code: string,
  entryMethod: ReferralEntryMethod,
): Promise<ReferralAttestationProof> {
  if (getFoundationEnv().mockBackend) {
    return { platform: process.env.EXPO_OS === 'android' ? 'android' : 'ios', token: 'mock-attestation-token-for-local-preview' };
  }
  if (Platform.OS === 'ios') return iosProof(userId, code, entryMethod);
  if (Platform.OS === 'android') return androidProof(userId, code, entryMethod);
  throw new Error('Referrals require the iOS or Android app.');
}
