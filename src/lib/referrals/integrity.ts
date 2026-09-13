import { Platform } from 'react-native';
import * as AppIntegrity from '@expo/app-integrity';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { fetch } from 'expo/fetch';

import type { ReferralAttestationProof, ReferralEntryMethod } from '@/../packages/contracts/src/referrals';
import { getDeviceId } from '@/lib/auth/device';
import { supabase } from '@/lib/auth/supabase';
import { getFoundationEnv } from '@/lib/foundations/env';

const IOS_KEY_PREFIX = 'receiptflow.app-attest-key.v1';
let androidPrepared: Promise<void> | null = null;
let iosEnrollment: { userId: string; promise: Promise<string> } | null = null;

/** Apple's attestation service fails intermittently; one failure was terminal. */
const ENROLLMENT_ATTEMPTS = 3;
const ENROLLMENT_BACKOFF_MS = 400;
/**
 * Device support cannot change between attempts. Every other DCError can, and
 * Expo's guidance for them is to discard the key identifier and start again —
 * which is what a fresh attempt does.
 */
const UNRECOVERABLE_INTEGRITY_CODES = new Set(['ERR_APP_INTEGRITY_FEATURE_UNSUPPORTED']);

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

function integrityErrorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * Records why an Apple call failed, because nothing else can. `attestKeyAsync`
 * and `generateAssertionAsync` run device-to-Apple, so the server never sees the
 * failure, and @expo/app-integrity renders every DCError as the same "undefined
 * reason" string — the `code` is the only thing that identifies it.
 *
 * Strictly fire-and-forget: a diagnostic must never delay, replace or mask the
 * failure that produced it, so every outcome here is swallowed.
 */
function reportIntegrityFailure(input: {
  userId: string;
  deviceId: string;
  /** Absent on Android, and on an iOS failure that precedes key generation. */
  keyId?: string | null;
  stage: 'attest' | 'assert';
  error: unknown;
}) {
  void authenticatedPost({
    action: 'report_failure',
    user_id: input.userId,
    device_id: input.deviceId,
    key_id: input.keyId ?? null,
    stage: input.stage,
    error_code: integrityErrorCode(input.error),
    error_message: input.error instanceof Error ? input.error.message : String(input.error),
    platform: Platform.OS,
    app_version: Constants.expoConfig?.version ?? null,
  }).catch(() => { /* the caller is already handling a failure; never add one */ });
}

async function enrollIosKey(userId: string, deviceId: string): Promise<string> {
  // A fresh key and challenge per attempt is deliberate: challenges are
  // single-use and short-lived, and Apple's own guidance for a rejected key is
  // to discard the identifier rather than attest it again.
  let keyId: string;
  try {
    keyId = await AppIntegrity.generateKeyAsync();
  } catch (error) {
    // No identifier exists yet, so the report carries none.
    reportIntegrityFailure({ userId, deviceId, stage: 'attest', error });
    throw error;
  }

  const challenge = await authenticatedPost({ action: 'challenge', purpose: 'enroll', key_id: keyId, user_id: userId, device_id: deviceId });
  if (typeof challenge.challenge !== 'string') throw new Error('App Attest challenge was missing.');

  let attestation: string;
  try {
    attestation = await AppIntegrity.attestKeyAsync(keyId, challenge.challenge);
  } catch (error) {
    reportIntegrityFailure({ userId, deviceId, keyId, stage: 'attest', error });
    throw error;
  }

  const result = await authenticatedPost({
    action: 'attest',
    key_id: keyId,
    challenge: challenge.challenge,
    attestation,
    user_id: userId,
    device_id: deviceId,
  });
  if (result.accepted !== true) throw new Error('This app installation could not be verified.');
  await SecureStore.setItemAsync(`${IOS_KEY_PREFIX}.${userId}`, keyId);
  return keyId;
}

async function attemptIosEnrollment(userId: string, deviceId: string): Promise<string> {
  for (let attempt = 0; attempt < ENROLLMENT_ATTEMPTS; attempt += 1) {
    try {
      return await enrollIosKey(userId, deviceId);
    } catch (error) {
      const code = integrityErrorCode(error);
      if ((code !== null && UNRECOVERABLE_INTEGRITY_CODES.has(code)) || attempt === ENROLLMENT_ATTEMPTS - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, ENROLLMENT_BACKOFF_MS * 2 ** attempt));
    }
  }
  throw new Error('App Attest enrollment failed.');
}

async function iosKey(userId: string, deviceId: string): Promise<string> {
  if (!AppIntegrity.isSupported) throw new Error('App Attest is unavailable on this device.');
  const stored = await SecureStore.getItemAsync(`${IOS_KEY_PREFIX}.${userId}`);
  if (stored) return stored;

  // Enrollment is reachable from sign-in and from referral redemption, and
  // sign-in itself runs from several places at once. Concurrent callers each
  // used to enrol their own key — one device produced three in thirteen
  // minutes, of which the server keeps only the newest active, leaving the
  // stored identifier pointing at a deactivated key. One in-flight attempt is
  // shared so the stored key and the active server key stay the same one.
  if (iosEnrollment?.userId === userId) return iosEnrollment.promise;

  const promise = attemptIosEnrollment(userId, deviceId).finally(() => {
    if (iosEnrollment?.promise === promise) iosEnrollment = null;
  });
  iosEnrollment = { userId, promise };
  return promise;
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
    const token = await androidIntegrityToken(requestContext, { userId, deviceId, stage: 'attest' });
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

    let token: string;
    try {
      token = await AppIntegrity.generateAssertionAsync(keyId, result.challenge);
    } catch (error) {
      reportIntegrityFailure({ userId, deviceId, keyId, stage: 'assert', error });
      throw error;
    }

    return { platform: 'ios' as const, key_id: keyId, challenge: result.challenge, token };
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

async function androidIntegrityToken(
  requestContext: string,
  report: { userId: string; deviceId: string; stage: 'attest' | 'assert' },
): Promise<string> {
  const projectNumber = playProject();
  if (!projectNumber) throw new Error('Play Integrity is not configured.');

  // Play Integrity fails for the same class of reasons App Attest does — a
  // remote dependency that is unavailable, or a build the service will not
  // recognise — and its errors are just as invisible to the server.
  try {
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
    return await AppIntegrity.requestIntegrityCheckAsync(requestHash);
  } catch (error) {
    reportIntegrityFailure({ ...report, error });
    throw error;
  }
}

async function androidProof(userId: string, code: string, entryMethod: ReferralEntryMethod): Promise<ReferralAttestationProof> {
  const deviceId = await getDeviceId();
  const requestContext = `referral_redeem:${userId}:${deviceId}:${code}:${entryMethod}`;
  return { platform: 'android', token: await androidIntegrityToken(requestContext, { userId, deviceId, stage: 'assert' }) };
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
