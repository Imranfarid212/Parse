// @ts-nocheck - shared by Supabase Edge Functions under Deno.
import { Buffer } from 'node:buffer';
import * as asn1js from 'npm:asn1js@3.0.10';
import cbor from 'npm:cbor@10.0.12';

const APPLE_APP_ATTEST_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijVo
yFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

let pkijs: any = null;
let cryptoEnginePromise: Promise<void> | null = null;

const ensureCryptoEngine = async () => {
  if (cryptoEnginePromise) return cryptoEnginePromise;
  cryptoEnginePromise = (async () => {
    // pkijs detects Node compatibility through the global `process` shim. In
    // Supabase Edge that shim has an undefined pid and `global` is a read-only
    // Window, so its Node branch attempts to assign global[undefined]. Defining
    // the browser marker before importing pkijs selects its WebCrypto branch.
    const runtime = globalThis as any;
    let stage = 'compatibility globals';
    try {
      if (typeof runtime.window === 'undefined') {
        Object.defineProperty(runtime, 'window', { value: runtime, configurable: true });
      }
      // Supabase's Node compatibility shim exposes `process.pid` as undefined
      // and aliases `global` to its read-only Window. PKIjs uses those values
      // as an object key during module initialization. Give that compatibility
      // branch an isolated writable target even if its window check is folded.
      if (runtime.process && 'pid' in runtime.process && !Number.isInteger(runtime.process.pid)) {
        const processShim = Object.create(runtime.process);
        Object.defineProperty(processShim, 'pid', { value: 2_147_483_647 });
        Object.defineProperty(runtime, 'process', { value: processShim, configurable: true });
      }
      if (runtime.global === runtime) {
        Object.defineProperty(runtime, 'global', { value: Object.create(null), configurable: true });
      }
      stage = 'PKI module import';
      pkijs = await import('npm:pkijs@3.4.0');
      stage = 'WebCrypto engine registration';
      pkijs.setEngine('WebCrypto', new pkijs.CryptoEngine({ name: 'WebCrypto', crypto }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new Error(`App Attest ${stage} failed: ${message}`);
    }
  })();
  try {
    await cryptoEnginePromise;
  } catch (error) {
    cryptoEnginePromise = null;
    throw error;
  }
};

type AppAttestConfig = {
  appIdPrefix: string;
  bundleIdentifier: string;
  allowDevelopment: boolean;
  allowedCategories: Set<number>;
  allowedBundleVersions: Set<string>;
};

type AppleExtensions = {
  validationCategory: number | null;
  bundleVersion: string | null;
  extensionsPresent: boolean;
};

const required = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};

const csvSet = (name: string) => new Set(required(name).split(',').map((value) => value.trim()).filter(Boolean));

export function readAppAttestConfig(): AppAttestConfig {
  const categories = new Set([...csvSet('APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES')].map((value) => Number(value)));
  if ([...categories].some((value) => !Number.isInteger(value) || value < 1 || value > 10)) {
    throw new Error('APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES is invalid');
  }
  return {
    appIdPrefix: required('APP_ATTEST_APP_ID_PREFIX'),
    bundleIdentifier: required('APP_ATTEST_BUNDLE_ID'),
    allowDevelopment: required('APP_ATTEST_ENVIRONMENT') === 'development',
    allowedCategories: categories,
    allowedBundleVersions: csvSet('APP_ATTEST_ALLOWED_BUNDLE_VERSIONS'),
  };
}

export const decodeBase64 = (value: string, label: string) => {
  if (typeof value !== 'string' || value.length < 16 || value.length > 65_536) throw new Error(`${label} is invalid`);
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const decoded = Buffer.from(padded, 'base64');
  if (decoded.length < 8) throw new Error(`${label} is invalid`);
  return decoded;
};

const bytesEqual = (left: Uint8Array, right: Uint8Array) => {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
};

const sha256 = async (value: Uint8Array | string) => new Uint8Array(await crypto.subtle.digest(
  'SHA-256',
  typeof value === 'string' ? new TextEncoder().encode(value) : value,
));

const certificateFromDer = (der: Uint8Array) => {
  const parsed = asn1js.fromBER(der);
  if (parsed.offset === -1) throw new Error('App Attest certificate is invalid');
  return new pkijs.Certificate({ schema: parsed.result });
};

const pemToDer = (pem: string) => decodeBase64(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'certificate');

async function verifiedCredentialCertificate(x5c: unknown) {
  if (!Array.isArray(x5c) || x5c.length !== 2 || !x5c.every((value) => Buffer.isBuffer(value))) {
    throw new Error('App Attest certificate chain is invalid');
  }
  const leaf = certificateFromDer(x5c[0]);
  const intermediate = certificateFromDer(x5c[1]);
  const root = certificateFromDer(pemToDer(APPLE_APP_ATTEST_ROOT_CA));
  const chain = new pkijs.CertificateChainValidationEngine({ trustedCerts: [root], certs: [leaf, intermediate] });
  const verified = await chain.verify();
  if (!verified.result) throw new Error('App Attest certificate chain is not trusted');
  return leaf;
}

const findOctets = (node: unknown): Uint8Array | null => {
  const view = node?.valueBlock?.valueHexView;
  if (view instanceof Uint8Array && view.length === 32) return view;
  const children = node?.valueBlock?.value;
  if (!Array.isArray(children)) return null;
  for (const child of children) {
    const found = findOctets(child);
    if (found) return found;
  }
  return null;
};

const certificateNonce = (certificate: any) => {
  const extension = certificate.extensions?.find((item) => item.extnID === '1.2.840.113635.100.8.2');
  if (!extension) throw new Error('App Attest certificate nonce is missing');
  const parsed = asn1js.fromBER(extension.extnValue.valueBlock.valueHexView);
  const nonce = parsed.offset === -1 ? null : findOctets(parsed.result);
  if (!nonce) throw new Error('App Attest certificate nonce is invalid');
  return nonce;
};

const spkiPem = (certificate: any) => {
  const der = Buffer.from(certificate.subjectPublicKeyInfo.toSchema().toBER(false));
  const body = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
};

const pemPublicKeyDer = (pem: string) => pemToDer(pem);

const derSignatureToRaw = (signature: Uint8Array) => {
  const parsed = asn1js.fromBER(signature);
  const values = parsed.result?.valueBlock?.value;
  if (parsed.offset === -1 || !Array.isArray(values) || values.length !== 2) throw new Error('App Attest signature is invalid');
  const part = (node: unknown) => {
    let bytes = Buffer.from(node?.valueBlock?.valueHexView ?? []);
    while (bytes.length > 32 && bytes[0] === 0) bytes = bytes.subarray(1);
    if (bytes.length > 32) throw new Error('App Attest signature is invalid');
    return Buffer.concat([Buffer.alloc(32 - bytes.length), bytes]);
  };
  return Buffer.concat([part(values[0]), part(values[1])]);
};

const mapValue = (value: unknown, names: string[]) => {
  for (const name of names) {
    if (value instanceof Map && value.has(name)) return value.get(name);
    if (value && typeof value === 'object' && name in value) return value[name];
  }
  return undefined;
};

const categoryValue = (value: unknown) => {
  if (Number.isInteger(value)) return Number(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = Buffer.from(value);
    if (bytes.length === 4) return bytes.readUInt32LE(0);
  }
  throw new Error('App Attest validation category is missing');
};

const versionValue = (value: unknown) => {
  if (typeof value === 'string' && value.length > 0 && value.length <= 64) return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const decoded = Buffer.from(value).toString('utf8');
    if (decoded.length > 0 && decoded.length <= 64) return decoded;
  }
  throw new Error('App Attest bundle version is missing');
};

