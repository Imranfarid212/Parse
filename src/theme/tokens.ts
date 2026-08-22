/**
 * Parse design tokens — the single source of truth the UI and the Figma file
 * both track (clean-fintech direction). Keep names/values in sync with the
 * Figma Variables of the same names.
 */
import { type TextStyle } from 'react-native';

/** Raw palette. Aurora hues mirror the landing-screen background streaks. */
export const palette = {
  ink: '#0C0D10',
  inkSoft: '#5A5F6A',
  inkFaint: '#9CA3AF',
  buttonDark: '#2b2a2a',
  forest: '#047857',
  forestSurface: '#ECFDF5',
  hairline: '#EDEEF0',
  /** One step darker than `hairline` — for borders that must read as an edge
   *  (inputs, unselected option cards) rather than as a divider. */
  hairlineStrong: '#E3E5E9',
  canvas: '#FBFBFD',
  /** Recessed fill inside a white card — icon chips, tracks, secondary rows. */
  canvasSubtle: '#F4F5F7',
  surface: '#FFFFFF',
  white: '#FFFFFF',
  // Status hues. Kept deliberately few: the UI is grey + forest, and these are
  // only for states the user must not misread (destructive, expiring, failed).
  danger: '#B42318',
  dangerSurface: '#FEF3F2',
  dangerBorder: '#FECDCA',
  warning: '#B45309',
  warningSurface: '#FFFBEB',
  warningBorder: '#FDE68A',
  info: '#2563EB',
  infoSurface: '#EFF6FF',
  // Aurora streak hues (blue → indigo → violet)
  auroraBlue: '#3B82F6',
  auroraSky: '#60A5FA',
  auroraBlueLight: '#93C5FD',
  auroraIndigo: '#A5B4FC',
  auroraViolet: '#DDD6FE',
} as const;

/** Dark counterparts for the semantic palette. Light mode deliberately keeps
 * the exact existing values above. */
export const darkPalette = {
  ink: '#F4F4F5', inkSoft: '#B6B8C0', inkFaint: '#787B85', buttonDark: '#F4F4F5',
  forest: '#34D399', forestSurface: '#123D32', hairline: '#2A2C32', hairlineStrong: '#373941',
  canvas: '#111215', canvasSubtle: '#1B1C21', surface: '#191A1F', white: '#17181C',
  danger: '#FF8A82', dangerSurface: '#4A2020', dangerBorder: '#773434',
  warning: '#F6C665', warningSurface: '#423515', warningBorder: '#705A20',
  info: '#8AB4FF', infoSurface: '#1C3457',
} as const;

/**
 * Semantic colors — reference these in components, not the raw palette.
 *
 * These are plain hex strings, deliberately. They are read by three separate
 * renderers — RN style props, Reanimated worklets and Skia — and only the first
 * of those accepts DynamicColorIOS/PlatformColor objects, so a native dynamic
 * colour would silently become `null` in a worklet and throw in Skia. Themes
 * are therefore swapped in JS and delivered through `@/theme/appearance`.
 */
export const lightColors = {
  background: palette.canvas,
  surface: palette.surface,
  /** Recessed fill *inside* a surface. Never a page background. */
  surfaceSubtle: palette.canvasSubtle,
  textPrimary: palette.ink,
  textSecondary: palette.inkSoft,
  textFaint: palette.inkFaint,
  border: palette.hairline,
  borderStrong: palette.hairlineStrong,
  /** Deep-green accent for "done"/progress marks. Also the single selection
   *  colour across the app: a chosen chip, plan, or filter is forest. */
  accent: palette.forest,
  accentSurface: palette.forestSurface,
  /** Dark pill used for the one primary action on a screen. Actions are dark,
   *  selections are forest — the two are never swapped. */
  ctaBackground: palette.buttonDark,
  ctaText: palette.white,
  danger: palette.danger,
  dangerSurface: palette.dangerSurface,
  dangerBorder: palette.dangerBorder,
  warning: palette.warning,
  warningSurface: palette.warningSurface,
  warningBorder: palette.warningBorder,
  info: palette.info,
  infoSurface: palette.infoSurface,
} as const;

/** Every semantic colour, as a plain string. */
export type ColorTokens = Record<keyof typeof lightColors, string>;

