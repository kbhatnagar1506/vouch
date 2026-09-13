// Adapted from aaditisinghal/vouch-aaditi's vitest.setup.ts (commit
// 55eedf7) — the env var names match this repo's own lib/session-token.ts
// (JWT_SECRET) and lib/crypto.ts (ENCRYPTION_KEY, base64-encoded 32 bytes),
// not her TOKEN_ENCRYPTION_KEY.
import "@testing-library/jest-dom/vitest";
import crypto from "crypto";

process.env.JWT_SECRET ??= "test-jwt-secret";
process.env.ENCRYPTION_KEY ??= crypto.randomBytes(32).toString("base64");
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
