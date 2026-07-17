/**
 * RecentsFolder — the folder receipts fly into.
 *
 * Just a composition. The four parts each own their shape (folder/FolderBack,
 * folder/FolderSheet ×2, folder/FolderFront) and each takes a `transform` that
 * accepts a Reanimated shared value, so any of them can be animated on its own.
 * Geometry is shared via folder/geometry.ts so they stay in register.
 *
 * They share ONE canvas rather than owning one each, because the flap's frost
 * is a Skia BackdropFilter — and a backdrop filter can only blur what's already
 * been drawn in the same canvas. That's what `<Frost/>` is doing between the
 * sheets and the flap: the sheets go soft under the green, which is what makes
 * it read as frosted glass instead of tinted plastic.
 *
 * Draw order is load-bearing: back → sheets → frost → FRONT. An arriving
 * receipt is drawn between the sheets and the front flap, so it lands inside.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Canvas, Group, type Transforms3d } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { FolderBack } from '@/components/receipt/folder/FolderBack';
import { FolderFront, Frost } from '@/components/receipt/folder/FolderFront';
import { FolderSheet } from '@/components/receipt/folder/FolderSheet';
import { VIEW_W, folderHeight } from '@/components/receipt/folder/geometry';
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

  // Viewbox units throughout — these run inside the scaled group.
  // NB: Skia rotations are radians, not degrees.
  const backSheet = useDerivedValue<Transforms3d>(() => {
    const p = spread?.value ?? 0;
    return [{ translateX: -3.5 * p }, { translateY: -3 * p }, { rotate: -0.07 * p }];
  });

  const frontSheet = useDerivedValue<Transforms3d>(() => {
    const p = spread?.value ?? 0;
    return [{ translateX: 3.5 * p }, { translateY: -2 * p }, { rotate: 0.055 * p }];
  });

  return (
    <View style={{ width, height }}>
      <Canvas style={{ width, height }} pointerEvents="none">
        <Group transform={[{ scale: width / VIEW_W }]}>
          <FolderBack />
          <FolderSheet variant="back" transform={backSheet} />
          <FolderSheet variant="front" transform={frontSheet} />
          {/* Blurs the back panel and both sheets, clipped to the flap. */}
          <Frost />
          <FolderFront />
        </Group>
      </Canvas>

      {!!label && (
        <Text numberOfLines={1} style={[styles.label, { top: height + 2, fontSize: Math.max(9, width * 0.11) }]}>
          {label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontFamily: fontFamily.semibold,
    color: colors.ctaText,
  },
});
