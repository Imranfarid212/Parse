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
  hairline: '#EDEEF0',
  canvas: '#FBFBFD',
  surface: '#FFFFFF',
  white: '#FFFFFF',
  // Aurora streak hues (blue → indigo → violet)
  auroraBlue: '#3B82F6',
  auroraSky: '#60A5FA',
  auroraBlueLight: '#93C5FD',
  auroraIndigo: '#A5B4FC',
  auroraViolet: '#DDD6FE',
} as const;

/** Semantic colors — reference these in components, not the raw palette. */
export const colors = {
  background: palette.canvas,
  surface: palette.surface,
  textPrimary: palette.ink,
  textSecondary: palette.inkSoft,
  textFaint: palette.inkFaint,
  border: palette.hairline,
  /** Deep-green accent for "done"/progress marks. */
  accent: palette.forest,
  ctaBackground: palette.buttonDark,
  ctaText: palette.white,
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
  regular: 'InstrumentSans_400Regular',
} as const;

export const typography = {
  display: {
    fontFamily: fontFamily.display,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -1.2,
  },
  subtitle: {
    fontFamily: fontFamily.regular,
    fontSize: 17,
    lineHeight: 24,
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
