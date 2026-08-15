// @ts-nocheck - Supabase Edge Function test under Deno.
import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { randomChallenge, secureBearerMatches, sha256Hex } from '../../_shared/app-attest-utils.ts';
import { decodeAppleAttestationExtensions } from '../../_shared/app-attest.ts';

Deno.test('App Attest challenges are random base64url values with stable hashes', async () => {
  const first = randomChallenge();
  const second = randomChallenge();
  assertMatch(first, /^[A-Za-z0-9_-]{43}$/);
  assertEquals(first === second, false);
  assertMatch(await sha256Hex(first), /^[a-f0-9]{64}$/);
  assertEquals(await sha256Hex(first), await sha256Hex(first));
});

Deno.test('internal verifier bearer matching fails closed', async () => {
  const secret = 's'.repeat(48);
  assertEquals(await secureBearerMatches(`Bearer ${secret}`, secret), true);
  assertEquals(await secureBearerMatches(`Bearer ${'x'.repeat(48)}`, secret), false);
  assertEquals(await secureBearerMatches(null, secret), false);
  assertEquals(await secureBearerMatches(`Bearer ${secret}`, 'short'), false);
});

Deno.test('Apple validation-guide authData decodes extensions without the ED flag', () => {
  const composite = Uint8Array.from(atob(
    '9EZtaPketsEGIMt+Y8coMkRoXuHWRntUFg51MXIFfwNAAAAAAGFwcGF0dGVzdAAAAAAAAAAAIM4EmPWEg/u02g17LGOlpTj1UtSty5pPqRYZXElhPmVdpQECAyYgASFYIEMyVErPMj23dEQ8qvM59W5+lcck+sLBQlnzZeJEVlCyIlggtfsoW89Um8tgWUQS52gqJCfuran7Ut/tCxqxftCfqb2id2FwcGxlX2J1bmRsZV92ZXJzaW9uXzAxYTF4HGFwcGxlX3ZhbGlkYXRpb25fY2F0ZWdvcnlfMDFEAQAAAGV4YW1wbGVfc2VydmVyX2NoYWxsZW5nZQ==',
  ), (character) => character.charCodeAt(0));
  const challengeLength = new TextEncoder().encode('example_server_challenge').length;
  const authData = composite.subarray(0, composite.length - challengeLength);
  if (authData[32] !== 0x40) throw new Error('Apple sample flags changed');
  const extensions = decodeAppleAttestationExtensions(authData);
  if (!extensions.extensionsPresent || extensions.validationCategory !== 1 || extensions.bundleVersion !== '1') {
    throw new Error(`Unexpected Apple sample extensions: ${JSON.stringify(extensions)}`);
  }

  // The same standard attested-credential structure without the iOS 26
  // extension dictionary remains a valid legacy App Attest payload.
  const legacyAuthData = authData.subarray(0, 164);
  const legacy = decodeAppleAttestationExtensions(legacyAuthData);
  if (legacy.extensionsPresent || legacy.validationCategory !== null || legacy.bundleVersion !== null) {
    throw new Error(`Unexpected legacy extension evidence: ${JSON.stringify(legacy)}`);
  }
});