function decodeExtensionValues(raw: unknown): AppleExtensions {
  const validationCategory = categoryValue(mapValue(raw, ['apple_validation_category_01', 'validationCategory']));
  const bundleVersion = versionValue(mapValue(raw, ['apple_bundle_version_01', 'bundleVersion']));
  return { validationCategory, bundleVersion, extensionsPresent: true };
}

function validateExtensions(raw: unknown, config: AppAttestConfig): AppleExtensions {
  const extensions = decodeExtensionValues(raw);
  const { validationCategory, bundleVersion } = extensions;
  if (validationCategory === null || bundleVersion === null) throw new Error('App Attest extensions are incomplete');
  if (!config.allowedCategories.has(validationCategory)) throw new Error('App Attest validation category is not allowed');
  if (!config.allowedBundleVersions.has(bundleVersion)) throw new Error('App Attest bundle version is not allowed');
  return extensions;
}

export function decodeAppleAttestationExtensions(authDataValue: Uint8Array): AppleExtensions {
  const authData = Buffer.from(authDataValue);
  if (authData.length < 88 || (authData[32] & 0x40) === 0) {
    throw new Error('App Attest attested credential data is missing');
  }
  const credentialLength = authData.readUInt16BE(53);
  const cborValues = cbor.decodeAllSync(authData.subarray(55 + credentialLength));
  // Apple appends the COSE public key followed by its extensions dictionary.
  // Its current validation sample uses flags=0x40 rather than setting ED=0x80.
  if (cborValues.length === 1) {
    return { validationCategory: null, bundleVersion: null, extensionsPresent: false };
  }
  if (cborValues.length !== 2) throw new Error('App Attest authenticator extensions are invalid');
  return decodeExtensionValues(cborValues.at(-1));
}

function attestationExtensions(attestation: Buffer, config: AppAttestConfig) {
  const decoded = cbor.decodeAllSync(attestation);
  if (decoded.length !== 1 || !Buffer.isBuffer(decoded[0]?.authData)) throw new Error('App Attest object is invalid');
  const extensions = decodeAppleAttestationExtensions(decoded[0].authData);
  if (!extensions.extensionsPresent) return extensions;
  return validateExtensions(new Map([
    ['validationCategory', extensions.validationCategory],
    ['bundleVersion', extensions.bundleVersion],
  ]), config);
}

