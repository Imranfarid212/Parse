// @ts-nocheck - shared by Supabase Edge Functions under Deno.

const encoder = new TextEncoder();
const PLAY_INTEGRITY_SCOPE = 'https://www.googleapis.com/auth/playintegrity';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const DEFAULT_DECODE_ORIGIN = 'https://playintegrity.googleapis.com';

type PlayIntegrityConfig = {
  packageName: string;
  serviceAccountEmail: string;
  serviceAccountPrivateKey: string;
  tokenUri: string;
  decodeOrigin: string;
  allowedCertificateDigests: Set<string>;
  allowedVersionCodes: Set<string>;
  maxTokenAgeSeconds: number;
  requireLicensed: boolean;
};

type PlayIntegrityPayload = {
  requestDetails?: {
    requestPackageName?: unknown;
    requestHash?: unknown;
    timestampMillis?: unknown;
  };
  accountDetails?: { appLicensingVerdict?: unknown };
  appIntegrity?: {
    appRecognitionVerdict?: unknown;
    packageName?: unknown;
    certificateSha256Digest?: unknown;
    versionCode?: unknown;
  };
  deviceIntegrity?: { deviceRecognitionVerdict?: unknown };
};

export type PlayIntegrityResult = {
  valid: boolean;
  verdict: string;
  riskSignals: Record<string, unknown>;
};

let cachedAccessToken: { email: string; value: string; expiresAt: number } | null = null;

const base64Url = (value: Uint8Array | string) => {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const decodeBase64 = (value: string) => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const requiredString = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is not configured`);
  return value.trim();
};

const stringSet = (value: unknown, label: string) => {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} is not configured`);
  }
  return new Set(value.map((item) => item.trim()));
};

export function readPlayIntegrityConfig(): PlayIntegrityConfig {
  const raw = Deno.env.get('PLAY_INTEGRITY_CONFIG')?.trim();
  if (!raw) throw new Error('PLAY_INTEGRITY_CONFIG is not configured');
  let parsed: Record<string, unknown>;
  try {
    const json = raw.startsWith('{') ? raw : new TextDecoder().decode(decodeBase64(raw));
    parsed = JSON.parse(json);
  } catch {
    throw new Error('PLAY_INTEGRITY_CONFIG is invalid');
  }
  const serviceAccount = parsed.service_account as Record<string, unknown> | null;
  const configuredAge = Number(parsed.max_token_age_seconds ?? 120);
  if (!Number.isFinite(configuredAge) || configuredAge < 30 || configuredAge > 600) {
    throw new Error('PLAY_INTEGRITY_CONFIG max_token_age_seconds is invalid');
  }
  return {
    packageName: requiredString(parsed.package_name, 'Play Integrity package_name'),
    serviceAccountEmail: requiredString(serviceAccount?.client_email, 'Play Integrity service account email'),
    serviceAccountPrivateKey: requiredString(serviceAccount?.private_key, 'Play Integrity service account private key'),
    tokenUri: typeof serviceAccount?.token_uri === 'string' && serviceAccount.token_uri.trim()
      ? serviceAccount.token_uri.trim()
      : DEFAULT_TOKEN_URI,
    decodeOrigin: typeof parsed.decode_origin === 'string' && parsed.decode_origin.trim()
      ? parsed.decode_origin.trim().replace(/\/$/, '')
      : DEFAULT_DECODE_ORIGIN,
    allowedCertificateDigests: stringSet(parsed.allowed_certificate_sha256_digests, 'Play Integrity certificate digests'),
    allowedVersionCodes: stringSet(parsed.allowed_version_codes, 'Play Integrity version codes'),
    maxTokenAgeSeconds: configuredAge,
    requireLicensed: parsed.require_licensed !== false,
  };
}

export async function playIntegrityRequestHash(requestContext: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(requestContext)));
  return base64Url(digest);
}

const privateKeyBytes = (pem: string) => decodeBase64(
  pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ''),
);

async function serviceAccountAssertion(config: PlayIntegrityConfig, nowSeconds: number) {
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: config.serviceAccountEmail,
    scope: PLAY_INTEGRITY_SCOPE,
    aud: config.tokenUri,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes(config.serviceAccountPrivateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned)));
  return `${unsigned}.${base64Url(signature)}`;
}

