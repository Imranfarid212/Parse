import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
import { RainbowButton } from '@/components/ui/RainbowButton';
import { colors, spacing, typography } from '@/theme/tokens';

const HEADLINE = 'Never type an expense again';
const SUBTITLE = 'One snap. Perfectly structured data';
const CTA_LABEL = 'Get started';

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
            <View style={styles.ctaWrap}>
              <RainbowButton label={CTA_LABEL} onPress={() => setShowOnboarding(true)} />
            </View>
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
  ctaWrap: {
    marginTop: spacing.md,
  },
});
