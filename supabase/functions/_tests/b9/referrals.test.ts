// @ts-nocheck - Supabase Edge Function test under Deno.
import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { hashIp, normalizeReferralCode, parseReferralRequest } from '../../_shared/referrals.ts';

Deno.test('referral codes are uppercase and exclude ambiguous characters', () => {
  assertEquals(normalizeReferralCode(' ab2cd3 '), 'AB2CD3');
  for (const invalid of ['AB0CD3', 'AB1CD3', 'ABOCD3', 'ABICD3', 'SHORT', 'TOO-LONG']) {
    assertEquals(normalizeReferralCode(invalid), null, invalid);
  }
});

Deno.test('request validation requires entry method and an opaque platform proof', () => {
  const valid = parseReferralRequest({
    code: 'ab2cd3',
    entry_method: 'link',
    attestation: { platform: 'ios', token: 'a'.repeat(64), key_id: 'key-1', challenge: 'c'.repeat(32) },
  });
  assertEquals('request' in valid, true);
  if ('request' in valid) {
    assertEquals(valid.request.code, 'AB2CD3');
    assertEquals(valid.request.entryMethod, 'link');
    assertEquals(valid.request.attestation.key_id, 'key-1');
    assertEquals(valid.request.attestation.challenge, 'c'.repeat(32));
  }

  for (const invalid of [
    { code: 'AB2CD3', entry_method: 'later', attestation: { platform: 'ios', token: 'a'.repeat(64) } },
    { code: 'AB2CD3', entry_method: 'code', attestation: { platform: 'web', token: 'a'.repeat(64) } },
    { code: 'AB2CD3', entry_method: 'code', attestation: { platform: 'android', token: 'short' } },
  ]) assertEquals('error' in parseReferralRequest(invalid), true);
});

Deno.test('IP evidence is deterministic, secret-bound and never stores the IP', async () => {
  const first = await hashIp('203.0.113.9', 'secret-a');
  const replay = await hashIp('203.0.113.9', 'secret-a');
  const otherSecret = await hashIp('203.0.113.9', 'secret-b');
  assertEquals(first, replay);
  assertEquals(first === otherSecret, false);
  assertMatch(first, /^[a-f0-9]{64}$/);
  assertEquals(first.includes('203.0.113.9'), false);
});
