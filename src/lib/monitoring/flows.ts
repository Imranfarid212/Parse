/**
 * Outcome watchdogs.
 *
 * Every other piece of instrumentation in this folder reports a failure that
 * announced itself. This one reports failures that did not.
 *
 * The problem it solves: you cannot enumerate the ways a flow can break, so
 * instrumenting failure points only ever covers the breakages someone already
 * thought of. You CAN enumerate what success looks like. So a flow declares its
 * expected ending, and not arriving at one before the deadline is itself the
 * report — which catches causes nobody predicted, because it never needs to
 * know the cause. The sign-in incident that motivated this folder would have
 * fired one of these without anyone knowing what PKCE is.
 *
 * Two things a naive implementation gets wrong, both of which produce noise
 * rather than signal:
 *
 *   Backgrounding. A user who starts sign-in and switches apps has not stalled.
 *   Wall-clock deadlines report every one of them, so the deadline here counts
 *   foreground time only and is extended by whatever was spent suspended.
 *
 *   Volume. One non-fatal per slow flow will exhaust a Crashlytics quota on a
 *   bad network day, so each flow name reports a bounded number of times per
 *   app session and says nothing after that.
 */
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { logSafeError, trackAnonymousBreadcrumb } from '@/lib/monitoring';

/** Long enough that a slow network is not a stall. */
const DEFAULT_TIMEOUT_MS = 45_000;
/** Per flow name, per app session. */
const MAX_REPORTS_PER_FLOW = 3;

const reportCounts = new Map<string, number>();
/** One in-flight flow per name; starting another supersedes it. */
const inFlight = new Map<string, FlowHandle>();

export type Flow = {
  /** The expected ending. Reports nothing. */
  succeed: () => void;
  /**
   * A known, handled ending — a real user cancellation, a surfaced error. Reports
   * nothing: the caller has already dealt with it, and a second record of the
   * same event is how a signal becomes noise.
   */
  fail: (reason: string) => void;
  /** Stop watching without a verdict, for a component unmounting legitimately. */
  cancel: () => void;
};

type FlowHandle = Flow & { dispose: () => void };

function shouldReport(name: string): boolean {
  const seen = reportCounts.get(name) ?? 0;
  if (seen >= MAX_REPORTS_PER_FLOW) return false;
  reportCounts.set(name, seen + 1);
  return true;
}

/**
 * Starts watching for `name` to reach an ending.
 *
 * Returns a handle whose methods are all idempotent — a flow that succeeds and
 * is then cancelled by an unmounting effect must not report, and a caller
 * should never have to reason about which of those happens first.
 */
export function beginFlow(name: string, options?: { timeoutMs?: number }): Flow {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // A second attempt supersedes the first rather than racing it: a user who
  // retries sign-in has abandoned the previous attempt, not stalled in it.
  inFlight.get(name)?.dispose();

  const startedAt = Date.now();
  let suspendedMs = 0;
  let suspendedAt: number | null = AppState.currentState === 'active' ? null : Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  trackAnonymousBreadcrumb(`flow.begin ${name}`);

  const foregroundElapsed = () => {
    const suspendedNow = suspendedAt === null ? 0 : Date.now() - suspendedAt;
    return Date.now() - startedAt - suspendedMs - suspendedNow;
  };

  const dispose = () => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    timer = null;
    subscription.remove();
    if (inFlight.get(name) === handle) inFlight.delete(name);
  };

  const onDeadline = () => {
    // The deadline is measured in foreground time, so a timer that fires after a
    // spell in the background has not actually run out — it reschedules for
    // whatever is left.
    const remaining = timeoutMs - foregroundElapsed();
    if (remaining > 0) {
      timer = setTimeout(onDeadline, remaining);
      return;
    }
    const stalledFor = Math.round(foregroundElapsed() / 1000);
    dispose();
    if (!shouldReport(name)) return;
    logSafeError(
      new Error(`Flow "${name}" reached no outcome after ${stalledFor}s in the foreground`),
      `flow.stalled.${name}`,
    );
  };

  const onAppState = (state: AppStateStatus) => {
    if (state === 'active') {
      if (suspendedAt !== null) {
        suspendedMs += Date.now() - suspendedAt;
        suspendedAt = null;
      }
      return;
    }
    if (suspendedAt === null) suspendedAt = Date.now();
  };

  const subscription = AppState.addEventListener('change', onAppState);
  timer = setTimeout(onDeadline, timeoutMs);

  const handle: FlowHandle = {
    succeed: () => {
      if (settled) return;
      trackAnonymousBreadcrumb(`flow.succeed ${name} ${Math.round(foregroundElapsed() / 1000)}s`);
      dispose();
    },
    fail: (reason: string) => {
      if (settled) return;
      trackAnonymousBreadcrumb(`flow.fail ${name} ${reason}`);
      dispose();
    },
    cancel: dispose,
    dispose,
  };

  inFlight.set(name, handle);
  return handle;
}

/**
 * Reports a state that should never persist.
 *
 * The generalisation of the two silent branches this folder was written for:
 * rather than naming a flow, name a condition that is legitimate for a moment
 * and pathological for a minute — a spinner still spinning, a session with no
 * profile, a device stuck "checking". Anything that leaves the app inert
 * without raising is visible here even though nobody enumerated the cause.
 *
 * Implemented on top of `beginFlow` so it inherits the two properties that make
 * the difference between signal and noise: the deadline counts foreground time
 * only, and each condition reports a bounded number of times per session.
 */
export function useStateInvariant(name: string, violated: boolean, afterMs = 15_000): void {
  useEffect(() => {
    if (!violated) return;
    const flow = beginFlow(`invariant.${name}`, { timeoutMs: afterMs });
    // Clearing the condition IS the expected outcome, so a state that resolves
    // in time reports nothing and one that never resolves reports itself.
    return () => flow.succeed();
  }, [name, violated, afterMs]);
}

/** Test seam: session counters are process-global by design. */
export function resetFlowStateForTests(): void {
  for (const handle of inFlight.values()) handle.dispose();
  inFlight.clear();
  reportCounts.clear();
}
