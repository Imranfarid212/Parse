/**
 * RecentsFolder — the folder receipts fly into.
 *
 * Just a composition: the four parts each own their shape and canvas
 * (folder/FolderBack, folder/FolderSheet ×2, folder/FolderFront) so any of
 * them can be animated on its own. Geometry is shared via folder/geometry.ts
 * so they stay in register.
 *
 * Draw order is load-bearing: back → sheets → FRONT. An arriving receipt is
 * drawn between the sheets and the front flap, so it lands *inside*.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { FolderBack } from '@/components/receipt/folder/FolderBack';
import { FolderFront } from '@/components/receipt/folder/FolderFront';
import { FolderSheet } from '@/components/receipt/folder/FolderSheet';
import { folderHeight } from '@/components/receipt/folder/geometry';
import { colors, fontFamily } from '@/theme/tokens';

export function RecentsFolder({
  width,
  label = 'Recents',
  /** 0 → at rest, 1 → sheets parted to make room for an arriving receipt. */
  spread,
}: {
  width: number;
  label?: string;
  spread?: SharedValue<number>;
}) {
  const height = folderHeight(width);

  // The sheets lift and tilt apart as a receipt comes in.
  const backSheet = useAnimatedStyle(() => {
    const p = spread?.value ?? 0;
    return {
      transform: [
        { translateX: interpolate(p, [0, 1], [0, -0.04]) * width },
        { translateY: interpolate(p, [0, 1], [0, -0.05]) * height },
        { rotate: `${interpolate(p, [0, 1], [0, -4])}deg` },
      ],
    };
  });

  const frontSheet = useAnimatedStyle(() => {
    const p = spread?.value ?? 0;
    return {
      transform: [
        { translateX: interpolate(p, [0, 1], [0, 0.04]) * width },
        { translateY: interpolate(p, [0, 1], [0, -0.03]) * height },
        { rotate: `${interpolate(p, [0, 1], [0, 3])}deg` },
      ],
    };
  });

  return (
    <View style={{ width, height }}>
      <FolderBack width={width} />

      <Animated.View style={[styles.layer, backSheet]}>
        <FolderSheet width={width} variant="back" />
      </Animated.View>
      <Animated.View style={[styles.layer, frontSheet]}>
        <FolderSheet width={width} variant="front" />
      </Animated.View>

      <FolderFront width={width} />

      {!!label && (
        <Text numberOfLines={1} style={[styles.label, { top: height + 2, fontSize: Math.max(9, width * 0.11) }]}>
          {label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  label: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: fontFamily.semibold,
    color: colors.ctaText,
  },
});
