// @ts-nocheck - shared by Supabase Edge Functions under Deno.

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomChallenge() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function secureBearerMatches(header: string | null, expected: string) {
  if (!header?.startsWith('Bearer ') || expected.length < 32) return false;
  const supplied = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(header.slice(7)));
  const wanted = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected));
  const a = new Uint8Array(supplied);
  const b = new Uint8Array(wanted);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}
