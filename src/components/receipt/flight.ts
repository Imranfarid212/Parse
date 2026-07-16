/**
 * The flight curve, shared by the RN card and the Skia wake behind it.
 *
 * Both layers must read the same numbers or the goo drifts off the card, so
 * the curve lives here rather than being written twice. Everything is a
 * worklet: these run on the UI thread inside useAnimatedStyle/useDerivedValue.
 */

/** Card scale at the end of the flight — small enough to drop into the folder. */
export const END_SCALE = 0.12;

/** Gentle shrink through the first 10%, drastic after. */
export function flightScale(t: number): number {
  'worklet';
  return t < 0.1 ? 1 + (0.9 - 1) * (t / 0.1) : 0.9 + (END_SCALE - 0.9) * ((t - 0.1) / 0.9);
}

export function lerp(a: number, b: number, t: number): number {
  'worklet';
  return a + (b - a) * t;
}
