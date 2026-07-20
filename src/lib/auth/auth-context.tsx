import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { Session, User } from '@supabase/supabase-js';

import { TOAST_REFERRAL_PROMPT } from '@/../packages/contracts/src/copy';
import type { Category } from '@/../packages/contracts/src/types';
import { getBootstrapLocale, type BootstrapLocale } from '@/lib/auth/bootstrap';
import { isSupabaseConfigured, supabase } from '@/lib/auth/supabase';

WebBrowser.maybeCompleteAuthSession();

export type Profile = {
  id: string;
  country: string | null;
  default_currency: string;
  onboarding_complete: boolean;
};

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  categories: Category[];
  selectedCategoryIds: number[];
  bootstrapLocale: BootstrapLocale;
  refreshProfile: () => Promise<void>;
  signInWithOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
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
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const bootstrapLocale = useMemo(() => getBootstrapLocale(), []);

  const refreshProfile = useCallback(async () => {
    const currentSession = (await supabase.auth.getSession()).data.session;
    setSession(currentSession);

    const { data: categoryRows, error: categoryError } = await supabase
      .from('categories')
      .select('id,name,is_default,is_system')
      .order('id');
    if (categoryError) throw categoryError;
    setCategories(categoryRows ?? []);

    if (!currentSession?.user) {
      setProfile(null);
      setSelectedCategoryIds([]);
      return;
    }

    const { data: profileRow, error: profileError } = await supabase
      .from('profiles')
      .select('id,country,default_currency,onboarding_complete')
      .eq('id', currentSession.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    setProfile(profileRow ?? null);

    const { data: pickedRows, error: pickedError } = await supabase
      .from('user_categories')
      .select('category_id')
      .eq('user_id', currentSession.user.id)
      .order('sort_order');
    if (pickedError) throw pickedError;
    setSelectedCategoryIds((pickedRows ?? []).map((row) => row.category_id));
  }, []);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!isSupabaseConfigured) {
        if (alive) setLoading(false);
        return;
      }

      try {
        await refreshProfile();
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      void refreshProfile();
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [refreshProfile]);

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
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          data: {
            country: bootstrapLocale.country,
            default_currency: bootstrapLocale.defaultCurrency,
          },
        },
      });
      if (error) throw error;
    },
    [bootstrapLocale],
  );

  const verifyOtp = useCallback(
    async (email: string, token: string) => {
      const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
      await refreshProfile();
    },
    [refreshProfile],
  );

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = getRedirectUrl();
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
  }, [refreshProfile]);

  const signInWithApple = useCallback(async () => {
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
  }, [refreshProfile]);

  const completeOnboarding = useCallback(
    async (categoryIds: number[], country: string, defaultCurrency: string) => {
      const { error } = await supabase.rpc('complete_onboarding', {
        selected_category_ids: categoryIds,
        selected_country: country,
        selected_default_currency: defaultCurrency,
      });
      if (error) throw error;
      await refreshProfile();
    },
    [refreshProfile],
  );

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setProfile(null);
    setSelectedCategoryIds([]);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: isSupabaseConfigured,
      loading,
      session,
      user: session?.user ?? null,
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
      categories,
      completeOnboarding,
      loading,
      profile,
      refreshProfile,
      selectedCategoryIds,
      session,
      signInWithApple,
      signInWithGoogle,
      signInWithOtp,
      signOut,
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
