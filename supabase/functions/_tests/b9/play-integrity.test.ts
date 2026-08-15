// @ts-nocheck - Supabase Edge Function test under Deno.
import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { playIntegrityRequestHash, validatePlayIntegrityPayload, verifyPlayIntegrity } from '../../_shared/play-integrity.ts';

const config = {
  packageName: 'com.imranfarid.parse',
  allowedCertificateDigests: new Set(['trusted-certificate']),
  allowedVersionCodes: new Set(['42']),
  maxTokenAgeSeconds: 120,
  requireLicensed: true,
};

const payload = (requestHash: string, now: number) => ({
  requestDetails: {
    requestPackageName: config.packageName,
    requestHash,
    timestampMillis: String(now - 1_000),
  },
  accountDetails: { appLicensingVerdict: 'LICENSED' },
  appIntegrity: {
    appRecognitionVerdict: 'PLAY_RECOGNIZED',
    packageName: config.packageName,
    certificateSha256Digest: ['trusted-certificate'],
    versionCode: '42',
  },
  deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
});

Deno.test('Play Integrity request hashes are stable base64url SHA-256 values', async () => {
  const first = await playIntegrityRequestHash('referral_redeem:user:device:ABC234:code');
  const replay = await playIntegrityRequestHash('referral_redeem:user:device:ABC234:code');
  assertEquals(first, replay);
  assertMatch(first, /^[A-Za-z0-9_-]{43}$/);
});

Deno.test('Play Integrity accepts only a fresh bound recognized licensed build on a trusted device', async () => {
  const now = Date.now();
  const requestHash = await playIntegrityRequestHash('signup_integrity:user:device');
  assertEquals(validatePlayIntegrityPayload(payload(requestHash, now), requestHash, config, now), {
    valid: true,
    verdict: 'play_integrity_standard',
    riskSignals: {
      app_recognition: 'PLAY_RECOGNIZED',
      app_licensing: 'LICENSED',
      device_integrity: 'MEETS_DEVICE_INTEGRITY',
      version_code: '42',
    },
  });

  const cases = [
    ['play_integrity_request_hash_mismatch', payload('wrong-hash', now)],
    ['play_integrity_app_unrecognized', { ...payload(requestHash, now), appIntegrity: { ...payload(requestHash, now).appIntegrity, appRecognitionVerdict: 'UNRECOGNIZED_VERSION' } }],
    ['play_integrity_certificate_mismatch', { ...payload(requestHash, now), appIntegrity: { ...payload(requestHash, now).appIntegrity, certificateSha256Digest: ['other'] } }],
    ['play_integrity_version_not_allowed', { ...payload(requestHash, now), appIntegrity: { ...payload(requestHash, now).appIntegrity, versionCode: '43' } }],
    ['play_integrity_device_untrusted', { ...payload(requestHash, now), deviceIntegrity: { deviceRecognitionVerdict: [] } }],
    ['play_integrity_unlicensed', { ...payload(requestHash, now), accountDetails: { appLicensingVerdict: 'UNLICENSED' } }],
    ['play_integrity_token_stale', { ...payload(requestHash, now), requestDetails: { ...payload(requestHash, now).requestDetails, timestampMillis: String(now - 121_000) } }],
  ] as const;
  for (const [verdict, candidate] of cases) {
    assertEquals(validatePlayIntegrityPayload(candidate, requestHash, config, now).verdict, verdict);
  }
});

Deno.test('Play Integrity exchanges a signed service-account assertion and asks Google to decode the token', async () => {
  const keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const privateDer = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  let binary = '';
  for (const byte of privateDer) binary += String.fromCharCode(byte);
  const privateBody = btoa(binary).match(/.{1,64}/g)?.join('\n');
  const now = Date.now();
  const requestHash = await playIntegrityRequestHash('signup_integrity:user:device');
  Deno.env.set('PLAY_INTEGRITY_CONFIG', JSON.stringify({
    package_name: config.packageName,
    service_account: {
      client_email: 'verifier@example.iam.gserviceaccount.com',
      private_key: `-----BEGIN PRIVATE KEY-----\n${privateBody}\n-----END PRIVATE KEY-----\n`,
      token_uri: 'https://oauth.example/token',
    },
    decode_origin: 'https://play.example',
    allowed_certificate_sha256_digests: [...config.allowedCertificateDigests],
    allowed_version_codes: [...config.allowedVersionCodes],
    max_token_age_seconds: config.maxTokenAgeSeconds,
    require_licensed: true,
  }));

  const calls: string[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://oauth.example/token') {
      const form = new URLSearchParams(String(init?.body));
      assertEquals(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      assertEquals(form.get('assertion')?.split('.').length, 3);
      return Response.json({ access_token: 'google-access-token', expires_in: 3600 });
    }
    assertEquals(url, `https://play.example/v1/${config.packageName}:decodeIntegrityToken`);
    assertEquals(new Headers(init?.headers).get('Authorization'), 'Bearer google-access-token');
    assertEquals(JSON.parse(String(init?.body)), { integrity_token: 'opaque-integrity-token-value-long-enough' });
    return Response.json({ tokenPayloadExternal: payload(requestHash, now) });
  };

  try {
    const result = await verifyPlayIntegrity('opaque-integrity-token-value-long-enough', requestHash, { fetcher, now });
    assertEquals(result.valid, true);
    assertEquals(calls, ['https://oauth.example/token', `https://play.example/v1/${config.packageName}:decodeIntegrityToken`]);
  } finally {
    Deno.env.delete('PLAY_INTEGRITY_CONFIG');
  }
});
