/**
 * Folder geometry — one source of truth for the four parts, so they can be
 * separate animatable components without drifting out of register.
 *
 * Everything is authored in a 100 x 78 viewbox and scaled by the caller's
 * width. Paths are SVG strings; Skia parses them directly, and a
 * CornerPathEffect rounds every corner at once (RN has no way to round the
 * corners of an arbitrary polygon — rule 1, rebuild it natively in Skia).
 *
 * Draw order is load-bearing: BACK → sheet back → sheet front → FRONT.
 * An arriving receipt goes between the sheets and the front panel, so it
 * lands *inside* the folder.
 */

export const VIEW_W = 100;
export const VIEW_H = 78;

/** Height for a given folder width. */
export const folderHeight = (width: number) => (width * VIEW_H) / VIEW_W;

/**
 * Back panel: the classic tab silhouette — a tall tab on the left, a diagonal
 * step down, then the lower top edge running right.
 */
export const BACK_PATH = 'M 7.9,6.1 L 44.7,6.1 L 51.2,15.4 L 85.6,15.4 L 85.6,70.2 L 7.9,70.2 Z';

/**
 * Front flap: a parallelogram skewed left as it descends (top and bottom are
 * the same width — that skew is what reads as the folder leaning open), with
 * its own tab notch on the top-left.
 */
export const FRONT_PATH = 'M 18.4,30.7 L 57.9,30.7 L 68.8,23.3 L 97,24.6 L 85.6,76.7 L 7,76.7 Z';

/** The two sheets, offset so the back one shows as a hairline behind the front. */
export const SHEETS = {
  back: { x: 13, y: 16, w: 70, h: 46, r: 2 },
  front: { x: 15.5, y: 18.5, w: 66, h: 44, r: 2 },
} as const;

export type SheetVariant = keyof typeof SHEETS;

/**
 * How each sheet displaces as `spread` goes 0 → 1 (parting to accept an
 * arriving receipt). In viewbox units, about the sheet's own centre; `rot` is
 * radians, as Skia wants.
 *
 * Exported rather than inlined in RecentsFolder because the arriving receipt
 * has to land on the front sheet's DISPLACED position — by the time it touches
 * down, spread is 1 and the sheet is no longer where SHEETS says it is. Two
 * copies of these numbers is exactly the drift this module exists to prevent.
 */
export const SPREAD = {
  back: { dx: -3.5, dy: -3, rot: -0.07 },
  front: { dx: 3.5, dy: -2, rot: 0.055 },
} as const;

/**
 * Premium emerald, translucent so the panels read as frosted glass rather than
 * paint. The greens are deliberately alpha'd: the flap's frost comes from a
 * Skia BackdropFilter blurring the sheets beneath it, which only shows through
 * if the green above it lets light past.
 */
export const COLORS = {
  backTop: 'rgba(6,148,105,0.74)',
  backBottom: 'rgba(4,95,70,0.86)',
  frontTop: 'rgba(23,199,141,0.60)',
  frontBottom: 'rgba(5,132,96,0.78)',
  sheetBack: 'rgba(236,241,239,0.92)',
  sheetFront: '#FFFFFF',
  /** Hairline along the panel edges — what sells glass as a physical pane. */
  edge: 'rgba(255,255,255,0.55)',
} as const;

/** Corner rounding, in viewbox units. */
export const CORNER_R = 3;

/** Backdrop blur under the flap, in viewbox units. */
export const FROST_BLUR = 2.2;

/** Edge hairline width, in viewbox units. */
export const EDGE_W = 0.7;
