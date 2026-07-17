/**
 * FolderBack — the folder's back panel (the tabbed silhouette).
 *
 * Returns Skia nodes rather than its own Canvas: the four parts share one
 * canvas so the flap's BackdropFilter can frost the sheets beneath it (a
 * backdrop filter only sees what's drawn below it in the SAME canvas).
 * Still independently animatable — pass `transform`, which accepts a
 * Reanimated shared value.
 */
import React from 'react';
import { CornerPathEffect, Group, LinearGradient, Path, vec, type Transforms3d } from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';

import { BACK_PATH, COLORS, CORNER_R, EDGE_W } from '@/components/receipt/folder/geometry';

export function FolderBack({ transform }: { transform?: Transforms3d | SharedValue<Transforms3d> }) {
  return (
    <Group transform={transform}>
      <Path path={BACK_PATH}>
        <LinearGradient start={vec(0, 6)} end={vec(0, 70)} colors={[COLORS.backTop, COLORS.backBottom]} />
        <CornerPathEffect r={CORNER_R} />
      </Path>
      {/* Edge hairline — reads as the lit rim of a glass pane. */}
      <Path path={BACK_PATH} style="stroke" strokeWidth={EDGE_W} color={COLORS.edge} opacity={0.5}>
        <CornerPathEffect r={CORNER_R} />
      </Path>
    </Group>
  );
}
