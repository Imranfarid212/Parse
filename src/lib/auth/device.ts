import * as SecureStore from 'expo-secure-store';

const DEVICE_ID_KEY = 'receiptflow.installation-id.v1';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
 */
export function getDeviceId(): Promise<string> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (existing && UUID_V4.test(existing)) return existing;

    const deviceId = newDeviceId();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
    return deviceId;
  })();
  return inFlight;
}
