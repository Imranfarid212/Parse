import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { AnimatedGridBackground } from '@/components/ui/AnimatedGridBackground';
import { CreateAccountCard } from '@/components/CreateAccountCard';
import { useAuth } from '@/lib/auth/auth-context';
import { colors, spacing, typography } from '@/theme/tokens';

const HEADLINE_MAIN = 'Scan one receipt.';
const HEADLINE_SUB = 'See the magic';

export default function LandingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [textBand, setTextBand] = useState<{ top: number; bottom: number } | null>(null);
  const textRef = useRef<View>(null);
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = withDelay(300, withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }));
  }, [enter]);

  useFocusEffect(
    useCallback(() => {
      if (auth.loading || auth.deviceStatus !== 'active' || !auth.authenticated || !auth.profile) return;
      router.replace((auth.profile.onboarding_complete ? '/camera' : '/welcome') as Href);
    }, [auth.authenticated, auth.deviceStatus, auth.loading, auth.profile, router]),
  );

  // Opacity-only entrance (no transform) so the text bounds we measure stay accurate.
  const heroStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  const measureText = () => {
    textRef.current?.measureInWindow((_x, y, _w, h) => {
      if (h > 0) setTextBand({ top: y, bottom: y + h });
    });
  };

  const runAuthAction = async (action: () => Promise<void>) => {
    if (!auth.configured) {
      Alert.alert('Supabase env needed', 'Start Expo with EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
      return;
    }

    try {
      setBusy(true);
      await action();
    } catch (error) {
      Alert.alert('Sign in failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (auth.loading || auth.deviceStatus === 'checking') {
    return (
      <View style={styles.loadingGate}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (auth.deviceStatus === 'takeover_required') {
    return (
      <View style={styles.loadingGate}>
        <Text style={styles.takeoverTitle}>Use Parse on this device?</Text>
        <Text style={styles.takeoverBody}>This signs out the other device. Your receipts will then sync here.</Text>
        <Pressable
          style={({ pressed }) => [styles.takeoverPrimary, (pressed || busy) && styles.takeoverPressed]}
          disabled={busy}
          onPress={() => void runAuthAction(auth.takeOverDevice)}
        >
          <Text style={styles.takeoverPrimaryText}>{busy ? 'Switching device' : 'Use this device'}</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.takeoverSecondary, pressed && styles.takeoverPressed]} onPress={() => void auth.signOut()}>
          <Text style={styles.takeoverSecondaryText}>Keep the other device</Text>
        </Pressable>
      </View>
    );
  }

  if (auth.deviceStatus === 'unavailable') {
    return (
      <View style={styles.loadingGate}>
        <Text style={styles.takeoverTitle}>Could not verify this device</Text>
        <Text style={styles.takeoverBody}>Check your connection and try again.</Text>
        <Pressable style={({ pressed }) => [styles.takeoverPrimary, (pressed || busy) && styles.takeoverPressed]} disabled={busy} onPress={() => void runAuthAction(async () => { await auth.refreshProfile(); })}>
          <Text style={styles.takeoverPrimaryText}>{busy ? 'Checking device' : 'Try again'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <AnimatedGridBackground excludeBand={textBand}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.screen, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + 4 }]}
        testID="auth-screen"
      >
        <Animated.View style={[styles.heroText, heroStyle]}>
          <View ref={textRef} onLayout={measureText}>
            <Text style={styles.headline} testID="landing-headline">
              {HEADLINE_MAIN}
              {'\n'}
              <Text style={styles.headlineSub}>{HEADLINE_SUB}</Text>
            </Text>
          </View>
        </Animated.View>

        <CreateAccountCard
          busy={busy || auth.loading}
          onEmail={() => router.push('/otp' as Href)}
          onGoogle={() => void runAuthAction(auth.signInWithGoogle)}
          onApple={() => void runAuthAction(auth.signInWithApple)}
        />
      </KeyboardAvoidingView>
    </AnimatedGridBackground>
  );
}

const styles = StyleSheet.create({
  loadingGate: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  takeoverTitle: { fontFamily: typography.display.fontFamily, fontSize: 28, color: '#000000', textAlign: 'center', paddingHorizontal: spacing.lg },
  takeoverBody: { fontFamily: typography.subtitle.fontFamily, fontSize: 16, color: '#555555', textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.lg, paddingHorizontal: spacing.xl },
  takeoverPrimary: { marginTop: spacing.md, minWidth: 240, minHeight: 48, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111111', borderRadius: 6 },
  takeoverPrimaryText: { fontFamily: typography.button.fontFamily, fontSize: 16, color: '#FFFFFF' },
  takeoverSecondary: { marginTop: spacing.sm, minWidth: 240, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  takeoverSecondaryText: { fontFamily: typography.button.fontFamily, fontSize: 15, color: '#555555' },
  takeoverPressed: { opacity: 0.7 },
  screen: { width: '100%', height: '100%', paddingHorizontal: 4 },
  heroText: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  headline: {
    fontFamily: typography.display.fontFamily, // InstrumentSans_700Bold — heaviest sans weight loaded
    fontSize: typography.display.fontSize - 5,
    letterSpacing: -0.5,
    color: '#000000',
    textAlign: 'center',
  },
  headlineSub: {
    fontFamily: 'InstrumentSans_600SemiBold_Italic',
    fontSize: typography.display.fontSize - 13,
    letterSpacing: -0.5,
    color: '#555555',
  },
});
