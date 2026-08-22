/**
 * Parse design tokens — the single source of truth the UI and the Figma file
 * both track (clean-fintech direction). Keep names/values in sync with the
 * Figma Variables of the same names.
 */
import { DynamicColorIOS, Platform, PlatformColor, type TextStyle } from 'react-native';

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
const darkPalette = {
  ink: '#F4F4F5', inkSoft: '#B6B8C0', inkFaint: '#787B85', buttonDark: '#F4F4F5',
  forest: '#34D399', forestSurface: '#123D32', hairline: '#2A2C32', hairlineStrong: '#373941',
  canvas: '#111215', canvasSubtle: '#1B1C21', surface: '#191A1F', white: '#17181C',
  danger: '#FF8A82', dangerSurface: '#4A2020', dangerBorder: '#773434',
  warning: '#F6C665', warningSurface: '#423515', warningBorder: '#705A20',
  info: '#8AB4FF', infoSurface: '#1C3457',
} as const;

function adaptiveColor(light: string, dark: string, resource: string): string {
  if (Platform.OS === 'ios') return DynamicColorIOS({ light, dark }) as unknown as string;
  if (Platform.OS === 'android') return PlatformColor(`@color/parse_${resource}`) as unknown as string;
  return light;
}

/** Semantic colors — reference these in components, not the raw palette. */
export const colors = {
  background: adaptiveColor(palette.canvas, darkPalette.canvas, 'background'),
  surface: adaptiveColor(palette.surface, darkPalette.surface, 'surface'),
  /** Recessed fill *inside* a surface. Never a page background. */
  surfaceSubtle: adaptiveColor(palette.canvasSubtle, darkPalette.canvasSubtle, 'surface_subtle'),
  textPrimary: adaptiveColor(palette.ink, darkPalette.ink, 'text_primary'),
  textSecondary: adaptiveColor(palette.inkSoft, darkPalette.inkSoft, 'text_secondary'),
  textFaint: adaptiveColor(palette.inkFaint, darkPalette.inkFaint, 'text_faint'),
  border: adaptiveColor(palette.hairline, darkPalette.hairline, 'border'),
  borderStrong: adaptiveColor(palette.hairlineStrong, darkPalette.hairlineStrong, 'border_strong'),
  /** Deep-green accent for "done"/progress marks. Also the single selection
   *  colour across the app: a chosen chip, plan, or filter is forest. */
  accent: adaptiveColor(palette.forest, darkPalette.forest, 'accent'),
  accentSurface: adaptiveColor(palette.forestSurface, darkPalette.forestSurface, 'accent_surface'),
  /** Dark pill used for the one primary action on a screen. Actions are dark,
   *  selections are forest — the two are never swapped. */
  ctaBackground: adaptiveColor(palette.buttonDark, darkPalette.buttonDark, 'cta_background'),
  ctaText: adaptiveColor(palette.white, darkPalette.white, 'cta_text'),
  danger: adaptiveColor(palette.danger, darkPalette.danger, 'danger'),
  dangerSurface: adaptiveColor(palette.dangerSurface, darkPalette.dangerSurface, 'danger_surface'),
  dangerBorder: adaptiveColor(palette.dangerBorder, darkPalette.dangerBorder, 'danger_border'),
  warning: adaptiveColor(palette.warning, darkPalette.warning, 'warning'),
  warningSurface: adaptiveColor(palette.warningSurface, darkPalette.warningSurface, 'warning_surface'),
  warningBorder: adaptiveColor(palette.warningBorder, darkPalette.warningBorder, 'warning_border'),
  info: adaptiveColor(palette.info, darkPalette.info, 'info'),
  infoSurface: adaptiveColor(palette.infoSurface, darkPalette.infoSurface, 'info_surface'),
} as const;

/** The two shadows in the system. Anything deeper reads as a different app. */
export const elevation = {
  /** Resting white card on the canvas. */
  card: [{ offsetX: 0, offsetY: 8, blurRadius: 30, color: 'rgba(12,13,16,0.04)' }],
  /** A control that sits above a card — segmented indicators, knobs. */
  raised: [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(12,13,16,0.10)' }],
} as const;

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
