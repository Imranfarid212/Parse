import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { OnboardingOverlay } from '@/components/OnboardingOverlay';
import { useAuth } from '@/lib/auth/auth-context';
import { colors } from '@/theme/tokens';

export default function WelcomeScreen() {
  const router = useRouter();
  const auth = useAuth();

  useEffect(() => {
    if (!auth.loading && !auth.session) router.replace('/');
  }, [auth.loading, auth.session, router]);

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
