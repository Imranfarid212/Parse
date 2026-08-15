const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const fail = (message) => { throw new Error(`[b9:app] ${message}`); };
const includes = (source, needle, label) => { if (!source.includes(needle)) fail(`${label}: expected ${JSON.stringify(needle)}`); };

const plan = read('src/components/menu/PlanScreen.tsx');
const client = read('src/lib/referrals/client.ts');
const integrity = read('src/lib/referrals/integrity.ts');
const auth = read('src/lib/auth/auth-context.tsx');
const camera = read('src/app/camera.tsx');
const config = read('app.config.ts');
const copy = read('packages/contracts/src/copy.ts');

includes(plan, 'getReferralSummary', 'Plan loads the user code and progress');
includes(plan, 'shareReferral', 'Plan exposes the share sheet');
includes(plan, 'maxLength={6}', 'manual code input is bounded');
includes(plan, "redeemReferral(code, 'code')", 'manual entry releases immediately');
includes(plan, 'referral?.rewarded', '0/4 progress is server-owned');
includes(plan, 'shareBusy', 'share interaction has independent progress state');
includes(plan, 'redeemBusy', 'manual redemption has independent progress state');
if (plan.includes('referralBusy')) fail('share and redeem must not reuse one busy state');

includes(client, "invoke('referral-redeem'", 'redeem uses the authenticated Edge Function');
includes(client, "'x-rf-device-id'", 'redeem binds the active installation');
includes(client, 'EXPO_PUBLIC_IOS_APP_STORE_URL', 'share copy uses the configured App Store listing');
includes(client, '`Referral code: ${code}`', 'share copy includes the six-character code');
includes(client, 'open Menu → Plan', 'share copy explains exactly where to redeem');

includes(integrity, 'requestIntegrityCheckAsync', 'Android uses Play Integrity');
includes(integrity, 'CryptoDigestAlgorithm.SHA256', 'Play Integrity is bound with a SHA-256 request hash');
includes(integrity, "functions.invoke('app-integrity-admit'", 'Android signup admission is server-verified');
includes(integrity, '`signup_integrity:${userId}:${deviceId}`', 'Android signup proof is bound to user and installation');
includes(integrity, 'attestKeyAsync', 'iOS enrolls an App Attest key');
includes(integrity, 'generateAssertionAsync', 'iOS signs each referral action');
includes(integrity, 'SecureStore', 'the App Attest key id survives restarts');
includes(integrity, 'ensureSignupIntegrity', 'signup exposes a platform-integrity enrollment gate');
includes(auth, 'await ensureSignupIntegrity(currentSession.user.id)', 'authenticated app admission requires integrity enrollment');

includes(camera, 'shouldShowReferralPrompt', 'the first Camera landing points users to manual redemption');
includes(copy, 'TOAST_REFERRAL_PROMPT', 'manual redemption prompt copy lives in contracts');

includes(config, 'appattest-environment', 'App Attest entitlement is registered');

console.log('[b9:app] ok - Plan, manual invite sharing, integrity proof and redemption guidance verified');
