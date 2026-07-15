/**
 * OnboardingOverlay — blurred backdrop + a stack of three receipt cards.
 * Swipe the top card RIGHT to advance to the next; it tosses off toward the
 * bottom-left and the next receipt is revealed. "Let's go" appears only on the
 * third (last) receipt. The fancier tear/crush exit is a later polish — this is
 * the plain toss motion + the gating behaviour.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';

import { ReceiptCard } from '@/components/ui/ReceiptCard';
import { colors, radius, spacing, typography } from '@/theme/tokens';

const NUM = 3;
const SWIPE_THRESHOLD = 70;

// Static offset for a card sitting `depth` layers behind the top card.
const behindStyle = (depth: number) => ({
  transform: [{ translateX: 8 * depth }, { translateY: -13 * depth }, { rotate: `${2.5 * depth}deg` }],
});

function SwipeCard({
  width,
  height,
  onSwiped,
}: {
  width: number;
  height: number;
  onSwiped: () => void;
}) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const gone = useSharedValue(0);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = e.translationX;
      ty.value = e.translationY * 0.25;
    })
    .onEnd((e) => {
      // Advance on a horizontal swipe in EITHER direction; always toss off
      // toward the bottom-left, then reveal the next receipt.
      if (Math.abs(e.translationX) > SWIPE_THRESHOLD || Math.abs(e.velocityX) > 700) {
        tx.value = withTiming(-width * 1.4, { duration: 340 });
        ty.value = withTiming(height * 0.55, { duration: 340 });
        gone.value = withTiming(1, { duration: 340 }, (finished) => {
          if (finished) runOnJS(onSwiped)();
        });
      } else {
        tx.value = withSpring(0);
        ty.value = withSpring(0);
      }
    });

  const style = useAnimatedStyle(() => ({
    opacity: 1 - gone.value,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-width, 0, width], [-22, 0, 14])}deg` },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.cardWrap, { width, height }, style]}>
        <ReceiptCard width={width} height={height} />
      </Animated.View>
    </GestureDetector>
  );
}

export function OnboardingOverlay({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const cardW = Math.min(width * 0.74, 300);
  const cardH = height * 0.54;

  const [index, setIndex] = useState(0); // which receipt is on top
  const isLast = index === NUM - 1;

  return (
    <View style={StyleSheet.absoluteFill}>
      <BlurView intensity={22} tint="light" style={styles.fill} />
      <Pressable style={styles.fill} onPress={onClose} />

      <Pressable onPress={onClose} hitSlop={16} style={[styles.close, { top: insets.top + spacing.md }]}>
        <Text style={styles.closeGlyph}>✕</Text>
      </Pressable>

      <View style={styles.center} pointerEvents="box-none">
        <View style={{ width: cardW, height: cardH }}>
          {/* Deepest first so the top card paints last. */}
          {[2, 1, 0]
            .filter((i) => i >= index)
            .map((i) => {
              const depth = i - index;
              if (i === index && !isLast) {
                return (
                  <SwipeCard key={i} width={cardW} height={cardH} onSwiped={() => setIndex((n) => n + 1)} />
                );
              }
              return (
                <View key={i} style={[styles.cardWrap, { width: cardW, height: cardH }, behindStyle(depth)]}>
                  <ReceiptCard width={cardW} height={cardH} />
                </View>
              );
            })}
        </View>

        {!isLast && <Text style={styles.hint}>Swipe to continue</Text>}
      </View>

      {/* "Let's go" appears only on the third receipt. */}
      {isLast && (
        <Pressable onPress={onComplete} style={[styles.cta, { bottom: insets.bottom + spacing.xl }]}>
          <Text style={styles.ctaLabel}>Let&apos;s go</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  close: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 10,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: { fontSize: 20, color: colors.textSecondary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardWrap: { position: 'absolute' },
  hint: { position: 'absolute', bottom: -40, color: colors.textSecondary, fontSize: 13 },
  cta: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.ctaBackground,
    borderRadius: radius.pill,
  },
  ctaLabel: { ...typography.button, color: colors.ctaText },
});
