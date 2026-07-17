/**
 * FolderFront — the folder's front flap. Drawn last, so anything flying in
 * passes behind it.
 *
 * `Frost` is a separate export that must be rendered immediately BEFORE the
 * flap: it blurs whatever is already on the canvas (the back panel and both
 * sheets), clipped to the flap's outline, which is what makes the translucent
 * green above it read as frosted glass rather than tinted cellophane.
 *
 * Returns Skia nodes rather than its own Canvas — see FolderBack for why.
 */
import React from 'react';
import {
  BackdropFilter,
  Blur,
  CornerPathEffect,
  Group,
  LinearGradient,
  Path,
  vec,
  type Transforms3d,
} from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';

import { COLORS, CORNER_R, EDGE_W, FRONT_PATH, FROST_BLUR } from '@/components/receipt/folder/geometry';

/** Blurs the canvas beneath, clipped to the flap. Render just before FolderFront. */
export function Frost({ blur = FROST_BLUR }: { blur?: number }) {
  return <BackdropFilter filter={<Blur blur={blur} />} clip={FRONT_PATH} />;
}

export function FolderFront({ transform }: { transform?: Transforms3d | SharedValue<Transforms3d> }) {
  return (
    <Group transform={transform}>
      <Path path={FRONT_PATH}>
        <LinearGradient start={vec(0, 23)} end={vec(0, 77)} colors={[COLORS.frontTop, COLORS.frontBottom]} />
        <CornerPathEffect r={CORNER_R} />
      </Path>
      <Path path={FRONT_PATH} style="stroke" strokeWidth={EDGE_W} color={COLORS.edge}>
        <CornerPathEffect r={CORNER_R} />
      </Path>
    </Group>
  );
}
