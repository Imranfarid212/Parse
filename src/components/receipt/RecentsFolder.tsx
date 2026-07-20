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
import { SPREAD, VIEW_W, folderHeight } from '@/components/receipt/folder/geometry';
import { colors, fontFamily } from '@/theme/tokens';

export function RecentsFolder({
  width,
  label = 'Recents',
  /** 0 → at rest, 1 → sheets parted to make room for an arriving receipt. */
  spread,
  /** 0 → flap shut, 1 → dropped open to receive a receipt. */
  flap,
  /** How far the flap drops when open, in viewbox units. */
  flapDrop = 5,
  /**
   * Which slice of the folder to draw.
   *
   * `all` is the whole thing in one canvas — correct whenever nothing needs to
   * sit *inside* it. But an arriving receipt is a React Native view, and an RN
   * view cannot be interleaved into a Skia canvas's draw order, so there is no
   * way to get it between the sheets and the flap within a single canvas.
   * Rendering `back` and `front` as two stacked layers leaves a gap in the
   * z-order for the receipt to occupy — see ReceiptReview.
   *
   * Frost rides with `back`: it's a BackdropFilter, so it can only blur what
   * was drawn before it in its OWN canvas. Left on the front layer it would
   * have an empty backdrop and blur nothing.
   */
  layer = 'all',
}: {
  width: number;
  label?: string;
  spread?: SharedValue<number>;
  flap?: SharedValue<number>;
  flapDrop?: number;
  layer?: 'all' | 'back' | 'front';
}) {
  const height = folderHeight(width);
  const back = layer === 'all' || layer === 'back';
  const front = layer === 'all' || layer === 'front';

  // Viewbox units throughout — these run inside the scaled group.
  // NB: Skia rotations are radians, not degrees.
  const backSheet = useDerivedValue<Transforms3d>(() => {
    const p = spread?.value ?? 0;
    return [{ translateX: SPREAD.back.dx * p }, { translateY: SPREAD.back.dy * p }, { rotate: SPREAD.back.rot * p }];
  });

  const frontSheet = useDerivedValue<Transforms3d>(() => {
    const p = spread?.value ?? 0;
    return [{ translateX: SPREAD.front.dx * p }, { translateY: SPREAD.front.dy * p }, { rotate: SPREAD.front.rot * p }];
  });

  // The flap drops straight down to open. Deliberately a translate and not a
  // rotate: a rotate would need an explicit origin on the flap's top edge, and
  // without one Skia swings it about the canvas origin instead.
  const flapT = useDerivedValue<Transforms3d>(() => [{ translateY: flapDrop * (flap?.value ?? 0) }]);

  return (
    <View style={{ width, height }}>
      {/* Nulls rather than fragments: Skia's reconciler takes children, and a
          Fragment is not a Skia node. */}
      <Canvas style={{ width, height }} pointerEvents="none">
        <Group transform={[{ scale: width / VIEW_W }]}>
          {back ? <FolderBack /> : null}
          {back ? <FolderSheet variant="back" transform={backSheet} /> : null}
          {back ? <FolderSheet variant="front" transform={frontSheet} /> : null}
          {/* Blurs the back panel and both sheets, clipped to the flap. */}
          {back ? <Frost /> : null}
          {front ? <FolderFront transform={flapT} /> : null}
        </Group>
      </Canvas>

      {!!label && back && (
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
