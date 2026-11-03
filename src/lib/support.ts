/**
 * Support contact — the one address the app hands out, and the diagnostics that
 * make a report actionable.
 *
 * Single source so the Settings row and the About screen never drift onto
 * different addresses; replies fragmenting across two inboxes on a two-person
 * team is exactly the failure this prevents.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';

import { getFoundationEnv } from '@/lib/foundations/env';
import { getCachedSupportCode } from '@/lib/monitoring';

export const SUPPORT_EMAIL = 'support@parseai.app';

const SUPPORT_SUBJECT = 'Parse support';

/**
 * A mailto whose body already carries what a report is useless without: build,
 * device, OS, environment, and the user id needed to find the account. The
 * user's own words go above the rule — the prompt says so, because an email
 * that opens on a wall of diagnostics reads as "already handled" and people
 * send it without typing anything.
 *
 * Only the id is included, never the email address or any receipt content: the
 * id is enough to locate the account, and a support mail is not a place to
 * restate a user's data back at them.
 *
 * The support code is what makes the mail joinable to a crash report: it is the
 * Crashlytics user id, so pasting it into user-id search returns this install's
 * sessions. Without it the reader has to transcribe it out of Settings by hand,
 * which is the step that does not happen. It matters most for a signed-out
 * report, where the account id is absent and the code is the only handle on the
 * install that exists.
 *
 * Read from the cache rather than awaited, because a mailto is built in a press
 * handler. `initMonitoring` resolves the id within milliseconds of launch, so a
 * miss here means the app crashed during startup -- and the crash screen prints
 * the code itself in that case.
 */
export function buildSupportMailto(userId?: string | null): string {
  const env = getFoundationEnv();
  const parts = [
    `App ${Constants.expoConfig?.version ?? 'unknown'}`,
    Device.modelName ?? Platform.OS,
    `${Platform.OS} ${Device.osVersion ?? Platform.Version}`,
    env.environment,
    userId ? `user ${userId}` : 'signed out',
  ];

  const supportCode = getCachedSupportCode();
  if (supportCode) parts.push(`code ${supportCode}`);

  const body = [
    'Please describe what happened above this line.',
    '',
    '',
    '---',
    parts.join(' · '),
  ].join('\n');

  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(SUPPORT_SUBJECT)}&body=${encodeURIComponent(body)}`;
}
