/**
 * Anonymous crash and event reporting.
 *
 * The constraint this file exists to satisfy: a support report has to be
 * actionable without ever identifying the person who sent it. Two incidents in
 * a row were unreportable — a TestFlight tester saw "IntegrityException:
 * undefined reason" and a first-install user landed back on the sign-in screen
 * with no alert at all — and in both cases the only thing that survived was a
 * row we happened to write server-side. Nothing carried the *client's* side of
 * the story, which is where both failures actually lived.
 *
 * So: a random installation id, generated locally, never derived from and never
 * joined to an account. It is not the Supabase user id, not a device id, and
 * not stable across reinstalls — deliberately. It identifies an installation of
 * the app, which is the unit a crash report is about, and nothing else.
 *
 * `setUserId` on both SDKs carries the SUPPORT CODE, not the full installation
 * id. Crashlytics user-id search is an exact match, and the six characters the
 * user reads out are a suffix of the uuid — searching for them would return
 * nothing, which would make the code on the About screen decorative. The full
 * id is kept alongside as a custom key, where uniqueness still matters but
 * hand-typing does not. Setting either to the account id would make the whole
 * file pointless.
 *
 * Every export here is safe to call before Firebase exists. The native module
 * is absent in Expo Go and in any build made before the Firebase config files
 * were added, and a monitoring layer that throws is strictly worse than no
 * monitoring layer, so every entry point degrades to a no-op.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';

import { getFoundationEnv } from '@/lib/foundations/env';
import { EVENT_NAME_RE, sanitizeMessage, sanitizeParams } from '@/lib/monitoring/sanitize';

export { sanitizeMessage } from '@/lib/monitoring/sanitize';

const INSTALL_ID_KEY = 'parse.monitoring.install-id.v1';

let installIdPromise: Promise<string> | null = null;
/**
 * Mirrors the resolved id synchronously. The error boundary renders the support
 * code during a crash, where there is no opportunity to await anything.
 */
let cachedInstallId: string | null = null;

/* -------------------------------------------------------------------------- */
/* Firebase access                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Resolved once and remembered, including the failure. `require` is used rather
 * than a static import so that a missing native module is a caught throw here
 * instead of a redbox at module-evaluation time, before any of our own error
 * handling is installed.
 */
type CrashlyticsModule = typeof import('@react-native-firebase/crashlytics');
type AnalyticsModule = typeof import('@react-native-firebase/analytics');

let crashlyticsModule: CrashlyticsModule | null | undefined;
let analyticsModule: AnalyticsModule | null | undefined;

function crashlyticsApi(): CrashlyticsModule | null {
  if (crashlyticsModule !== undefined) return crashlyticsModule;
  try {
    // Deliberate: a static import binds at module evaluation, which is before
    // any of our error handling exists, so a missing native module would be an
    // unhandled redbox instead of the caught null this whole file depends on.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    crashlyticsModule = require('@react-native-firebase/crashlytics') as CrashlyticsModule;
  } catch {
    crashlyticsModule = null;
  }
  return crashlyticsModule;
}

function analyticsApi(): AnalyticsModule | null {
  if (analyticsModule !== undefined) return analyticsModule;
  try {
    // Deliberate: a static import binds at module evaluation, which is before
    // any of our error handling exists, so a missing native module would be an
    // unhandled redbox instead of the caught null this whole file depends on.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    analyticsModule = require('@react-native-firebase/analytics') as AnalyticsModule;
  } catch {
    analyticsModule = null;
  }
  return analyticsModule;
}

/** True once Firebase is actually usable, for callers that want to branch. */
export function isMonitoringAvailable(): boolean {
  return crashlyticsApi() !== null;
}

/* -------------------------------------------------------------------------- */
/* Installation identity                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The anonymous installation id, created on first call and reused forever
 * after. Concurrent callers share one promise so two screens mounting at once
 * cannot generate two ids and race to store them.
 *
 * A storage failure yields a session-scoped id rather than throwing. The
 * support code is then useless across restarts, which is a far smaller problem
 * than a monitoring call that rejects inside someone's catch block.
 */
