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
import { clearCachedAuth, getCachedAuth, setCachedAuth } from '@/lib/auth/session-cache';
import { isSupabaseConfigured, supabase } from '@/lib/auth/supabase';
import type { Profile } from '@/lib/auth/types';
import { withNetworkRetry } from '@/lib/network/retry';

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

/** Foreground revalidation is skipped if the snapshot is fresher than this. */
const REVALIDATE_AFTER_MS = 5 * 60 * 1000;

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  status: AuthStatus;
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
    const { data, error } = await supabase.auth.getSession();
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

    applySignedIn(currentSession);
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

    return nextState.profileRow;
  }, [applySignedIn, applySignedOut]);

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
        return profileRef.current;
      })
      .finally(() => {
        revalidateRef.current = null;
      });
    revalidateRef.current = run;
    return run;
  }, [refreshProfile]);

  // Startup: restore locally, then revalidate over the network. Routing waits
  // only on the local half, so it cannot be blocked by a dead connection.
  useEffect(() => {
    let alive = true;

    async function restore() {
      if (!isSupabaseConfigured) {
        applyStatus('signed_out');
        return;
      }

      const cached = await getCachedAuth().catch((error: unknown) => {
        if (__DEV__) console.warn('Reading the auth snapshot failed', error);
        return null;
      });
      const stored = await readStoredSession();
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
      } else if (stored.unreachable && snapshot) {
        // Signed in, offline, holding a token that could not be refreshed.
        // Server calls will fail until the network returns — which is precisely
        // what the capture queue exists for — but the user is not signed out.
        applyStatus('authenticated');
      } else {
        await applySignedOut();
        return;
      }

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

  // Recovery for the offline-restored case: the moment the network is back,
  // pick up the session we could not refresh at launch.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    const subscription = Network.addNetworkStateListener((state) => {
      if (!state.isInternetReachable) return;
      if (statusRef.current === 'authenticated' && !sessionRef.current) void revalidate();
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
      authenticated: status === 'authenticated',
      session,
      user,
      profile,
      categories,
      selectedCategoryIds,
      bootstrapLocale,
      refreshProfile,
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
      profile,
      refreshProfile,
      selectedCategoryIds,
      session,
      signInWithApple,
      signInWithGoogle,
      signInWithOtp,
      signOut,
      status,
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
