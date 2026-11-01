import React, { useEffect } from 'react';
import { View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { OnboardingOverlay } from '@/components/OnboardingOverlay';
import { useAuth } from '@/lib/auth/auth-context';
import { makeStyles, useAppAppearance } from '@/theme/appearance';

export default function WelcomeScreen() {
  const styles = useStyles();
  const { isDark } = useAppAppearance();
  const router = useRouter();
  const auth = useAuth();

  useEffect(() => {
    if (!auth.loading && !auth.authenticated) router.replace('/');
  }, [auth.authenticated, auth.loading, router]);

  return (
    <View style={styles.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {/*
        Dismissing the tour is not signing out. This used to call signOut() and
        send the user back to `/`, so the X on a just-created account read as
        the app rejecting it. Both controls now land in the same place "Let's
        go" does: the X skips the three cards, not the setup behind them —
        camera.tsx sends anyone without `onboarding_complete` straight back, so
        there is nowhere further to skip to.
      */}
      <OnboardingOverlay
        onClose={() => router.replace('/onboarding' as Href)}
        onComplete={() => router.replace('/onboarding' as Href)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
}));