export function getInstallationId(): Promise<string> {
  if (installIdPromise) return installIdPromise;

  installIdPromise = (async () => {
    try {
      const stored = await AsyncStorage.getItem(INSTALL_ID_KEY);
      if (stored && stored.length >= 6) {
        cachedInstallId = stored;
        return stored;
      }
      const created = Crypto.randomUUID();
      await AsyncStorage.setItem(INSTALL_ID_KEY, created);
      cachedInstallId = created;
      return created;
    } catch {
      const fallback = cachedInstallId ?? Crypto.randomUUID();
      cachedInstallId = fallback;
      return fallback;
    }
  })();

  return installIdPromise;
}

/**
 * The six characters a user reads out to support. Uppercased because it is
 * transcribed by hand, from the end of the UUID because the first block of a
 * v4 UUID is the least random part of the string people tend to compare.
 */
export async function getAnonymousSupportCode(): Promise<string> {
  const id = await getInstallationId();
  return id.replace(/-/g, '').slice(-6).toUpperCase();
}

/**
 * The same code without awaiting, for render paths — specifically the error
 * boundary, which by definition runs when something has already gone wrong.
 * Returns null until `initMonitoring()` has resolved the id.
 */
export function getCachedSupportCode(): string | null {
  if (!cachedInstallId) return null;
  return cachedInstallId.replace(/-/g, '').slice(-6).toUpperCase();
}

/**
 * The support code for display. Starts null and fills in on the first tick,
 * which is why every caller renders a placeholder rather than an empty gap —
 * a code that pops in after the surrounding text has settled reads as a glitch.
 */
