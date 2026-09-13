// Ported verbatim from aaditisinghal/vouch-aaditi's
// src/lib/__tests__/gmail-body.test.ts (commit 55eedf7).
import { describe, expect, it } from "vitest";
import {
  extractPlainTextBody,
  extractHeader,
  extractMerchant,
  extractAmountCents,
} from "@/lib/gmail-body";
import type { gmail_v1 } from "googleapis";

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

describe("extractPlainTextBody", () => {
  it("returns '' when payload is undefined", () => {
    expect(extractPlainTextBody(undefined)).toBe("");
  });

  it("decodes a simple non-multipart text/plain body", () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: "text/plain",
      body: { data: b64url("Hello world") },
    };
    expect(extractPlainTextBody(payload)).toBe("Hello world");
  });

  it("strips tags from a simple non-multipart text/html body", () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: "text/html",
      body: { data: b64url("<p>Hi <b>there</b></p>") },
    };
    expect(extractPlainTextBody(payload)).toContain("Hi");
    expect(extractPlainTextBody(payload)).not.toContain("<");
  });

  it("prefers text/plain over text/html in a nested multipart/alternative", () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/html", body: { data: b64url("<p>HTML version</p>") } },
            { mimeType: "text/plain", body: { data: b64url("Plain version") } },
          ],
        },
      ],
    };
    expect(extractPlainTextBody(payload)).toBe("Plain version");
  });

  it("falls back to text/html when no text/plain part exists", () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: "multipart/mixed",
      parts: [{ mimeType: "text/html", body: { data: b64url("<div>Only HTML</div>") } }],
    };
    expect(extractPlainTextBody(payload)).toContain("Only HTML");
  });

  it("returns '' when no text part can be found", () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: "multipart/mixed",
      parts: [{ mimeType: "image/png", body: { attachmentId: "abc" } }],
    };
    expect(extractPlainTextBody(payload)).toBe("");
  });
});

describe("extractHeader", () => {
  const headers = [
    { name: "Subject", value: "Your order confirmation" },
    { name: "From", value: "DoorDash <noreply@doordash.com>" },
  ];

  it("finds a header case-insensitively", () => {
    expect(extractHeader(headers, "subject")).toBe("Your order confirmation");
    expect(extractHeader(headers, "FROM")).toBe("DoorDash <noreply@doordash.com>");
  });

  it("returns null when the header is missing or headers are undefined", () => {
    expect(extractHeader(headers, "Date")).toBeNull();
    expect(extractHeader(undefined, "Subject")).toBeNull();
  });
});

describe("extractMerchant", () => {
  it("uses the display name when present and not generic", () => {
    expect(extractMerchant('"DoorDash" <noreply@doordash.com>')).toBe("DoorDash");
  });

  it("falls back to the domain when the display name is generic", () => {
    expect(extractMerchant('"noreply" <noreply@netflix.com>')).toBe("netflix");
  });

  it("falls back to the domain for a bare email with no display name", () => {
    expect(extractMerchant("receipts@uber.com")).toBe("uber");
  });

  it("returns null for null input", () => {
    expect(extractMerchant(null)).toBeNull();
  });

  it("returns null when no domain can be parsed", () => {
    expect(extractMerchant("not an email at all")).toBeNull();
  });
});

describe("extractAmountCents", () => {
  it("extracts a simple dollar amount", () => {
    expect(extractAmountCents("Your total is $24.50 today.")).toBe(2450);
  });

  it("prefers an amount near a total/charged/amount keyword when multiple exist", () => {
    const text = "Subtotal $10.00, delivery fee $2.00, Total: $15.00 charged to your card.";
    expect(extractAmountCents(text)).toBe(1500);
  });

  it("returns null when there is no dollar amount", () => {
    expect(extractAmountCents("Thanks for your order!")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractAmountCents("")).toBeNull();
  });

  it("handles amounts with thousands separators", () => {
    expect(extractAmountCents("Annual plan charged: $1,299.99")).toBe(129999);
  });
});
