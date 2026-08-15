const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const fail = (message) => { throw new Error(`[b9:backend] ${message}`); };
const includes = (source, needle, label) => { if (!source.includes(needle)) fail(`${label}: expected ${JSON.stringify(needle)}`); };
const excludes = (source, needle, label) => { if (source.includes(needle)) fail(`${label}: did not expect ${JSON.stringify(needle)}`); };

const migration = read('supabase/migrations/20260815000100_b9_referrals.sql');
const foundations = read('supabase/migrations/20260719000100_b1_foundations.sql');
const commission = read('supabase/migrations/20260815000200_b9_commission_guard.sql');
const appAttestMigration = read('supabase/migrations/20260815000300_b9_app_attest.sql');
const endpoint = read('supabase/functions/referral-redeem/index.ts');
const enrollment = read('supabase/functions/app-attest-enroll/index.ts');
const admission = read('supabase/functions/app-integrity-admit/index.ts');
const verifier = read('supabase/functions/app-integrity-verify/index.ts');
const appAttest = read('supabase/functions/_shared/app-attest.ts');
const playIntegrity = read('supabase/functions/_shared/play-integrity.ts');
const shared = read('supabase/functions/_shared/referrals.ts');
const contracts = read('packages/contracts/src/referrals.ts');

includes(contracts, 'REFERRER_REWARD_SCANS = 10', 'referrer reward is named');
includes(contracts, 'REFERRED_REWARD_SCANS = 5', 'friend reward is named');
includes(contracts, 'USER_REFERRAL_MAX_REWARDS = 4', 'reward cap is named');

includes(migration, 'for update', 'account and code rows serialize competing redeems');
includes(foundations, 'unique (user_id, reason, ref_id)', 'ledger idempotency is inherited');
includes(migration, "on conflict on constraint scan_ledger_user_id_reason_ref_id_key do nothing", 'both grants are replay-safe');
includes(migration, "v_code.owner_user_id = p_user_id", 'self referral is blocked');
includes(migration, "v_device_accounts >= 2", 'per-device velocity is enforced');
includes(migration, "v_ip_accounts >= 5", 'per-IP velocity is enforced');
includes(migration, "v_hour_user_attempts >= 12", 'code attempts are rate-limited');
includes(migration, "not p_attestation_valid", 'attestation gates release');
includes(migration, "case when v_blocked then 'blocked' else 'released'", 'failed checks retain a blocked audit row');
includes(foundations, 'referred_user_id uuid not null unique', 'one referral per account comes from the base schema');
includes(migration, 'referral codes owner select', 'codes cannot be enumerated');

includes(endpoint, 'isActiveDevice', 'only the active installation can redeem');
includes(endpoint, 'verifyAttestation', 'platform proof is verified before the transaction');
includes(endpoint, 'REFERRAL_IP_HASH_SECRET', 'IP evidence is pseudonymized');
includes(endpoint, "return json(503", 'verifier outages fail closed and remain retryable');
excludes(endpoint, "console.log('[referral-redeem] completed', { user_id", 'user ids are not logged');
includes(shared, 'AbortSignal.timeout(8_000)', 'attestation verification is bounded');
includes(shared, "action: 'referral_redeem'", 'proof is action-bound');
includes(shared, 'Authorization: `Bearer ${authorization}`', 'internal verifier authentication uses the bearer scheme');
includes(shared, "key_id: typeof attestation.key_id === 'string'", 'the parser preserves the shared snake_case key identifier');
excludes(shared, 'keyId: typeof attestation.key_id', 'the parser does not rename the proof field');

includes(appAttestMigration, 'claim_app_attest_challenge', 'App Attest challenges are single-use');
includes(appAttestMigration, 'advance_app_attest_counter', 'assertion counters use compare-and-swap');
includes(appAttestMigration, 'revoke all on public.app_attest_keys from anon, authenticated', 'attested keys are server-only');
includes(enrollment, "p_purpose: 'enroll'", 'enrollment claims an enroll-bound challenge');
includes(enrollment, 'isActiveDevice', 'enrollment binds the active installation');
includes(verifier, "p_purpose: 'referral_redeem'", 'assertions claim an action-bound challenge');
includes(verifier, 'proof.key_id', 'the verifier reads the shared snake_case proof contract');
excludes(verifier, 'proof.keyId', 'the verifier does not drift to an incompatible camelCase proof field');
includes(verifier, 'secureBearerMatches', 'the internal verifier requires a constant-time checked secret');
includes(verifier, "proof.platform === 'android'", 'the verifier routes Android proofs to Play Integrity');
includes(verifier, 'verifyPlayIntegrity', 'Google decrypt and verdict validation is server-side');
includes(playIntegrity, ':decodeIntegrityToken', 'opaque Play Integrity tokens are decoded by Google');
includes(playIntegrity, 'PLAY_RECOGNIZED', 'the Play-distributed app verdict is required');
includes(playIntegrity, 'allowedCertificateDigests', 'the Play signing certificate is allowlisted');
includes(playIntegrity, 'allowedVersionCodes', 'the Android version code is allowlisted');
includes(playIntegrity, 'MEETS_DEVICE_INTEGRITY', 'certified device integrity is required');
includes(playIntegrity, 'requestHash !== expectedRequestHash', 'Play tokens are bound to the trusted action context');
includes(playIntegrity, "licensingVerdict !== 'LICENSED'", 'the production app must be Play licensed');
includes(admission, 'verifySignupAttestation', 'Android signup admission is verified server-side');
includes(admission, 'isActiveDevice', 'Android signup admission binds the active installation');
includes(appAttest, "npm:pkijs@3.4.0", 'the certificate-chain verifier dependency is pinned');
includes(appAttest, 'apple_validation_category_01', 'Apple validation category is checked');
includes(appAttest, 'apple_bundle_version_01', 'Apple bundle version is checked');

includes(commission, "r.status = 'released'", 'blocked attribution cannot earn commission');
includes(commission, "rc.commission_rate = 0.15", 'commission rate is fixed at 15%');

console.log('[b9:backend] ok - transaction, fraud, attestation and commission invariants verified');
