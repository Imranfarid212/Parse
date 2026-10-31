import * as SecureStore from 'expo-secure-store';

const DEVICE_ID_KEY = 'receiptflow.installation-id.v1';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Keeps the id out of backups, which is what makes single-device takeover work.
 *
 * SecureStore's default is `WHEN_UNLOCKED`, and the non-`THIS_DEVICE_ONLY`
 * classes are restored onto a *new* phone along with the rest of an iCloud or
 * device-to-device backup. A restored phone therefore came up carrying the old
 * phone's installation id, and `claim_user_device` only prompts when the
 * claiming id differs from the active one -- so it took the identical id,
 * returned `active`, and left both phones signed in at once with no takeover
 * prompt on either. Nothing server-side could tell them apart.
 *
 * With `THIS_DEVICE_ONLY` the restored phone finds an empty slot, mints an id of
 * its own, and the existing takeover flow sees two different devices and asks.
 *
 * Lock-state behaviour is deliberately unchanged: both this and the previous
 * default are readable only while the device is unlocked, and nothing here runs
 * in a background task, so no caller loses access. iOS-only option; Android
 * ignores it.
 */
const DEVICE_ID_WRITE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

let inFlight: Promise<string> | null = null;

function newDeviceId(): string {
  const bytes = new Uint8Array(16);
  // The ID is an opaque installation label, not an authenticator; the user JWT
  // remains the security boundary. Older native runtimes can lack Web Crypto
  // before the JS bridge is fully ready, so a fallback must not strand login.
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * An opaque identifier for this app installation, never a hardware identifier.
 * It lives in SecureStore so a normal app restart cannot accidentally create a
 * second active device for the same phone.
 *
 * An id that is already present is returned untouched. Rewriting it to pick up
 * `DEVICE_ID_WRITE_OPTIONS` would not work anyway: `SecItemAdd` is the only
 * call that applies `kSecAttrAccessible`, and expo's duplicate-item fallback is
 * a `SecItemUpdate` carrying `kSecValueData` alone, so an existing entry keeps
 * whatever class it was created with. Changing it would mean deleting the entry
 * first, and a process death between the delete and the write would lose the id
 * and bill the user a takeover prompt for having done nothing. Installs made
 * before this change keep migrating via backup; every new install does not.
 */
export function getDeviceId(): Promise<string> {
  if (inFlight) return inFlight;
  const pending = (async () => {
    const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (existing && UUID_V4.test(existing)) return existing;

    const deviceId = newDeviceId();
    // Whatever is stored now failed the UUID check, so dropping it costs
    // nothing -- and it is what lets the write below land as a `SecItemAdd`
    // rather than the update that would silently keep the old accessibility
    // class. Deleting an absent key is a no-op.
    await SecureStore.deleteItemAsync(DEVICE_ID_KEY);
    await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId, DEVICE_ID_WRITE_OPTIONS);
    return deviceId;
  })();
  // A rejected promise must not be memoised. Every caller is a request path
  // (extract, confirm, metrics, device claim, attestation), so caching one
  // transient Keychain failure would strand all of them for the life of the
  // process; releasing it lets the next call try again.
  inFlight = pending;
  pending.catch(() => {
    if (inFlight === pending) inFlight = null;
  });
  return pending;
}
