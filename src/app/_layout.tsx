import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
  InstrumentSans_600SemiBold_Italic,
} from '@expo-google-fonts/instrument-sans';
import { AuthProvider, useAuth } from '@/lib/auth/auth-context';
import { purgeAbandonedCaptures, retryPending } from '@/lib/receipts/capture';
import { syncFromServer } from '@/lib/receipts/server-sync';
import { countProviderDelayed } from '@/lib/receipts/store';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

/**
 * How often a foregrounded app looks for captures whose retry is due.
 *
 * retryPending() only dispatches rows whose own backoff has elapsed, so this is
 * a heartbeat rather than a retry interval — the cost of a tick with nothing to
 * do is one indexed read against the local store.
 */
const RETRY_TICK_MS = 20_000;
const PROVIDER_DELAY_POLL_MS = 2_500;

/** Pulls server-owned B5 jobs while they are visible to the signed-in user. */
function ProviderDelayPoller() {
  const auth = useAuth();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const stop = () => {
      if (!timer.current) return;
      clearInterval(timer.current);
      timer.current = null;
    };
    const pullIfNeeded = async () => {
      if (inFlight.current || !auth.user?.id) return;
      if ((await countProviderDelayed()) === 0) {
        stop();
        return;
      }
      inFlight.current = true;
      try {
        await syncFromServer(auth.user.id, auth.categories);
      } catch (error) {
        if (__DEV__) console.warn('[b5] pending receipt sync failed', error);
      } finally {
        inFlight.current = false;
      }
    };
    const start = () => {
      if (!auth.user?.id || timer.current) return;
      void pullIfNeeded();
      timer.current = setInterval(() => void pullIfNeeded(), PROVIDER_DELAY_POLL_MS);
    };
    const appState = AppState.addEventListener('change', (state) => (state === 'active' ? start() : stop()));
    if (AppState.currentState === 'active') start();
    return () => {
      appState.remove();
      stop();
    };
  }, [auth.categories, auth.user?.id]);

  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
    InstrumentSans_600SemiBold_Italic,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // A queued capture writes itself a retry time and used to have nothing to
  // honour it: the drain ran on the camera screen mounting, on the network
  // coming back, and 600ms after a capture. So a receipt throttled or failed
  // while the user then sat on Search stayed "waiting to retry" indefinitely —
  // the queue worked, nothing ever asked it to run.
  //
  // At the root, so it does not depend on which screen is open, and paused in
  // the background where the OS would kill the work anyway.
  const ticking = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const start = () => {
      if (ticking.current) return;
      void retryPending();
      // Blocked and failed captures keep their photo so the user can act on
      // them; this is what stops that becoming an unbounded pile. Once per
      // foreground, not per tick — nothing here changes in twenty seconds.
      void purgeAbandonedCaptures();
      ticking.current = setInterval(() => void retryPending(), RETRY_TICK_MS);
    };
    const stop = () => {
      if (!ticking.current) return;
      clearInterval(ticking.current);
      ticking.current = null;
    };

    if (AppState.currentState === 'active') start();
    // Coming back to the foreground is itself the most likely moment for a due
    // retry, so drain immediately rather than waiting out a first tick.
    const sub = AppState.addEventListener('change', (state) => (state === 'active' ? start() : stop()));
    return () => {
      sub.remove();
      stop();
    };
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ProviderDelayPoller />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          />
        </AuthProvider>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