async function googleAccessToken(config: PlayIntegrityConfig, fetcher: typeof fetch) {
  const now = Date.now();
  if (cachedAccessToken?.email === config.serviceAccountEmail && cachedAccessToken.expiresAt > now + 60_000) {
    return cachedAccessToken.value;
  }
  const assertion = await serviceAccountAssertion(config, Math.floor(now / 1000));
  const response = await fetcher(config.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.access_token !== 'string') {
    throw new Error(`Play Integrity OAuth returned ${response.status}`);
  }
  const expiresIn = Math.max(60, Math.min(3600, Number(payload.expires_in) || 3600));
  cachedAccessToken = { email: config.serviceAccountEmail, value: payload.access_token, expiresAt: now + expiresIn * 1000 };
  return payload.access_token;
}

const rejected = (verdict: string, riskSignals: Record<string, unknown> = {}): PlayIntegrityResult => ({
  valid: false,
  verdict,
  riskSignals,
});

export function validatePlayIntegrityPayload(
  payload: PlayIntegrityPayload,
  expectedRequestHash: string,
  config: Pick<PlayIntegrityConfig, 'packageName' | 'allowedCertificateDigests' | 'allowedVersionCodes' | 'maxTokenAgeSeconds' | 'requireLicensed'>,
  now = Date.now(),
): PlayIntegrityResult {
  const request = payload?.requestDetails;
  const timestamp = Number(request?.timestampMillis);
  if (request?.requestPackageName !== config.packageName) return rejected('play_integrity_request_package_mismatch');
  if (request?.requestHash !== expectedRequestHash) return rejected('play_integrity_request_hash_mismatch');
  if (!Number.isFinite(timestamp) || timestamp > now + 30_000 || now - timestamp > config.maxTokenAgeSeconds * 1000) {
    return rejected('play_integrity_token_stale');
  }

  const app = payload?.appIntegrity;
  if (app?.appRecognitionVerdict !== 'PLAY_RECOGNIZED') return rejected('play_integrity_app_unrecognized');
  if (app?.packageName !== config.packageName) return rejected('play_integrity_app_package_mismatch');
  const certificates = Array.isArray(app?.certificateSha256Digest) ? app.certificateSha256Digest : [];
  if (!certificates.some((digest) => typeof digest === 'string' && config.allowedCertificateDigests.has(digest))) {
    return rejected('play_integrity_certificate_mismatch');
  }
  const versionCode = typeof app?.versionCode === 'string' ? app.versionCode : String(app?.versionCode ?? '');
  if (!config.allowedVersionCodes.has(versionCode)) return rejected('play_integrity_version_not_allowed');

  const deviceVerdicts = Array.isArray(payload?.deviceIntegrity?.deviceRecognitionVerdict)
    ? payload.deviceIntegrity.deviceRecognitionVerdict
    : [];
  if (!deviceVerdicts.includes('MEETS_DEVICE_INTEGRITY')) return rejected('play_integrity_device_untrusted');
  const licensingVerdict = payload?.accountDetails?.appLicensingVerdict;
  if (config.requireLicensed && licensingVerdict !== 'LICENSED') return rejected('play_integrity_unlicensed');

  return {
    valid: true,
    verdict: 'play_integrity_standard',
    riskSignals: {
      app_recognition: app.appRecognitionVerdict,
      app_licensing: licensingVerdict ?? 'UNEVALUATED',
      device_integrity: 'MEETS_DEVICE_INTEGRITY',
      version_code: versionCode,
    },
  };
}

export async function verifyPlayIntegrity(
  integrityToken: string,
  expectedRequestHash: string,
  options: { fetcher?: typeof fetch; now?: number } = {},
): Promise<PlayIntegrityResult> {
  if (typeof integrityToken !== 'string' || integrityToken.length < 32 || integrityToken.length > 16_384) {
    return rejected('play_integrity_token_malformed');
  }
  const config = readPlayIntegrityConfig();
  const fetcher = options.fetcher ?? fetch;
  const accessToken = await googleAccessToken(config, fetcher);
  const response = await fetcher(
    `${config.decodeOrigin}/v1/${encodeURIComponent(config.packageName)}:decodeIntegrityToken`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ integrity_token: integrityToken }),
      signal: AbortSignal.timeout(8_000),
    },
  );
  const decoded = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Play Integrity decode returned ${response.status}`);
  const payload = decoded?.tokenPayloadExternal ?? decoded?.token_payload_external;
  if (!payload || typeof payload !== 'object') throw new Error('Play Integrity decode returned an invalid payload');
  return validatePlayIntegrityPayload(payload, expectedRequestHash, config, options.now);
}
