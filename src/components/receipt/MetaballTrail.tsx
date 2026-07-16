/**
 * MetaballTrail — the gooey drag behind the receipt as it shrinks toward the
 * folder.
 *
 * Technique: draw the head blob plus a few trailing blobs into one Skia layer,
 * blur that layer, then crush the alpha with a ColorMatrix. Blurred edges that
 * overlap survive the threshold and fuse; edges that don't, snap apart. That is
 * the whole metaball trick, and it only works inside Skia — which is why the
 * flight hands the RN card off to this layer (rule 1: rebuild the effect
 * natively rather than porting a web filter).
 *
 * The trail is positional, not physical: blob i samples the same flight path at
 * `p - lag`, so it is always behind the head by a fixed arc. Cheap, stable, and
 * it stretches exactly when the head accelerates.
 */
import React from 'react';
import { Blur, Canvas, ColorMatrix, Group, Paint, Circle, RoundedRect, rect, rrect } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

export type Point = { x: number; y: number };

/** Alpha threshold: multiply alpha hard, then bias it negative. */
const THRESHOLD = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 22, -9,
];

const TRAIL = [0.055, 0.11, 0.17, 0.24];
const BLOB = '#FFFFFF';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function MetaballTrail({
  p,
  from,
  to,
  headSize,
  blur = 11,
}: {
  /** Flight progress, 0 → 1. */
  p: SharedValue<number>;
  /** Card centre at rest. */
  from: Point;
  /** Folder mouth. */
  to: Point;
  /** Head blob size at p = 0. */
  headSize: number;
  blur?: number;
}) {
  // The head is a rounded rect (it *is* the receipt); the trail are circles.
  const head = useDerivedValue(() => {
    const t = p.value;
    // Matches the card's shrink: gentle to 0.10, drastic after.
    const scale = t < 0.1 ? lerp(1, 0.9, t / 0.1) : lerp(0.9, 0.06, (t - 0.1) / 0.9);
    const w = headSize * scale;
    const h = w * 1.35;
    const x = lerp(from.x, to.x, t) - w / 2;
    const y = lerp(from.y, to.y, t) - h / 2;
    const r = Math.min(w, h) * 0.32;
    return rrect(rect(x, y, w, h), r, r);
  });

  // Fade the whole layer in as the RN card fades out, and out again on arrival.
  const opacity = useDerivedValue(() => {
    const t = p.value;
    if (t < 0.1) return 0;
    if (t < 0.3) return (t - 0.1) / 0.2;
    if (t > 0.93) return Math.max(0, (1 - t) / 0.07);
    return 1;
  });

  return (
    <Canvas style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
      <Group
        opacity={opacity}
        layer={
          <Paint>
            <Blur blur={blur} />
            <ColorMatrix matrix={THRESHOLD} />
          </Paint>
        }
      >
        <RoundedRect rect={head} color={BLOB} />
        {TRAIL.map((lag, i) => (
          <TrailBlob key={i} p={p} lag={lag} from={from} to={to} headSize={headSize} index={i} />
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
  headSize,
  index,
}: {
  p: SharedValue<number>;
  lag: number;
  from: Point;
  to: Point;
  headSize: number;
  index: number;
}) {
  const cx = useDerivedValue(() => lerp(from.x, to.x, Math.max(0, p.value - lag)));
  const cy = useDerivedValue(() => lerp(from.y, to.y, Math.max(0, p.value - lag)));
  const r = useDerivedValue(() => {
    const t = Math.max(0, p.value - lag);
    const scale = t < 0.1 ? lerp(1, 0.9, t / 0.1) : lerp(0.9, 0.06, (t - 0.1) / 0.9);
    // Each blob is smaller than the one ahead of it, so the neck tapers.
    return (headSize * scale * 0.42) / (1 + index * 0.35);
  });

  return <Circle cx={cx} cy={cy} r={r} color={BLOB} />;
}