function assertionExtensions(assertion: Buffer, config: AppAttestConfig) {
  const decoded = cbor.decodeAllSync(assertion);
  const authData = decoded[0]?.authenticatorData;
  if (decoded.length !== 1 || !Buffer.isBuffer(authData) || authData.length < 37) throw new Error('App Attest assertion is invalid');
  if (authData.length === 37) return { validationCategory: null, bundleVersion: null, extensionsPresent: false };
  const values = cbor.decodeAllSync(authData.subarray(37));
  if (values.length !== 1) throw new Error('App Attest assertion extensions are invalid');
  return validateExtensions(values[0], config);
}

export async function verifyAppleAttestation(input: { attestation: string; challenge: string; keyId: string }) {
  await ensureCryptoEngine();
  const config = readAppAttestConfig();
  const attestation = decodeBase64(input.attestation, 'attestation');
  const decodedValues = cbor.decodeAllSync(attestation);
  const decoded = decodedValues[0];
  if (decodedValues.length !== 1 || decoded?.fmt !== 'apple-appattest' || !Buffer.isBuffer(decoded?.authData)
    || !Array.isArray(decoded?.attStmt?.x5c) || !Buffer.isBuffer(decoded?.attStmt?.receipt)) {
    throw new Error('App Attest object is invalid');
  }
  const authData = Buffer.from(decoded.authData);
  const credentialCertificate = await verifiedCredentialCertificate(decoded.attStmt.x5c);
  const clientDataHash = await sha256(input.challenge);
  const composite = Buffer.concat([authData, clientDataHash]);
  const expectedNonce = await sha256(composite);
  if (!bytesEqual(expectedNonce, certificateNonce(credentialCertificate))) throw new Error('App Attest nonce does not match');

  const keyId = decodeBase64(input.keyId, 'key identifier');
  const publicPoint = new Uint8Array(credentialCertificate.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView);
  if (!bytesEqual(await sha256(publicPoint), keyId)) throw new Error('App Attest key identifier does not match');
  if (!bytesEqual(authData.subarray(0, 32), await sha256(`${config.appIdPrefix}.${config.bundleIdentifier}`))) {
    throw new Error('App Attest app identifier does not match');
  }
  if (authData.readUInt32BE(33) !== 0) throw new Error('App Attest initial counter is invalid');
  const developmentAaguid = Buffer.from('appattestdevelop');
  const productionAaguid = Buffer.concat([Buffer.from('appattest'), Buffer.alloc(7)]);
  const aaguid = authData.subarray(37, 53);
  const environment = bytesEqual(aaguid, productionAaguid)
    ? 'production'
    : bytesEqual(aaguid, developmentAaguid) ? 'development' : null;
  if (!environment || (environment === 'development' && !config.allowDevelopment)) throw new Error('App Attest environment is not allowed');
  const credentialLength = authData.readUInt16BE(53);
  if (!bytesEqual(authData.subarray(55, 55 + credentialLength), keyId)) throw new Error('App Attest credential identifier does not match');

  const extensions = attestationExtensions(attestation, config);
  return {
    publicKeyPem: spkiPem(credentialCertificate),
    receiptBase64: Buffer.from(decoded.attStmt.receipt).toString('base64'),
    environment: environment as 'development' | 'production',
    ...extensions,
  };
}

export async function verifyAppleAssertion(input: {
  assertion: string;
  challenge: string;
  publicKeyPem: string;
  signCount: number;
}) {
  await ensureCryptoEngine();
  const config = readAppAttestConfig();
  const assertion = decodeBase64(input.assertion, 'assertion');
  const decodedValues = cbor.decodeAllSync(assertion);
  const decoded = decodedValues[0];
  if (decodedValues.length !== 1 || !Buffer.isBuffer(decoded?.signature) || !Buffer.isBuffer(decoded?.authenticatorData)) {
    throw new Error('App Attest assertion is invalid');
  }
  const authData = Buffer.from(decoded.authenticatorData);
  const clientDataHash = await sha256(input.challenge);
  const nonce = await sha256(Buffer.concat([authData, clientDataHash]));
  const publicKey = await crypto.subtle.importKey(
    'spki',
    pemPublicKeyDer(input.publicKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const signature = derSignatureToRaw(decoded.signature);
  if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, nonce))) {
    throw new Error('App Attest assertion signature is invalid');
  }
  if (!bytesEqual(authData.subarray(0, 32), await sha256(`${config.appIdPrefix}.${config.bundleIdentifier}`))) {
    throw new Error('App Attest assertion app identifier does not match');
  }
  const signCount = authData.readUInt32BE(33);
  if (signCount <= input.signCount) throw new Error('App Attest assertion counter is invalid');
  const extensions = assertionExtensions(assertion, config);
  return { signCount, ...extensions };
}
