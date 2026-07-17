/**
 * FolderSheet — one of the two white sheets inside the folder.
 *
 * Each sheet is its own component and its own canvas so they can be animated
 * separately (parting to accept an arriving receipt, riffling, etc.); wrap one
 * in an Animated.View to move it.
 */
import React from 'react';
import { Canvas, Group, RoundedRect } from '@shopify/react-native-skia';

import { COLORS, SHEETS, VIEW_W, folderHeight, type SheetVariant } from '@/components/receipt/folder/geometry';

export function FolderSheet({
  width,
  variant,
  color,
}: {
  width: number;
  /** `back` sits slightly higher/wider, showing as a hairline behind `front`. */
  variant: SheetVariant;
  color?: string;
}) {
  const s = SHEETS[variant];
  const fill = color ?? (variant === 'back' ? COLORS.sheetBack : COLORS.sheetFront);

  return (
    <Canvas
      style={{ position: 'absolute', left: 0, top: 0, width, height: folderHeight(width) }}
      pointerEvents="none"
    >
      <Group transform={[{ scale: width / VIEW_W }]}>
        <RoundedRect x={s.x} y={s.y} width={s.w} height={s.h} r={s.r} color={fill} />
      </Group>
    </Canvas>
  );
}
