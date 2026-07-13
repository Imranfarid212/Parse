import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { AnimatedGridBackground } from '@/components/ui/AnimatedGridBackground';
import { OnboardingOverlay } from '@/components/OnboardingOverlay';
import { colors, radius, spacing, typography } from '@/theme/tokens';

// Placeholder copy — final wording lands later per PM.
const HEADLINE = 'Background lights are cool you know.';
const SUBTITLE = 'And this, is chemical burn.';
const CTA_LABEL = 'Debug now';

export default function LandingScreen() {
  const router = useRouter();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const enter = useSharedValue(0);

  useEffect(() => {
    // Entrance fade + rise (replaces the web framer-motion animation).
    enter.value = withDelay(300, withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }));
  }, [enter]);

  const heroStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 40 }],
  }));

  return (
    <>
      <AnimatedGridBackground>
        {!showOnboarding && (
          <Animated.View style={[styles.hero, heroStyle]}>
            <Text style={styles.headline}>{HEADLINE}</Text>
            <Text style={styles.subtitle}>{SUBTITLE}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowOnboarding(true)}
              style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
            >
              <Text style={styles.ctaLabel}>{CTA_LABEL}</Text>
            </Pressable>
          </Animated.View>
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
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  headline: {
    ...typography.display,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.subtitle,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  cta: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.ctaBackground,
    borderRadius: radius.pill,
  },
  ctaPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  ctaLabel: {
    ...typography.button,
    color: colors.ctaText,
  },
});
