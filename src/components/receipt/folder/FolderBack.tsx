/**
 * FolderBack — the folder's back panel (the tabbed silhouette).
 *
 * Its own component and its own canvas so it can be animated independently of
 * the front flap and the sheets; wrap it in an Animated.View to move it.
 */
import React from 'react';
import { Canvas, CornerPathEffect, Group, Path } from '@shopify/react-native-skia';

import { BACK_PATH, COLORS, CORNER_R, VIEW_W, folderHeight } from '@/components/receipt/folder/geometry';

export function FolderBack({ width, color = COLORS.back }: { width: number; color?: string }) {
  return (
    <Canvas
      style={{ position: 'absolute', left: 0, top: 0, width, height: folderHeight(width) }}
      pointerEvents="none"
    >
      <Group transform={[{ scale: width / VIEW_W }]}>
        <Path path={BACK_PATH} color={color}>
          <CornerPathEffect r={CORNER_R} />
        </Path>
      </Group>
    </Canvas>
  );
}
