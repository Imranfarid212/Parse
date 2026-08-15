// @ts-nocheck - Supabase Edge Functions run under Deno, outside the Expo app tsconfig.
/**
 * Sign in with Apple: token exchange and revocation.
 *
 * Apple requires an app that offers Sign in with Apple to revoke the user's
 * tokens when they delete their account. Revocation needs a refresh token, and a
 * refresh token only exists if we exchanged the one-time authorization code for
 * it at sign-in. The app previously used the identity token alone — enough to
 * authenticate, not enough to ever revoke — so the code is now captured at
 * sign-in and exchanged here.
 *
 * All four secrets (team id, client id, key id, private key) come from env and
 * never appear in source, in logs or in any response.
 */

const APPLE_AUTH_HOST = 'https://appleid.apple.com';

type AppleConfig = {
  teamId: string;
  clientId: string;
  keyId: string;
  privateKeyPem: string;
};

/**
 * Reads the Apple config, or null when it is not configured.
 *
 * Null is a legitimate state, not an error: Android-only builds and local
 * stacks have no Apple credentials, and deletion must still work there. The
 * caller reports `apple_revoked: false` rather than failing the deletion —
 * refusing to delete an account because an unrelated integration is unconfigured
 * would be the worse failure.
 */
export function readAppleConfig(): AppleConfig | null {
  const teamId = Deno.env.get('APPLE_SIWA_TEAM_ID');
  const clientId = Deno.env.get('APPLE_SIWA_CLIENT_ID');
  const keyId = Deno.env.get('APPLE_SIWA_KEY_ID');
  const privateKeyPem = Deno.env.get('APPLE_SIWA_PRIVATE_KEY');
  if (!teamId || !clientId || !keyId || !privateKeyPem) return null;
  return { teamId, clientId, keyId, privateKeyPem };
}

const base64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const encodeSegment = (value: unknown): string => base64url(new TextEncoder().encode(JSON.stringify(value)));

/**
 * Imports the .p8 signing key.
 *
 * The env var may carry real newlines or the literal two-character sequence
 * `\n` — the latter is what happens when a PEM is pasted into a dashboard field
 * or a CI secret. Both are accepted, because the failure mode of not accepting
 * them is an opaque "invalid key" at deletion time.
 */
async function importSigningKey(pem: string): Promise<CryptoKey> {
  const normalized = pem.replace(/\\n/g, '\n').trim();
  const body = normalized
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/**
 * Builds the ES256 client secret Apple requires in place of a static secret.
 *
 * WebCrypto's ECDSA output is already the raw r||s pair that JWS ES256 expects,
 * so no DER unwrapping is needed — a detail worth stating, because the usual bug
 * here is signing correctly and then encoding a DER blob Apple rejects.
 *
 * Six months is Apple's maximum lifetime; this token is minted per call and
 * never stored, so a short life costs nothing.
 */
export async function makeClientSecret(config: AppleConfig, now = Date.now()): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const header = { alg: 'ES256', kid: config.keyId, typ: 'JWT' };
  const claims = {
    iss: config.teamId,
    iat: issuedAt,
    exp: issuedAt + 300,
    aud: APPLE_AUTH_HOST,
    sub: config.clientId,
  };
  const signingInput = `${encodeSegment(header)}.${encodeSegment(claims)}`;
  const key = await importSigningKey(config.privateKeyPem);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

/**
 * Exchanges the one-time authorization code for a refresh token.
 *
 * The code is single-use and expires in five minutes, so this runs immediately
 * after sign-in. Returning null rather than throwing on Apple's rejection is
 * deliberate: a failed exchange must not fail the sign-in the user just
 * completed. It costs the ability to revoke later, which is logged.
 */
export async function exchangeAuthorizationCode(
  config: AppleConfig,
  authorizationCode: string,
): Promise<string | null> {
  const clientSecret = await makeClientSecret(config);
  const response = await fetch(`${APPLE_AUTH_HOST}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    // Apple's error body names the reason but never contains user data.
    const detail = await response.text().catch(() => '');
    console.warn('[apple] code exchange refused', { status: response.status, detail: detail.slice(0, 200) });
    return null;
  }

  const body = await response.json().catch(() => null);
  const refreshToken = body?.refresh_token;
  return typeof refreshToken === 'string' && refreshToken.length > 0 ? refreshToken : null;
}

/**
 * Revokes a refresh token. Apple answers 200 with an empty body on success.
 *
 * An already-revoked or expired token is reported by Apple as an error, and that
 * is treated as success: the desired end state — Apple holds no live token for
 * this user — is reached either way, and failing the deletion over it would
 * strand the account.
 */
export async function revokeRefreshToken(config: AppleConfig, refreshToken: string): Promise<boolean> {
  const clientSecret = await makeClientSecret(config);
  const response = await fetch(`${APPLE_AUTH_HOST}/auth/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: clientSecret,
      token: refreshToken,
      token_type_hint: 'refresh_token',
    }),
  });

  if (response.ok) return true;

  const detail = await response.text().catch(() => '');
  const alreadyGone = detail.includes('invalid_grant') || detail.includes('invalid_token');
  if (!alreadyGone) {
    console.warn('[apple] revoke failed', { status: response.status, detail: detail.slice(0, 200) });
  }
  return alreadyGone;
}
