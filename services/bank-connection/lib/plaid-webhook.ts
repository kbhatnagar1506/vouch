import { createHash } from "crypto";
import { importJWK, decodeProtectedHeader, jwtVerify, type JWK } from "jose";
import { getPlaidClient } from "@/lib/plaid";

// Plaid rotates signing keys infrequently; cache by kid for the life of the process.
const jwkCache = new Map<string, JWK>();

async function getVerificationKey(keyId: string): Promise<JWK> {
  const cached = jwkCache.get(keyId);
  if (cached) return cached;

  const { data } = await getPlaidClient().webhookVerificationKeyGet({ key_id: keyId });
  if (data.key.expired_at) {
    throw new Error(`Plaid webhook verification key ${keyId} is expired.`);
  }
  const jwk = data.key as unknown as JWK;
  jwkCache.set(keyId, jwk);
  return jwk;
}

const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;

/**
 * Verifies a Plaid webhook per https://plaid.com/docs/api/webhooks/webhook-verification/
 * Throws if the signature, body hash, or timestamp don't check out.
 */
export async function verifyPlaidWebhook(rawBody: string, verificationJwt: string): Promise<void> {
  const { kid } = decodeProtectedHeader(verificationJwt);
  if (!kid) throw new Error("Plaid webhook JWT is missing a key id.");

  const jwk = await getVerificationKey(kid);
  const key = await importJWK(jwk, "ES256");
  const { payload } = await jwtVerify(verificationJwt, key, { maxTokenAge: `${MAX_WEBHOOK_AGE_SECONDS}s` });

  const expectedHash = payload.request_body_sha256;
  const actualHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (expectedHash !== actualHash) {
    throw new Error("Plaid webhook body hash mismatch.");
  }
}
