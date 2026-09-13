// Ported verbatim from aaditisinghal/vouch-aaditi's
// src/lib/__tests__/gmail-query.test.ts (commit 55eedf7).
import { describe, expect, it } from "vitest";
import {
  FINANCIAL_MAIL_QUERY,
  buildSearchQuery,
  monthsAgoUnixSeconds,
} from "@/lib/gmail-query";

describe("FINANCIAL_MAIL_QUERY", () => {
  it("excludes spam and trash", () => {
    expect(FINANCIAL_MAIL_QUERY).toContain("-in:spam");
    expect(FINANCIAL_MAIL_QUERY).toContain("-in:trash");
  });

  it("does not use overly generic from: senders that match almost any transactional mail", () => {
    // noreply/no-reply/support are used by virtually every service for
    // non-financial notifications (security alerts, account changes, etc.)
    // — including them here previously caused false-positive imports.
    expect(FINANCIAL_MAIL_QUERY).not.toMatch(/\bnoreply\b/);
    expect(FINANCIAL_MAIL_QUERY).not.toMatch(/\bno-reply\b/);
    expect(FINANCIAL_MAIL_QUERY).not.toMatch(/\bsupport\b/);
  });

  it("still targets financial subject keywords", () => {
    for (const keyword of ["receipt", "invoice", "subscription", "billing", "payment"]) {
      expect(FINANCIAL_MAIL_QUERY).toContain(keyword);
    }
  });
});

describe("buildSearchQuery", () => {
  it("appends an after: filter with the given unix timestamp", () => {
    const query = buildSearchQuery(1700000000);
    expect(query).toBe(`${FINANCIAL_MAIL_QUERY} after:1700000000`);
  });
});

describe("monthsAgoUnixSeconds", () => {
  it("computes a unix timestamp N months before the given date", () => {
    const now = new Date("2026-03-15T12:00:00Z");
    const result = monthsAgoUnixSeconds(1, now);
    const expected = new Date(now);
    expected.setMonth(expected.getMonth() - 1);
    expect(result).toBe(Math.floor(expected.getTime() / 1000));
  });

  it("defaults to the current time when no `now` is provided", () => {
    const before = Date.now();
    const result = monthsAgoUnixSeconds(0);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(Math.floor(before / 1000));
    expect(result).toBeLessThanOrEqual(Math.floor(after / 1000));
  });
});
