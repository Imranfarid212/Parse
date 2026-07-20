import React, { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
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

const HEADLINE = 'Never type an expense again';
const SUBTITLE = 'One snap. Perfectly structured data';

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

  useEffect(() => {
    if (auth.loading || !auth.session || !auth.profile) return;
    router.replace((auth.profile.onboarding_complete ? '/camera' : '/onboarding') as Href);
  }, [auth.loading, auth.profile, auth.session, router]);

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
              {HEADLINE}
            </Text>
            <Text style={styles.subtitle}>{SUBTITLE}</Text>
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
  screen: { width: '100%', height: '100%', paddingHorizontal: 4 },
  heroText: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  headline: {
    ...typography.display,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.subtitle,
    color: '#41454D',
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
