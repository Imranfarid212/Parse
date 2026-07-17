/**
 * FolderSheet — one of the two white sheets inside the folder.
 *
 * Each sheet is its own component so they can be animated separately (parting
 * to accept an arriving receipt, riffling, etc.): pass `transform`, which
 * accepts a Reanimated shared value. Transforms are applied about the sheet's
 * own centre via Skia's `origin`, so a rotation pivots in place instead of
 * swinging around the canvas corner.
 *
 * Returns Skia nodes rather than its own Canvas — see FolderBack for why.
 */
import React from 'react';
import { Group, RoundedRect, vec, type Transforms3d } from '@shopify/react-native-skia';
import type { SharedValue } from 'react-native-reanimated';

import { COLORS, SHEETS, type SheetVariant } from '@/components/receipt/folder/geometry';

export function FolderSheet({
  variant,
  color,
  transform,
}: {
  /** `back` sits slightly higher/wider, showing as a hairline behind `front`. */
  variant: SheetVariant;
  color?: string;
  transform?: Transforms3d | SharedValue<Transforms3d>;
}) {
  const s = SHEETS[variant];
  const fill = color ?? (variant === 'back' ? COLORS.sheetBack : COLORS.sheetFront);

  return (
    <Group transform={transform} origin={vec(s.x + s.w / 2, s.y + s.h / 2)}>
      <RoundedRect x={s.x} y={s.y} width={s.w} height={s.h} r={s.r} color={fill} />
    </Group>
  );
}
