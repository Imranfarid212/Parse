import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether Precise still explains itself before handing the camera back.
 *
 * The notice earns its first showing: Precise finishes in the background, so a
 * user who does not know that reads the live camera as "nothing happened". It
 * stops earning it after that, when it becomes a modal sitting between the
 * shutter and the next shot — which is what makes it feel redundant to someone
 * scanning a stack of receipts.
 *
 * Device-wide rather than per-account, unlike the referral prompt next door in
 * auth/: that one is account state, this is a statement about how much
 * explaining this person wants on this phone. It also has to answer for a
 * capture taken before auth has resolved, where there is no user id to key on.
 */
const KEY = 'receiptflow.precise_upfront_notice_suppressed';

/**
 * Cached so the shutter path can decide without awaiting storage.
 *
 * `null` means "not read yet", which callers treat as "show the notice".
 * Showing it once more than asked is a smaller failure than swallowing the
 * only explanation the user gets for a camera that appears to have done
 * nothing.
 */
let cached: boolean | null = null;

/** Reads the stored choice once per process, then serves it from memory. */
export async function loadPreciseNoticeSuppressed(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    cached = (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    // monitoring-ignore: a storage failure must not cost the user their
    // camera, and must not silently hide the notice either — falling to false
    // keeps the explanation. There is nothing to report: the only consequence
    // is that a preference read defaulted.
    cached = false;
  }
  return cached;
}

/** True only once the stored choice has been read and said to suppress. */
export function isPreciseNoticeSuppressed(): boolean {
  return cached === true;
}

export async function suppressPreciseNotice(): Promise<void> {
  // Set before the write so the choice holds for this session even if storage
  // refuses it; it then simply does not survive a restart.
  cached = true;
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // monitoring-ignore: the user asked for less interruption, so failing to
    // remember that is not worth an interruption of its own. The in-memory
    // flag above already honours the choice for this session.
  }
}
