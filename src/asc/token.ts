import { createPrivateKey, sign, type KeyObject } from "node:crypto";

/**
 * App Store Connect API tokens: ES256-signed JWTs.
 * https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests
 *
 * Apple rejects tokens that live longer than 20 minutes by *its* clock. Issuing them
 * 30 s in the past and for 10 minutes keeps them valid even when this computer's
 * clock is off by a few minutes in either direction.
 */

const LIFETIME_S = 10 * 60;
const BACKDATE_S = 30;
const REUSE_MS = 5 * 60 * 1000;

const base64url = (data: Buffer | string): string => Buffer.from(data).toString("base64url");

export function signToken(issuerId: string, keyId: string, privateKeyPem: string | KeyObject, nowMs = Date.now()): string {
  const now = Math.floor(nowMs / 1000);
  const header = { alg: "ES256", kid: keyId, typ: "JWT" };
  const payload = { iss: issuerId, iat: now - BACKDATE_S, exp: now + LIFETIME_S, aud: "appstoreconnect-v1" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const key = typeof privateKeyPem === "string" ? createPrivateKey(privateKeyPem) : privateKeyPem;
  // JWS needs the raw r||s signature, not DER
  const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64url(signature)}`;
}

const cache = new Map<string, { token: string; at: number }>();

/** Signs once and reuses the token for a few minutes. */
export function tokenFor(issuerId: string, keyId: string, privateKeyPem: string): string {
  const id = `${issuerId}/${keyId}`;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < REUSE_MS) return hit.token;
  const token = signToken(issuerId, keyId, privateKeyPem);
  cache.set(id, { token, at: Date.now() });
  return token;
}
