import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  agentTier,
  computeIsOver18,
  isTerminal,
  isVerified,
  parseInquiry,
  verifyPersonaSignature,
  webhookEventName,
  webhookPayload,
} from "@/lib/persona-schema";

describe("status semantics", () => {
  it("treats only `approved` as verified — never `completed`", () => {
    expect(isVerified("approved")).toBe(true);
    // The whole point: `completed` means the user reached the final screen,
    // not that the checks passed. Letting it through would admit anyone who
    // walked to the end of the flow with a bad document.
    expect(isVerified("completed")).toBe(false);
    for (const status of ["created", "pending", "failed", "expired", "declined", "needs_review", "", null, undefined]) {
      expect(isVerified(status)).toBe(false);
    }
  });

  it("knows which statuses can still change", () => {
    for (const status of ["approved", "declined", "failed", "expired"]) {
      expect(isTerminal(status)).toBe(true);
    }
    for (const status of ["created", "pending", "completed", "needs_review", null]) {
      expect(isTerminal(status)).toBe(false);
    }
  });

  it("grants the agent spending authority only when verified", () => {
    expect(agentTier("approved")).toBe("act");
    expect(agentTier("completed")).toBe("observe");
    expect(agentTier("needs_review")).toBe("observe");
    expect(agentTier(null)).toBe("observe");
  });
});

describe("computeIsOver18", () => {
  const now = new Date("2026-09-13T12:00:00Z");

  it("is true well over the threshold and false well under", () => {
    expect(computeIsOver18("1990-01-01", now)).toBe(true);
    expect(computeIsOver18("2015-01-01", now)).toBe(false);
  });

  it("handles the boundary exactly", () => {
    expect(computeIsOver18("2008-09-13", now)).toBe(true); // 18 today
    expect(computeIsOver18("2008-09-14", now)).toBe(false); // 18 tomorrow
    expect(computeIsOver18("2008-09-12", now)).toBe(true);
    expect(computeIsOver18("2008-10-01", now)).toBe(false); // birthday later this year
    expect(computeIsOver18("2008-08-01", now)).toBe(true); // birthday already passed
  });

  it("returns null rather than guessing when the date is missing or unparseable", () => {
    // Defaulting either way is harmful: false locks out a legitimate user,
    // true defeats the check entirely.
    for (const value of [null, "", "not-a-date", "??"]) {
      expect(computeIsOver18(value, now)).toBeNull();
    }
  });
});

function inquiryResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "inq_ABC123",
      type: "inquiry",
      attributes: {
        status: "approved",
        fields: {
          "name-first": { type: "string", value: "PrefilledFirst" },
          "address-city": { type: "string", value: "Atlanta" },
        },
      },
      relationships: { account: { data: { id: "act_XYZ", type: "account" } } },
      ...overrides,
    },
    included: [
      {
        type: "verification/government-id",
        id: "ver_gov",
        attributes: {
          status: "passed",
          "name-first": "Krishna",
          "name-last": "Bhatnagar",
          birthdate: "1999-04-02",
          "address-street-1": "123 Peachtree St",
          "address-city": "Atlanta",
          "address-subdivision": "GA",
          "address-postal-code": "30303",
          "address-country-code": "US",
          "document-number": "D1234567",
        },
      },
      {
        type: "verification/selfie",
        id: "ver_selfie",
        attributes: {
          status: "passed",
          "document-similarity-score": 0.94,
          checks: [
            { name: "selfie_liveness_detection", status: "passed" },
            { name: "selfie_id_comparison", status: "passed" },
          ],
        },
      },
      { type: "verification/phone-number", id: "ver_phone", attributes: { status: "passed" } },
    ],
  };
}

