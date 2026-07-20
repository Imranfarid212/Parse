import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { AnimatedGridBackground } from '@/components/ui/AnimatedGridBackground';
import { OnboardingOverlay } from '@/components/OnboardingOverlay';
import { CreateAccountCard } from '@/components/CreateAccountCard';
import { colors, spacing, typography } from '@/theme/tokens';

const HEADLINE = 'Never type an expense again';
const SUBTITLE = 'One snap. Perfectly structured data';

export default function LandingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [textBand, setTextBand] = useState<{ top: number; bottom: number } | null>(null);
  const textRef = useRef<View>(null);
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = withDelay(300, withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }));
  }, [enter]);

  // Opacity-only entrance (no transform) so the text bounds we measure stay accurate.
  const heroStyle = useAnimatedStyle(() => ({ opacity: enter.value }));

  const measureText = () => {
    textRef.current?.measureInWindow((_x, y, _w, h) => {
      if (h > 0) setTextBand({ top: y, bottom: y + h });
    });
  };

  return (
    <>
      <AnimatedGridBackground excludeBand={textBand}>
        {!showOnboarding && (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[styles.screen, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + 4 }]}
            testID="landing-screen"
          >
            <Animated.View style={[styles.heroText, heroStyle]}>
              <View ref={textRef} onLayout={measureText}>
                <Text style={styles.headline} testID="landing-headline">
                  {HEADLINE}
                </Text>
                <Text style={styles.subtitle}>{SUBTITLE}</Text>
              </View>
            </Animated.View>

            <CreateAccountCard onProceed={() => setShowOnboarding(true)} />
          </KeyboardAvoidingView>
        )}
      </AnimatedGridBackground>

      {showOnboarding && (
        <OnboardingOverlay
          onClose={() => setShowOnboarding(false)}
          onComplete={() => {
            setShowOnboarding(false);
            router.push('/camera');
          }}
        />
      )}
    </>
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