export function useAnonymousSupportCode(): string | null {
  const [code, setCode] = useState<string | null>(() => getCachedSupportCode());

  useEffect(() => {
    if (code) return;
    let alive = true;
    void getAnonymousSupportCode().then((next) => {
      if (alive) setCode(next);
    });
    return () => {
      alive = false;
    };
  }, [code]);

  return code;
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Records an error against the installation, with the sanitised message and a
 * `source` naming the call site.
 *
 * The original Error object is passed to Crashlytics for its stack trace, but
 * its message is replaced first: a stack is structural and safe, a message is
 * whatever the throwing library decided to interpolate into it.
 *
 * Never throws and never returns a rejected promise. Call sites are catch
 * blocks; a reporting failure there would replace the real error with a
 * meaningless one.
 */
export function logSafeError(error: unknown, source: string): void {
  const message = sanitizeMessage(error);
  const safeSource = sanitizeMessage(source);

  if (__DEV__) console.warn(`[${safeSource}] ${message}`);

  try {
    const api = crashlyticsApi();
    if (!api) return;
    const cx = api.getCrashlytics();

    // A new Error rather than the original: `recordError` reads `.message` off
    // the object it is handed, so mutating the caller's error would be the only
    // other way to redact it — and that error is often still in flight.
    const redacted = new Error(message);
    redacted.name = error instanceof Error ? error.name : 'NonError';
    if (error instanceof Error && typeof error.stack === 'string') {
      redacted.stack = sanitizeMessage(error.stack);
    }

    void api.setAttributes(cx, {
      source: safeSource,
      environment: getFoundationEnv().environment,
      platform: Platform.OS,
      app_version: Application.nativeApplicationVersion ?? 'unknown',
      build_number: Application.nativeBuildVersion ?? 'unknown',
    });
    api.recordError(cx, redacted, safeSource);
  } catch {
    /* Monitoring must never become the failure it is reporting. */
  }
}

/**
 * A breadcrumb on the Crashlytics timeline. These are what turn "it crashed"
 * into "it crashed after the OAuth callback landed twice", which is exactly the
 * distinction the last two incidents turned on.
 */
export function trackAnonymousBreadcrumb(message: string): void {
  const safe = sanitizeMessage(message);
  if (__DEV__) console.log(`[breadcrumb] ${safe}`);

  try {
    const api = crashlyticsApi();
    if (!api) return;
    api.log(api.getCrashlytics(), safe);
  } catch {
    /* ignored */
  }
}

/**
 * A custom Analytics event, tagged with the installation id so a funnel can be
 * followed across a session without an account behind it.
 *
 * An invalid event name is dropped rather than sent: Firebase rejects malformed
 * names silently server-side, which would leave a call site looking instrumented
 * when it is not.
 */
export function trackAnonymousEvent(eventName: string, params?: Record<string, unknown>): void {
  if (!EVENT_NAME_RE.test(eventName)) {
    if (__DEV__) console.warn(`[monitoring] dropped invalid event name: ${eventName}`);
    return;
  }

  try {
    const api = analyticsApi();
    if (!api) return;
    void api.logEvent(api.getAnalytics(), eventName, {
      ...sanitizeParams(params),
      install_id: cachedInstallId ?? 'pending',
      environment: getFoundationEnv().environment,
    });
  } catch {
    /* ignored */
  }
}

/* -------------------------------------------------------------------------- */
/* Global handlers                                                            */
/* -------------------------------------------------------------------------- */

type ErrorUtilsShape = {
  getGlobalHandler: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

let globalHandlerInstalled = false;
let rejectionTrackerInstalled = false;

/**
 * Routes otherwise-unhandled JS errors through `logSafeError` before handing
 * them back to React Native's own handler, which is what shows the redbox in
 * development and terminates in production. Chaining rather than replacing
 * matters: swallowing a fatal here would turn a visible crash into a frozen
 * screen, which is harder to report, not easier.
 */
export function installGlobalErrorHandler(): void {
  if (globalHandlerInstalled) return;

  const errorUtils = (globalThis as unknown as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;

  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    logSafeError(error, isFatal ? 'global.fatal' : 'global.nonfatal');
    previous?.(error, isFatal);
  });

  globalHandlerInstalled = true;
}

/**
 * Reports unhandled promise rejections.
 *
 * These do NOT reach `ErrorUtils`. React Native's rejection tracker calls
 * `ExceptionsManager.handleException` directly, and `ErrorUtils` is upstream of
 * ExceptionsManager rather than downstream — so a rejected promise bypasses the
 * global handler entirely. With 104 fire-and-forget `void fn()` calls in this
 * codebase, that is the single largest blind spot in the app: every one of them
 * fails silently today.
 *
 * Hermes owns the tracker (both platforms are Hermes here), so this re-registers
 * it rather than wrapping anything. React Native's own options are delegated to
 * afterwards so the dev-time redbox behaves exactly as before.
 */
export function installRejectionTracker(): void {
  if (rejectionTrackerInstalled) return;

  const enable = (globalThis as unknown as {
    HermesInternal?: { enablePromiseRejectionTracker?: (options: unknown) => void };
  }).HermesInternal?.enablePromiseRejectionTracker;
  if (typeof enable !== 'function') return;

  // A React Native internal path, so it is required defensively: losing the
  // dev-time redbox on an upgrade would be an annoyance, losing the reporting
  // would be the bug this function exists to fix.
  let defaults: { onUnhandled?: (id: number, rejection: unknown) => void; onHandled?: (id: number) => void } = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    defaults = require('react-native/Libraries/promiseRejectionTrackingOptions').default ?? {};
  } catch {
    /* report without the redbox */
  }

  try {
    enable({
      allRejections: true,
      onHandled: defaults.onHandled,
      onUnhandled: (id: number, rejection: unknown) => {
        logSafeError(rejection, 'global.unhandledRejection');
        defaults.onUnhandled?.(id, rejection);
      },
    });
    rejectionTrackerInstalled = true;
  } catch {
    /* ignored */
  }
}

/**
 * Bootstraps the installation id and stamps it onto both SDKs. Called once at
 * the root, and awaited by nothing — the id resolves in a few milliseconds and
 * every reporting function tolerates being called before it lands.
 */
export async function initMonitoring(): Promise<void> {
  installGlobalErrorHandler();
  installRejectionTracker();

  const installId = await getInstallationId();
  // What the user can actually read out of the About screen and quote to us.
  const supportCode = await getAnonymousSupportCode();

  try {
    const cx = crashlyticsApi();
    if (cx) {
      const instance = cx.getCrashlytics();
      await cx.setUserId(instance, supportCode);
      await cx.setAttributes(instance, {
        support_code: supportCode,
        install_id: installId,
        environment: getFoundationEnv().environment,
        platform: Platform.OS,
        app_version: Application.nativeApplicationVersion ?? 'unknown',
        build_number: Application.nativeBuildVersion ?? 'unknown',
      });
    }

    const an = analyticsApi();
    if (an) {
      const instance = an.getAnalytics();
      // Matching identifier on both SDKs, so a Crashlytics report and an
      // Analytics funnel can be lined up on the one value a user can give us.
      await an.setUserId(instance, supportCode);
    }
  } catch {
    /* ignored */
  }

  trackAnonymousBreadcrumb('app.launch');
}
