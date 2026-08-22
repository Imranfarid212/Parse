/**
 * Theme delivery for the app.
 *
 * Themes are swapped in JS rather than with DynamicColorIOS/PlatformColor. The
 * short reason is that the app has three renderers — RN style props, Reanimated
 * worklets and Skia — and only RN accepts native colour objects; Reanimated's
 * `normalizeColor` returns null for a non-string and Skia's `Color()` rejects
 * one outright. The longer reason is Android: `uiMode` is in the manifest's
 * `configChanges`, so `setDefaultNightMode` never recreates the Activity, and
 * Fabric resolves a PlatformColor to an ARGB int once when it parses props —
 * with module-level StyleSheet identity never changing, the mounted tree would
 * simply never repaint. React-driven theming is what makes both platforms
 * behave the same.
 *
 * `Appearance.setColorScheme` is still called, but only as a side effect: it is
 * what keeps Alert, the keyboard, native pickers and the DayNight window
 * background in step with the toggle. Nothing here reads colours back from it.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Appearance,
  StyleSheet,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import * as SystemUI from 'expo-system-ui';

import {
  darkColors,
  darkElevation,
  darkPaper,
  lightColors,
  lightElevation,
  lightPaper,
  type ColorTokens,
  type ElevationTokens,
  type PaperTokens,
} from '@/theme/tokens';

/** Settings exposes this as a two-state switch, so the model is two-state too —
 *  there is deliberately no 'system' option to keep the toggle honest. */
export type ThemeMode = 'light' | 'dark';

export type Theme = {
  colors: ColorTokens;
  elevation: ElevationTokens;
  /** The silver-receipt material. Dimmed rather than darkened in dark mode —
   *  a receipt stays paper, it just sits under lower light. */
  paper: PaperTokens;
  isDark: boolean;
};

/** Both themes are module constants, so their identity is stable and they can
 *  key the per-theme StyleSheet cache in `makeStyles`. */
const lightTheme: Theme = { colors: lightColors, elevation: lightElevation, paper: lightPaper, isDark: false };
const darkTheme: Theme = { colors: darkColors, elevation: darkElevation, paper: darkPaper, isDark: true };

const THEME_MODE_KEY = 'parse.theme-mode';

/**
 * What a user with no stored preference gets. The app shipped light-only, so
 * light is what an existing user's first launch after this change must look
 * like — the OS setting deliberately does not get a vote.
 */
const DEFAULT_MODE: ThemeMode = 'light';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

/**
 * Read synchronously, at module load, before the first render.
 *
 * This is the whole reason the preference lives in expo-sqlite/kv-store rather
 * than SecureStore: an async read cannot resolve before the first paint, so a
 * dark-mode user would get a light frame on every cold start. A theme choice is
 * not a secret and does not need the keystore.
 */
function readStoredMode(): ThemeMode {
  try {
    const stored = Storage.getItemSync(THEME_MODE_KEY);
    return isThemeMode(stored) ? stored : DEFAULT_MODE;
  } catch {
    // A corrupt or unavailable store must not stop the app from rendering.
    return DEFAULT_MODE;
  }
}

type AppearanceContextValue = {
  mode: ThemeMode;
  isDark: boolean;
  theme: Theme;
  setMode: (mode: ThemeMode) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);

  const isDark = mode === 'dark';
  const theme = isDark ? darkTheme : lightTheme;

  useEffect(() => {
    // Side effect only — nothing here reads colours back from it. This is what
    // keeps Alert, the keyboard, native pickers and the DayNight window
    // background in step with the toggle.
    Appearance.setColorScheme(mode);
  }, [mode]);

  useEffect(() => {
    // The root view sits behind every screen; without this a push or a modal
    // dismissal can flash the old theme's background through the gap.
    void SystemUI.setBackgroundColorAsync(theme.colors.background);
  }, [theme]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      Storage.setItemSync(THEME_MODE_KEY, next);
    } catch {
      // Persistence is best-effort; the in-memory switch has already happened.
    }
  }, []);

  const value = useMemo<AppearanceContextValue>(
    () => ({ mode, isDark, theme, setMode }),
    [mode, isDark, theme, setMode],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppAppearance must be used inside AppearanceProvider');
  return value;
}

/** The active theme. Identity is stable per mode. */
export function useTheme(): Theme {
  return useAppAppearance().theme;
}

/** Colours for the active theme — for inline props like an icon's `color`. */
export function useColors(): ColorTokens {
  return useAppAppearance().theme.colors;
}

/** The receipt material for the active theme. */
export function usePaper(): PaperTokens {
  return useAppAppearance().theme.paper;
}

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Theme-aware replacement for a module-level `StyleSheet.create`.
 *
 *   const useStyles = makeStyles((colors) => ({
 *     card: { backgroundColor: colors.surface },
 *   }));
 *
 * The factory takes `colors` and `elevation` as arguments with exactly the
 * names the old module-scope imports had, so converting a file is a wrap — the
 * style bodies themselves do not change. A third `isDark` argument covers the
 * cases a token cannot: translucent overlays like `rgba(255,255,255,0.95)`,
 * which are a fixed alpha over a blur rather than a semantic colour.
 *
 * One StyleSheet is built per theme and cached, so switching back and forth
 * does not reallocate and style identity stays stable across renders, which is
 * what keeps `React.memo` and RN's prop diffing working as they did before.
 */
export function makeStyles<T extends NamedStyles<T>>(
  factory: (colors: ColorTokens, elevation: ElevationTokens, isDark: boolean, paper: PaperTokens) => T,
): () => T {
  const cache = new WeakMap<Theme, T>();

  return function useStyles(): T {
    const theme = useTheme();
    let styles = cache.get(theme);
    if (!styles) {
      styles = StyleSheet.create(factory(theme.colors, theme.elevation, theme.isDark, theme.paper));
      cache.set(theme, styles);
    }
    return styles;
  };
}