/**
 * The dark set. `satisfies` is what keeps the two in lockstep: a token added to
 * `lightColors` without a counterpart here is a compile error, not a screen
 * that renders the wrong colour in one mode.
 */
export const darkColors = {
  background: darkPalette.canvas,
  surface: darkPalette.surface,
  surfaceSubtle: darkPalette.canvasSubtle,
  textPrimary: darkPalette.ink,
  textSecondary: darkPalette.inkSoft,
  textFaint: darkPalette.inkFaint,
  border: darkPalette.hairline,
  borderStrong: darkPalette.hairlineStrong,
  accent: darkPalette.forest,
  accentSurface: darkPalette.forestSurface,
  ctaBackground: darkPalette.buttonDark,
  ctaText: darkPalette.white,
  danger: darkPalette.danger,
  dangerSurface: darkPalette.dangerSurface,
  dangerBorder: darkPalette.dangerBorder,
  warning: darkPalette.warning,
  warningSurface: darkPalette.warningSurface,
  warningBorder: darkPalette.warningBorder,
  info: darkPalette.info,
  infoSurface: darkPalette.infoSurface,
} satisfies ColorTokens;

type Shadow = { offsetX: number; offsetY: number; blurRadius: number; color: string };
export type ElevationTokens = { card: Shadow[]; raised: Shadow[] };

/** The two shadows in the system. Anything deeper reads as a different app. */
export const lightElevation: ElevationTokens = {
  /** Resting white card on the canvas. */
  card: [{ offsetX: 0, offsetY: 8, blurRadius: 30, color: 'rgba(12,13,16,0.04)' }],
  /** A control that sits above a card — segmented indicators, knobs. */
  raised: [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(12,13,16,0.10)' }],
};

/**
 * Dark shadows are much heavier than their light counterparts and still read as
 * less. A 4%-black shadow is simply invisible on a #111215 canvas, which would
 * leave every card flat — on dark it is `colors.border` that does most of the
 * separating and the shadow only deepens it.
 */
export const darkElevation: ElevationTokens = {
  card: [{ offsetX: 0, offsetY: 8, blurRadius: 24, color: 'rgba(0,0,0,0.40)' }],
  raised: [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(0,0,0,0.50)' }],
};

/**
 * @deprecated Light-mode values, for files not yet migrated to `useStyles`.
 * Anything reading these is pinned to light and will not follow the toggle —
 * see the `no-restricted-syntax` guard in eslint.config.js. Delete once the
 * last consumer is converted.
 */
export const colors = lightColors;
/** @deprecated See `colors`. Use the second argument of `makeStyles`. */
export const elevation = lightElevation;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 16,
  lg: 24,
  pill: 999,
} as const;

/** Instrument Sans — loaded in the root layout via @expo-google-fonts. Weight
 * lives in the family name, so don't also set fontWeight (avoids faux-bold). */
export const fontFamily = {
  display: 'InstrumentSans_700Bold',
  semibold: 'InstrumentSans_600SemiBold',
  medium: 'InstrumentSans_500Medium',
  regular: 'InstrumentSans_400Regular',
} as const;

export const typography = {
  display: {
    fontFamily: fontFamily.display,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -1.2,
  },
  /** Screen title one step below `display` — panel headers, sheet titles.
   *  Tracking is re-tuned for the smaller size rather than inherited. */
  heading: {
    fontFamily: fontFamily.display,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.7,
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 17,
    lineHeight: 24,
  },
  /** Uppercase section marker above a card. */
  eyebrow: {
    fontFamily: fontFamily.semibold,
    fontSize: 12,
  },
  /** Field label above an input. */
  label: {
    fontFamily: fontFamily.semibold,
    fontSize: 13,
  },
  /** The primary line of a list row. */
  row: {
    fontFamily: fontFamily.semibold,
    fontSize: 15,
  },
  /** Supporting line under a row label, or a value on the right. */
  meta: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    fontFamily: fontFamily.semibold,
    fontSize: 16,
    lineHeight: 20,
  },
} satisfies Record<string, TextStyle>;

/** Aurora background tuning — read by AuroraBackground.tsx. */
export const aurora = {
  streakColors: [
    palette.auroraBlue,
    palette.auroraIndigo,
    palette.auroraSky,
    palette.auroraViolet,
    palette.auroraBlueLight,
  ],
  blur: 64,
  opacity: 0.55,
  driftMs: 60000,
} as const;
