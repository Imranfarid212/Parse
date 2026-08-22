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
      <OnboardingOverlay
        onClose={() => {
          void auth.signOut();
          router.replace('/' as Href);
        }}
        onComplete={() => router.replace('/onboarding' as Href)}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
}));
