/**
 * OnboardingOverlay — skeleton. Opens over the landing screen: a frosted
 * backdrop + three empty, swipeable cards. A "Let's go" button appears once
 * the user reaches the third card. Card contents are placeholders (TBD).
 *
 * NOTE: the backdrop is a frosted scrim standing in for a real gaussian blur.
 * Swap `<Scrim/>` for expo-blur's <BlurView intensity={30} tint="light"/> at
 * the next native dev-build rebuild (expo-blur is a native module).
 */
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';

import { colors, radius, spacing, typography } from '@/theme/tokens';

const NUM_CARDS = 3;

export function OnboardingOverlay({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);

  const cardWidth = width * 0.8;
  const cardHeight = height * 0.52;

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  const isLast = index === NUM_CARDS - 1;

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Real gaussian blur backdrop — tap to dismiss. */}
      <BlurView intensity={22} tint="light" style={styles.fill} />
      <Pressable style={styles.fill} onPress={onClose} />

      {/* Close affordance */}
      <Pressable onPress={onClose} hitSlop={16} style={[styles.close, { top: insets.top + spacing.md }]}>
        <Text style={styles.closeGlyph}>✕</Text>
      </Pressable>

      {/* Swipeable cards */}
      <View style={styles.center} pointerEvents="box-none">
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumEnd}
          style={{ height: cardHeight, flexGrow: 0 }}
        >
          {Array.from({ length: NUM_CARDS }).map((_, i) => (
            <View key={i} style={[styles.page, { width }]}>
              <View style={[styles.card, { width: cardWidth, height: cardHeight }]}>
                {/* Empty placeholder — real content TBD */}
                <Text style={styles.cardIndex}>{i + 1}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        {/* Progress dots */}
        <View style={styles.dots}>
          {Array.from({ length: NUM_CARDS }).map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
      </View>

      {/* "Let's go" appears only on the last card */}
      {isLast && (
        <Pressable onPress={onComplete} style={[styles.cta, { bottom: insets.bottom + spacing.xl }]}>
          <Text style={styles.ctaLabel}>Let&apos;s go</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
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
  page: { alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    // subtle depth
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  cardIndex: { ...typography.display, fontSize: 64, lineHeight: 76, color: '#E5E7EB' },
  dots: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D1D5DB' },
  dotActive: { backgroundColor: colors.textPrimary, width: 22 },
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