describe("parseInquiry", () => {
  it("extracts the fields we persist", () => {
    const identity = parseInquiry(inquiryResponse(), new Date("2026-09-13T12:00:00Z"));

    expect(identity).toMatchObject({
      inquiryId: "inq_ABC123",
      accountId: "act_XYZ",
      status: "approved",
      nameLast: "Bhatnagar",
      addressStreet1: "123 Peachtree St",
      addressSubdivision: "GA",
      addressPostalCode: "30303",
      addressCountryCode: "US",
      isOver18: true,
      phoneVerified: true,
      selfieLivenessPassed: true,
      selfieDocumentSimilarity: 0.94,
    });
  });

  it("never surfaces the birthdate or document number, only the derived age", () => {
    const identity = parseInquiry(inquiryResponse(), new Date("2026-09-13T12:00:00Z"));
    const serialized = JSON.stringify(identity);

    expect(serialized).not.toContain("1999-04-02");
    expect(serialized).not.toContain("D1234567");
    expect(identity?.isOver18).toBe(true);
  });

  it("prefers the government ID's values over prefilled inquiry fields", () => {
    // `fields` can be prefilled by us and edited by the user; the government
    // ID is what was actually read off the document.
    const identity = parseInquiry(inquiryResponse(), new Date("2026-09-13T12:00:00Z"));
    expect(identity?.nameFirst).toBe("Krishna");
    expect(identity?.nameFirst).not.toBe("PrefilledFirst");
  });

  it("falls back to inquiry fields when the ID didn't supply one", () => {
    const raw = inquiryResponse();
    delete (raw.included[0].attributes as Record<string, unknown>)["address-city"];
    expect(parseInquiry(raw)?.addressCity).toBe("Atlanta");
  });

  it("reports a failed liveness check as false, and an absent one as null", () => {
    const failed = inquiryResponse();
    (failed.included[1].attributes as { checks: { name: string; status: string }[] }).checks = [
      { name: "selfie_liveness_detection", status: "failed" },
    ];
    expect(parseInquiry(failed)?.selfieLivenessPassed).toBe(false);

    const notApplicable = inquiryResponse();
    (notApplicable.included[1].attributes as { checks: { name: string; status: string }[] }).checks = [
      { name: "selfie_liveness_detection", status: "not_applicable" },
    ];
    expect(parseInquiry(notApplicable)?.selfieLivenessPassed).toBeNull();

    const missing = inquiryResponse();
    missing.included = [missing.included[0]];
    expect(parseInquiry(missing)?.selfieLivenessPassed).toBeNull();
  });

  it("treats a non-passing phone verification as unverified", () => {
    const raw = inquiryResponse();
    (raw.included[2].attributes as { status: string }).status = "requires_retry";
    expect(parseInquiry(raw)?.phoneVerified).toBe(false);

    const absent = inquiryResponse();
    absent.included = [absent.included[0]];
    expect(parseInquiry(absent)?.phoneVerified).toBe(false);
  });

  it("degrades to nulls rather than throwing when verifications are missing", () => {
    const bare = { data: { id: "inq_BARE", attributes: { status: "pending" } } };
    const identity = parseInquiry(bare);

    expect(identity).toMatchObject({
      inquiryId: "inq_BARE",
      status: "pending",
      accountId: null,
      nameFirst: null,
      isOver18: null,
      phoneVerified: false,
    });
  });

  it("returns null only when there's no usable inquiry id", () => {
    expect(parseInquiry(null)).toBeNull();
    expect(parseInquiry({})).toBeNull();
    expect(parseInquiry({ data: {} })).toBeNull();
    expect(parseInquiry({ data: { id: "" } })).toBeNull();
    expect(parseInquiry("inq_ABC")).toBeNull();
  });

  it("defaults a missing status to `created`, which is not verified", () => {
    const identity = parseInquiry({ data: { id: "inq_X", attributes: {} } });
    expect(identity?.status).toBe("created");
    expect(isVerified(identity?.status)).toBe(false);
  });
});

describe("verifyPersonaSignature", () => {
  const secret = "whsec-test-secret";
  const body = '{"data":{"attributes":{"name":"inquiry.approved"}}}';
  const sign = (t: string, payload: string, key = secret) =>
    createHmac("sha256", key).update(`${t}.${payload}`).digest("hex");

  it("accepts a correctly signed payload", () => {
    const t = "1789300000";
    expect(verifyPersonaSignature(`t=${t},v1=${sign(t, body)}`, body, secret)).toBe(true);
  });

  it("accepts either pair during a secret rotation", () => {
    // Persona sends two space-separated pairs while a secret is rotating.
    // Rejecting the second silently drops webhooks for the whole window.
    const t = "1789300000";
    const header = `t=${t},v1=${sign(t, body, "old-secret")} t=${t},v1=${sign(t, body)}`;
    expect(verifyPersonaSignature(header, body, secret)).toBe(true);
    expect(verifyPersonaSignature(header, body, "old-secret")).toBe(true);
    expect(verifyPersonaSignature(header, body, "third-secret")).toBe(false);
  });

  it("rejects a tampered body", () => {
    const t = "1789300000";
    const header = `t=${t},v1=${sign(t, body)}`;
    expect(verifyPersonaSignature(header, body.replace("approved", "declined"), secret)).toBe(false);
  });

  it("rejects a signature computed over a different timestamp", () => {
    const header = `t=1789300000,v1=${sign("1789399999", body)}`;
    expect(verifyPersonaSignature(header, body, secret)).toBe(false);
  });

  it("rejects malformed, empty, or missing headers and secrets", () => {
    const t = "1789300000";
    const good = sign(t, body);
    expect(verifyPersonaSignature(null, body, secret)).toBe(false);
    expect(verifyPersonaSignature(undefined, body, secret)).toBe(false);
    expect(verifyPersonaSignature("", body, secret)).toBe(false);
    expect(verifyPersonaSignature("garbage", body, secret)).toBe(false);
    expect(verifyPersonaSignature(`v1=${good}`, body, secret)).toBe(false);
    expect(verifyPersonaSignature(`t=${t}`, body, secret)).toBe(false);
    expect(verifyPersonaSignature(`t=${t},v1=${good}`, body, "")).toBe(false);
  });

  it("rejects a wrong-length signature without throwing", () => {
    // timingSafeEqual throws on a length mismatch — this must be caught
    // before the comparison, or a short signature crashes the endpoint.
    expect(() => verifyPersonaSignature("t=1,v1=abc", body, secret)).not.toThrow();
    expect(verifyPersonaSignature("t=1,v1=abc", body, secret)).toBe(false);
  });
});

describe("webhook envelope", () => {
  it("reads the event name and payload", () => {
    const event = {
      data: {
        type: "event",
        id: "evt_1",
        attributes: { name: "inquiry.approved", payload: { data: { id: "inq_1", attributes: { status: "approved" } } } },
      },
    };
    expect(webhookEventName(event)).toBe("inquiry.approved");
    expect(parseInquiry(webhookPayload(event))?.inquiryId).toBe("inq_1");
  });

  it("returns null on a shape it doesn't recognize", () => {
    expect(webhookEventName(null)).toBeNull();
    expect(webhookEventName({})).toBeNull();
    expect(webhookEventName({ data: { attributes: {} } })).toBeNull();
    expect(webhookPayload(null)).toBeNull();
    expect(webhookPayload({ data: { attributes: {} } })).toBeNull();
  });
});
