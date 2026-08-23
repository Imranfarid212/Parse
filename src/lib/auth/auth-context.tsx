import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as Network from 'expo-network';
import * as WebBrowser from 'expo-web-browser';
import type { Session, User } from '@supabase/supabase-js';

import { TOAST_REFERRAL_PROMPT } from '@/../packages/contracts/src/copy';
import type { Category } from '@/../packages/contracts/src/types';
import { getBootstrapLocale, type BootstrapLocale } from '@/lib/auth/bootstrap';
import { getDeviceId } from '@/lib/auth/device';
import { clearCachedAuth, getCachedAuth, setCachedAuth } from '@/lib/auth/session-cache';
import { isSupabaseConfigured, supabase } from '@/lib/auth/supabase';
import type { Profile } from '@/lib/auth/types';
import { withNetworkRetry } from '@/lib/network/retry';
import { syncFromServer } from '@/lib/receipts/server-sync';
import { clearReferralCache } from '@/lib/referrals/client';
import { ensureSignupIntegrity } from '@/lib/referrals/integrity';

WebBrowser.maybeCompleteAuthSession();

export type { Profile };

/**
 * Three states, never two. The sign-in screen is reachable only from
 * `signed_out`, and the only things that produce `signed_out` are an empty
 * token store and an explicit sign-out — never a failed request. Conflating
 * "we could not reach the server" with "this user has no account" is what sent
 * offline cold starts back to the login screen.
 */
export type AuthStatus = 'restoring' | 'authenticated' | 'signed_out';
export type DeviceStatus = 'checking' | 'active' | 'takeover_required' | 'unavailable';

