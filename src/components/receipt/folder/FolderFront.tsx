/**
 * FolderFront — the folder's front flap. Drawn last, so anything flying in
 * passes behind it.
 *
 * Its own component and its own canvas so it can be animated independently
 * (e.g. tipped open); wrap it in an Animated.View to move it.
 */
import React from 'react';
import { Canvas, CornerPathEffect, Group, Path } from '@shopify/react-native-skia';

import { COLORS, CORNER_R, FRONT_PATH, VIEW_W, folderHeight } from '@/components/receipt/folder/geometry';

export function FolderFront({ width, color = COLORS.front }: { width: number; color?: string }) {
  return (
    <Canvas
      style={{ position: 'absolute', left: 0, top: 0, width, height: folderHeight(width) }}
      pointerEvents="none"
    >
      <Group transform={[{ scale: width / VIEW_W }]}>
        <Path path={FRONT_PATH} color={color}>
          <CornerPathEffect r={CORNER_R} />
        </Path>
      </Group>
    </Canvas>
  );
}
