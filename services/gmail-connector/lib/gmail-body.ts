// Ported verbatim from aaditisinghal/vouch-aaditi's src/lib/gmail-body.ts
// (commit 55eedf7) — pure MIME/text parsing, no DB or auth dependency, no
// adaptation needed.
import type { gmail_v1 } from "googleapis";

type MessagePart = gmail_v1.Schema$MessagePart;
type MessagePartHeader = gmail_v1.Schema$MessagePartHeader;

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findPart(
  part: MessagePart | undefined,
  mimeType: string,
): MessagePart | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) {
    return part;
  }
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

export function extractPlainTextBody(payload: MessagePart | undefined): string {
  if (!payload) return "";

  if (!payload.parts?.length && payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    return payload.mimeType === "text/html" ? stripHtml(decoded) : decoded;
  }

  const plainPart = findPart(payload, "text/plain");
  if (plainPart?.body?.data) {
    return decodeBase64Url(plainPart.body.data);
  }

  const htmlPart = findPart(payload, "text/html");
  if (htmlPart?.body?.data) {
    return stripHtml(decodeBase64Url(htmlPart.body.data));
  }

  return "";
}

export function extractHeader(
  headers: MessagePartHeader[] | undefined,
  name: string,
): string | null {
  const header = headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return header?.value ?? null;
}

const GENERIC_FROM_NAMES = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
]);

export function extractMerchant(fromHeader: string | null): string | null {
  if (!fromHeader) return null;

  const match = fromHeader.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const displayName = match ? match[1].trim() : "";
  const email = match ? match[2].trim() : fromHeader.trim();

  const normalizedDisplayName = displayName.toLowerCase().replace(/[.\-_\s]/g, "");
  if (displayName && !GENERIC_FROM_NAMES.has(normalizedDisplayName)) {
    return displayName;
  }

  const domainMatch = email.match(/@([^>\s]+)/);
  if (!domainMatch) return null;

  const domain = domainMatch[1].toLowerCase();
  const labels = domain.split(".");
  const registrable = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  return registrable || null;
}

const AMOUNT_PATTERN = /\$\s?(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/g;

export function extractAmountCents(bodyText: string): number | null {
  if (!bodyText) return null;

  const matches = [...bodyText.matchAll(AMOUNT_PATTERN)];
  if (matches.length === 0) return null;

  const totalKeywordMatch = matches.find((m) => {
    const windowStart = Math.max(0, (m.index ?? 0) - 40);
    const window = bodyText.slice(windowStart, m.index ?? 0).toLowerCase();
    return /\b(total|charged|amount)\b/.test(window);
  });

  const chosen = totalKeywordMatch ?? matches[0];
  const numeric = chosen[1].replace(/,/g, "");
  const amount = Number.parseFloat(numeric);
  if (Number.isNaN(amount)) return null;

  return Math.round(amount * 100);
}
