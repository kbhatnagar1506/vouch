import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const base64Key = process.env.ENCRYPTION_KEY;
  if (!base64Key) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and see docs/CARDS.md.",
    );
  }
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes (base64 of `openssl rand -base64 32`).");
  }
  return key;
}

/** Encrypts a secret for storage. Returns `iv:authTag:ciphertext`, all base64. Same treatment every other service branch gives its own secrets (Plaid tokens, Gmail OAuth tokens, voice embeddings) — same ENCRYPTION_KEY, shared across services on purpose. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivB64, authTagB64, ciphertextB64] = payload.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted payload.");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
