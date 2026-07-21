import React from 'react';
import { StyleSheet, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { OnboardingOverlay } from '@/components/OnboardingOverlay';
import { colors } from '@/theme/tokens';

export default function ReceiptOnboardingTestScreen() {
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      {/* TODO(B2 auth): Temporary email-path test surface. Restore the OTP flow in index.tsx and remove this route. */}
      <OnboardingOverlay
        onClose={() => router.back()}
        onComplete={() => router.replace('/onboarding' as Href)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
