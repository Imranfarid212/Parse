/**
 * MetaballTrail — the gooey wake that drags behind the receipt as it flies.
 *
 * IT IS A TRAIL, NOT A TRANSFORMATION. The receipt stays a rigid, readable
 * card the whole way and is drawn ON TOP of this layer; nothing here ever
 * replaces it. An earlier version cross-faded the card into a blob, which is
 * why the receipt turned into clay — a thresholded blob is, by definition, not
 * a receipt.
 *
 * Technique: draw the anchor + trailing blobs into ONE Skia layer, blur the
 * layer, then crush the alpha with a ColorMatrix. Overlapping blurred edges
 * survive the threshold and fuse into a neck; separated ones snap apart. This
 * only exists inside Skia — Skia filters cannot apply to RN views, which is why
 * the wake is its own canvas sitting behind the card (rule 1: rebuild the
 * effect natively rather than porting a web filter).
 *
 * The anchor blob rides exactly under the card at ~0.9 its size, so its
 * thresholded silhouette hides behind the paper and the goo only shows where
 * it stretches out behind. Trail blobs sample the same path at `p - lag`.
 */
import React from 'react';
import { Blur, Canvas, Circle, ColorMatrix, Group, Paint, RoundedRect, rect, rrect } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { flightScale, lerp } from '@/components/receipt/flight';

export type Point = { x: number; y: number };

/** Alpha threshold: multiply alpha hard, then bias it negative. */
const THRESHOLD = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 22, -9,
];

/** How far behind the head each blob sits, as a fraction of the flight. */
const TRAIL = [0.06, 0.12, 0.19, 0.27];
const BLOB = '#FFFFFF';

export function MetaballTrail({
  p,
  from,
  to,
  cardWidth,
  cardHeight,
  blur = 12,
}: {
  /** Flight progress, 0 → 1. */
  p: SharedValue<number>;
  /** Card centre at rest. */
  from: Point;
  /** Folder mouth. */
  to: Point;
  cardWidth: number;
  cardHeight: number;
  blur?: number;
}) {
  // Sits under the card, matching its shrink. Invisible except where the goo
  // stretches out from behind the paper.
  const anchor = useDerivedValue(() => {
    const t = p.value;
    const s = flightScale(t);
    const w = cardWidth * s * 0.9;
    const h = cardHeight * s * 0.9;
    const x = lerp(from.x, to.x, t) - w / 2;
    const y = lerp(from.y, to.y, t) - h / 2;
    const r = Math.min(w, h) * 0.2;
    return rrect(rect(x, y, w, h), r, r);
  });

  // On as soon as it starts moving; off as it enters the folder.
  const opacity = useDerivedValue(() => {
    const t = p.value;
    if (t <= 0.01) return 0;
    if (t < 0.12) return (t - 0.01) / 0.11;
    if (t > 0.88) return Math.max(0, (1 - t) / 0.12);
    return 1;
  });

  return (
    <Canvas style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2 }} pointerEvents="none">
      <Group
        opacity={opacity}
        layer={
          <Paint>
            <Blur blur={blur} />
            <ColorMatrix matrix={THRESHOLD} />
          </Paint>
        }
      >
        <RoundedRect rect={anchor} color={BLOB} />
        {TRAIL.map((lag, i) => (
          <TrailBlob key={i} p={p} lag={lag} from={from} to={to} cardWidth={cardWidth} index={i} />
        ))}
      </Group>
    </Canvas>
  );
}

function TrailBlob({
  p,
  lag,
  from,
  to,
  cardWidth,
  index,
}: {
  p: SharedValue<number>;
  lag: number;
  from: Point;
  to: Point;
  cardWidth: number;
  index: number;
}) {
  const cx = useDerivedValue(() => lerp(from.x, to.x, Math.max(0, p.value - lag)));
  const cy = useDerivedValue(() => lerp(from.y, to.y, Math.max(0, p.value - lag)));
  const r = useDerivedValue(() => {
    const t = Math.max(0, p.value - lag);
    // Sized off the card at that point in its shrink, tapering down the tail.
    return (cardWidth * flightScale(t) * 0.3) / (1 + index * 0.4);
  });

  return <Circle cx={cx} cy={cy} r={r} color={BLOB} />;
}