/** Foreground revalidation is skipped if the snapshot is fresher than this. */
const REVALIDATE_AFTER_MS = 5 * 60 * 1000;
/** An active foreground installation notices a remote takeover promptly. */
const DEVICE_OWNERSHIP_HEARTBEAT_MS = 5_000;
const SESSION_RESTORE_TIMEOUT_MS = 8_000;
const BOOTSTRAP_DEADLINE_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), SESSION_RESTORE_TIMEOUT_MS)),
  ]);
}

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  status: AuthStatus;
  deviceStatus: DeviceStatus;
  /**
   * True whenever a user is signed in — including offline, where `session` is
   * null because the access token could not be refreshed. Route on this, not on
   * `session`; `session` is only non-null when a live token actually exists.
   */
  authenticated: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  categories: Category[];
  selectedCategoryIds: number[];
  bootstrapLocale: BootstrapLocale;
  refreshProfile: () => Promise<Profile | null>;
  takeOverDevice: () => Promise<void>;
  signInWithOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<Profile | null>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  completeOnboarding: (categoryIds: number[], country: string, defaultCurrency: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function getRedirectUrl() {
  return Linking.createURL('auth/callback', { scheme: 'parse' });
}

function getCallbackParam(url: string, param: string) {
  try {
    const parsed = new URL(url);
    const searchValue = parsed.searchParams.get(param);
    if (searchValue) return searchValue;

    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    return hashParams.get(param);
  } catch {
    return null;
  }
}

/**
 * Reads the session Supabase holds in storage, keeping "there is no session"
 * separate from "we could not reach the network to refresh one".
 *
 * Offline with an access token past its lifetime, auth-js returns
 * `session: null` alongside a retryable fetch error and deliberately leaves the
 * tokens on disk (it only removes them when the server actually rejects the
 * refresh token). `unreachable` carries that distinction to the caller so a
 * dropped connection can never be mistaken for a sign-out.
 */
async function readStoredSession(): Promise<{ session: Session | null; unreachable: boolean }> {
  try {
    const result = await withTimeout(supabase.auth.getSession(), 'Session restore');
    const { data, error } = result;
    if (data.session) return { session: data.session, unreachable: false };
    return { session: null, unreachable: Boolean(error) };
  } catch {
    return { session: null, unreachable: true };
  }
}

async function exchangeOAuthResult(url: string) {
  const code = getCallbackParam(url, 'code');
  const accessToken = getCallbackParam(url, 'access_token');
  const refreshToken = getCallbackParam(url, 'refresh_token');

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) throw error;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  /** Interactive sign-in/out only — never set by background revalidation. */
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('checking');
  const bootstrapLocale = useMemo(() => getBootstrapLocale(), []);

  const profileRef = useRef<Profile | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const statusRef = useRef<AuthStatus>('restoring');
  const lastRefreshedAtRef = useRef(0);

  const applyStatus = useCallback((next: AuthStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const applySignedIn = useCallback(
    (nextSession: Session) => {
      sessionRef.current = nextSession;
      setSession(nextSession);
      setUser(nextSession.user);
      applyStatus('authenticated');
    },
    [applyStatus],
  );

  /** The only path that discards auth state. Reached by proof, never by failure. */
  const applySignedOut = useCallback(async () => {
    sessionRef.current = null;
    profileRef.current = null;
    lastRefreshedAtRef.current = 0;
    setSession(null);
    setUser(null);
    setProfile(null);
    setSelectedCategoryIds([]);
    setDeviceStatus('checking');
    // Referral codes are per-account, so the cached summary has to go with the
    // session. This is the single place local auth state is dropped, so it
    // covers an expired session as well as an explicit sign-out.
    clearReferralCache();
    applyStatus('signed_out');
    try {
      await clearCachedAuth();
    } catch (error) {
      if (__DEV__) console.warn('Clearing the auth snapshot failed', error);
    }
  }, [applyStatus]);

  const refreshProfile = useCallback(async () => {
    const stored = await readStoredSession();

    if (!stored.session) {
      // Supabase answered, and it has nothing: a genuine sign-out.
      if (!stored.unreachable) {
        await applySignedOut();
        return null;
      }
      // Unreachable. Leave every piece of restored state exactly as it is.
      throw new Error('Network request failed: cannot refresh the profile while offline.');
    }

    const currentSession = stored.session;

    const nextState = await withNetworkRetry(
      async () => {
        const { data: categoryRows, error: categoryError } = await supabase
          .from('categories')
          .select('id,name,is_default,is_system')
          .order('id');
        if (categoryError) throw categoryError;

        const { data: profileRow, error: profileError } = await supabase
          .from('profiles')
          .select('id,country,default_currency,onboarding_complete')
          .eq('id', currentSession.user.id)
          .maybeSingle();
        if (profileError) throw profileError;

        const { data: pickedRows, error: pickedError } = await supabase
          .from('user_categories')
          .select('category_id')
          .eq('user_id', currentSession.user.id)
          .order('sort_order');
        if (pickedError) throw pickedError;

        return {
          categoryRows: categoryRows ?? [],
          profileRow: profileRow ?? null,
          pickedRows: pickedRows ?? [],
        };
      },
      { attempts: 3, label: 'auth.refreshProfile' },
    );

    const nextSelectedCategoryIds = nextState.pickedRows.map((row) => row.category_id);

    const deviceId = await getDeviceId();
    const { data: claimRows, error: claimError } = await supabase.rpc('claim_user_device', {
      p_device_id: deviceId,
      p_takeover: false,
    });
    if (claimError) throw claimError;
    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (claim?.out_status === 'takeover_required') {
      setDeviceStatus('takeover_required');
      return nextState.profileRow;
    }
    if (claim?.out_status !== 'active') throw new Error('Could not verify this device.');

    // B9 admits a signed-in installation only after platform attestation. The
    // device claim must happen first because enrollment is bound server-side to
    // the one active installation. Referral release later requires its own
    // fresh assertion, so this cannot be replayed to obtain scans.
    await ensureSignupIntegrity(currentSession.user.id);

    applySignedIn(currentSession);
    setDeviceStatus('active');
    setCategories(nextState.categoryRows);
    setProfile(nextState.profileRow);
    profileRef.current = nextState.profileRow;
    setSelectedCategoryIds(nextSelectedCategoryIds);
    lastRefreshedAtRef.current = Date.now();

    // The snapshot is what the next cold start reads. A failed write costs the
    // next offline launch, so it must never cost this sign-in.
    try {
      await setCachedAuth({
        userId: currentSession.user.id,
        user: currentSession.user,
        profile: nextState.profileRow,
        categories: nextState.categoryRows,
        selectedCategoryIds: nextSelectedCategoryIds,
      });
    } catch (error) {
      if (__DEV__) console.warn('Writing the auth snapshot failed', error);
    }

    // Bring the device's receipts back in step with the server. It needs the
    // category names this call just fetched, and must not run before the
    // session exists — hence here rather than at startup. Failure is swallowed:
    // the local copy stays usable and the cursor is unchanged, so the next pass
    // picks up exactly where this one stopped.
    void syncFromServer(currentSession.user.id, nextState.categoryRows)
      .then((counts) => {
        const changed = counts.added + counts.updated + counts.deleted;
        if (changed > 0 && __DEV__) console.log('[sync] receipts', counts);
      })
      .catch((error: unknown) => {
        if (__DEV__) console.warn('[sync] failed; the cursor is unchanged', error);
      });

    return nextState.profileRow;
  }, [applySignedIn, applySignedOut]);

  const takeOverDevice = useCallback(async () => {
    const deviceId = await getDeviceId();
    const { data, error } = await supabase.rpc('claim_user_device', { p_device_id: deviceId, p_takeover: true });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.out_status !== 'active') throw new Error('Could not activate this device.');
    setDeviceStatus('active');
    await refreshProfile();
  }, [refreshProfile]);

  /**
   * Writes are rejected by the Edge Functions immediately after a takeover.
   * This lightweight foreground check gives the displaced installation the same
   * answer without waiting for its next launch or the five-minute profile pull.
   */
  const checkDeviceOwnership = useCallback(async () => {
    if (statusRef.current !== 'authenticated' || !sessionRef.current) return;

    const deviceId = await getDeviceId();
    const { data, error } = await supabase.rpc('claim_user_device', {
      p_device_id: deviceId,
      p_takeover: false,
    });
    if (error) throw error;

    const claim = Array.isArray(data) ? data[0] : data;
    if (claim?.out_status === 'takeover_required') {
      // This installation had already been active. The new one completed an
      // explicit takeover, so clear only this device's local auth state.
      await applySignedOut();
      return;
    }
    if (claim?.out_status !== 'active') throw new Error('Could not verify this device.');
  }, [applySignedOut]);

  /**
   * Background revalidation: stale-while-revalidate over the cached snapshot.
   * Deduped, and a failure is never surfaced — the cached copy is already on
   * screen and stays there.
   */
  const revalidateRef = useRef<Promise<Profile | null> | null>(null);
  const revalidate = useCallback(() => {
    if (revalidateRef.current) return revalidateRef.current;
    const run = refreshProfile()
      .catch((error: unknown) => {
        if (__DEV__) console.warn('Background profile refresh failed', error);
        // A connectivity or device-claim failure must not leave the app behind
        // an indefinite spinner. No write reaches the server without a later
        // active-device assertion, so this is an honest retry state.
        setDeviceStatus('unavailable');
        return profileRef.current;
      })
      .finally(() => {
        revalidateRef.current = null;
      });
    revalidateRef.current = run;
    return run;
  }, [refreshProfile]);

  // Native storage and an interrupted device RPC have both been observed to
  // remain pending indefinitely. Startup must always leave the loading gate.
  useEffect(() => {
    const deadline = setTimeout(() => {
      if (statusRef.current === 'restoring') void applySignedOut();
      else if (statusRef.current === 'authenticated' && deviceStatus === 'checking') setDeviceStatus('unavailable');
    }, BOOTSTRAP_DEADLINE_MS);
    return () => clearTimeout(deadline);
  }, [applySignedOut, deviceStatus]);

  // Startup: restore locally, then revalidate over the network. Routing waits
  // only on the local half, so it cannot be blocked by a dead connection.
  useEffect(() => {
    let alive = true;

    async function restore() {
      if (__DEV__) console.log('[auth] restore:start');
      if (!isSupabaseConfigured) {
        applyStatus('signed_out');
        return;
      }

      const cached = await withTimeout(getCachedAuth(), 'Cached auth restore').catch((error: unknown) => {
        if (__DEV__) console.warn('Reading the auth snapshot failed', error);
        return null;
      });
      if (__DEV__) console.log('[auth] restore:cache', Boolean(cached));
      const stored = await readStoredSession();
      if (__DEV__) console.log('[auth] restore:session', Boolean(stored.session), stored.unreachable);
      if (!alive) return;

      // A snapshot belonging to a different account is worse than none.
      const snapshot = cached && (!stored.session || stored.session.user.id === cached.userId) ? cached : null;

      if (snapshot) {
        setUser(snapshot.user);
        setProfile(snapshot.profile);
        profileRef.current = snapshot.profile;
        setCategories(snapshot.categories);
        setSelectedCategoryIds(snapshot.selectedCategoryIds);
        lastRefreshedAtRef.current = snapshot.fetchedAt;
      }

      if (stored.session) {
        applySignedIn(stored.session);
        setDeviceStatus('checking');
      } else if (stored.unreachable && snapshot) {
        // Signed in, offline, holding a token that could not be refreshed.
        // Server calls will fail until the network returns — which is precisely
        // what the capture queue exists for — but the user is not signed out.
        applyStatus('authenticated');
      } else {
        if (__DEV__) console.log('[auth] restore:signed-out');
        await applySignedOut();
        return;
      }

      if (__DEV__) console.log('[auth] restore:revalidate');
      void revalidate();
    }

    void restore();

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!alive) return;

      if (event === 'SIGNED_OUT') {
        void applySignedOut();
        return;
      }

      // A null session on any other event means a refresh did not land. That is
      // not a verdict, so nothing is cleared here; startup already decided.
      if (!nextSession) return;

      applySignedIn(nextSession);
      setDeviceStatus('checking');
      void revalidate();
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [applySignedIn, applySignedOut, applyStatus, revalidate]);

  // React Native gives auth-js no page lifecycle to hang the refresh ticker on,
  // so it has to be driven from AppState. Without this the access token is only
  // ever refreshed lazily at the moment of use — which is how a token gets old
  // enough to be unrefreshable by the time the app is opened offline.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    const resume = () => {
      void supabase.auth.startAutoRefresh();
      const stale = Date.now() - lastRefreshedAtRef.current > REVALIDATE_AFTER_MS;
      if (statusRef.current === 'authenticated' && (!sessionRef.current || stale)) void revalidate();
    };

    if (AppState.currentState === 'active') resume();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') resume();
      else void supabase.auth.stopAutoRefresh();
    });

    return () => {
      subscription.remove();
      void supabase.auth.stopAutoRefresh();
    };
  }, [revalidate]);

  // Keep a foreground session honest after another installation takes over.
  // Network trouble is intentionally silent here: it must never look like a
  // remote sign-out, and the server will still reject writes until it recovers.
  useEffect(() => {
    if (!isSupabaseConfigured || deviceStatus !== 'active') return undefined;

    let timer: ReturnType<typeof setInterval> | null = null;
    const check = () => {
      void checkDeviceOwnership().catch((error: unknown) => {
        if (__DEV__) console.warn('Foreground device ownership check failed', error);
      });
    };
    const start = () => {
      if (timer) return;
      check();
      timer = setInterval(check, DEVICE_OWNERSHIP_HEARTBEAT_MS);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    if (AppState.currentState === 'active') start();
    const subscription = AppState.addEventListener('change', (state) => (state === 'active' ? start() : stop()));
    return () => {
      subscription.remove();
      stop();
    };
  }, [checkDeviceOwnership, deviceStatus]);

  // Recovery for the offline-restored case: the moment the network is back,
  // pick up the session we could not refresh at launch.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    const subscription = Network.addNetworkStateListener((state) => {
      if (!state.isInternetReachable) return;
      if (statusRef.current !== 'authenticated') return;
      // Two reasons to revalidate on reconnect: pick up a session that could not
      // be refreshed at launch, and pull whatever changed on the server while
      // the device was away — the local copy is what every offline decision
      // reads, so a reconnect is exactly when it should stop being stale.
      const stale = Date.now() - lastRefreshedAtRef.current > REVALIDATE_AFTER_MS;
      if (!sessionRef.current || stale) void revalidate();
    });

    return () => subscription.remove();
  }, [revalidate]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    const handleUrl = ({ url }: { url: string }) => {
      if (!url.includes('auth/callback')) return;

      void exchangeOAuthResult(url)
        .then(refreshProfile)
        .catch((error: unknown) => {
          console.warn('OAuth callback failed', error);
        });
    };

    const subscription = Linking.addEventListener('url', handleUrl);

    void Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url });
    });

    return () => {
      subscription.remove();
    };
  }, [refreshProfile]);

  const signInWithOtp = useCallback(
    async (email: string) => {
      await withNetworkRetry(
        async () => {
          const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
              shouldCreateUser: true,
              data: {
                country: bootstrapLocale.country,
                default_currency: bootstrapLocale.defaultCurrency,
              },
            },
          });
          if (error) throw error;
        },
        { attempts: 2, label: 'auth.signInWithOtp' },
      );
    },
    [bootstrapLocale],
  );

  const verifyOtp = useCallback(
    async (email: string, token: string) => {
      await withNetworkRetry(
        async () => {
          const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
          if (error) throw error;
        },
        { attempts: 2, label: 'auth.verifyOtp' },
      );
      return refreshProfile();
    },
    [refreshProfile],
  );

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = getRedirectUrl();
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error('Google sign-in did not return an OAuth URL.');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success') {
        await exchangeOAuthResult(result.url);
        await refreshProfile();
      } else if (result.type !== 'cancel') {
        throw new Error('Google sign-in did not complete.');
      }
    } finally {
      setBusy(false);
    }
  }, [refreshProfile]);

  const signInWithApple = useCallback(async () => {
    setBusy(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) throw new Error('Apple did not return an identity token.');

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (error) throw error;

      // Apple requires an app offering Sign in with Apple to revoke the user's
      // tokens when they delete their account, and revocation needs a refresh
      // token. The only way to get one is to exchange this authorization code —
      // it is single-use and expires in minutes, so it happens now or never.
      //
      // Deliberately not awaited into the sign-in's failure path: the user is
      // already signed in, and failing that because a follow-up call to our own
      // backend hiccuped would be a poor trade. The cost of a miss is that
      // deletion later reports apple_revoked: false.
      if (credential.authorizationCode) {
        void supabase.functions
          .invoke('apple-link', { body: { authorization_code: credential.authorizationCode } })
          .catch((cause) => {
            if (__DEV__) console.warn('[auth] apple-link failed', cause);
          });
      }

      await refreshProfile();
    } finally {
      setBusy(false);
    }
  }, [refreshProfile]);

  const completeOnboarding = useCallback(
    async (categoryIds: number[], country: string, defaultCurrency: string) => {
      await withNetworkRetry(
        async () => {
          const { error } = await supabase.rpc('complete_onboarding', {
            selected_category_ids: categoryIds,
            selected_country: country,
            selected_default_currency: defaultCurrency,
          });
          if (error) throw error;
        },
        { attempts: 3, label: 'auth.completeOnboarding' },
      );
      await refreshProfile();
    },
    [refreshProfile],
  );

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut();
      // The local session is dropped either way. Sign-out is the user's
      // decision, not the server's, and leaving them half-signed-in because a
      // request failed is the same mistake as signing them out because one did.
      if (error && __DEV__) console.warn('Server sign-out failed; clearing locally anyway', error);
      await applySignedOut();
    } finally {
      setBusy(false);
    }
  }, [applySignedOut]);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: isSupabaseConfigured,
      loading: status === 'restoring' || busy,
      status,
      deviceStatus,
      authenticated: status === 'authenticated',
      session,
      user,
      profile,
      categories,
      selectedCategoryIds,
      bootstrapLocale,
      refreshProfile,
      takeOverDevice,
      signInWithOtp,
      verifyOtp,
      signInWithGoogle,
      signInWithApple,
      completeOnboarding,
      signOut,
    }),
    [
      bootstrapLocale,
      busy,
      categories,
      completeOnboarding,
      deviceStatus,
      profile,
      refreshProfile,
      selectedCategoryIds,
      session,
      signInWithApple,
      signInWithGoogle,
      signInWithOtp,
      signOut,
      status,
      takeOverDevice,
      user,
      verifyOtp,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = React.use(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export { TOAST_REFERRAL_PROMPT };
