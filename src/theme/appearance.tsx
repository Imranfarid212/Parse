import { Appearance } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type ThemeMode = 'light' | 'dark';
type AppearanceContextValue = { mode: ThemeMode; isDark: boolean; setMode: (mode: ThemeMode) => void };

const THEME_MODE_KEY = 'parse.theme-mode';
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

Appearance.setColorScheme('light');

function applyMode(mode: ThemeMode) {
  Appearance.setColorScheme(mode);
  void SystemUI.setBackgroundColorAsync(mode === 'dark' ? '#111215' : '#FBFBFD');
}

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [mode, setCurrentMode] = useState<ThemeMode>('light');

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(THEME_MODE_KEY).then((stored) => {
      if (!active || (stored !== 'light' && stored !== 'dark')) return;
      setCurrentMode(stored);
      applyMode(stored);
    });
    return () => { active = false; };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setCurrentMode(next);
    applyMode(next);
    void SecureStore.setItemAsync(THEME_MODE_KEY, next);
  }, []);

  const value = useMemo(() => ({ mode, isDark: mode === 'dark', setMode }), [mode, setMode]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppAppearance must be used inside AppearanceProvider');
  return value;
}
