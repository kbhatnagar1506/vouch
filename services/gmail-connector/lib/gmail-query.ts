// Ported verbatim from aaditisinghal/vouch-aaditi's src/lib/gmail-query.ts
// (commit 55eedf7) — no DB or auth dependency, no adaptation needed.

export const FINANCIAL_MAIL_QUERY =
  '(subject:(receipt OR invoice OR order OR "order confirmation" OR renewal OR subscription OR billing OR payment OR "payment confirmation" OR statement OR membership OR charged) OR from:(receipts OR billing OR invoicing OR orders)) -in:spam -in:trash';

export function buildSearchQuery(afterUnixSeconds: number): string {
  return `${FINANCIAL_MAIL_QUERY} after:${afterUnixSeconds}`;
}

export function monthsAgoUnixSeconds(months: number, now: Date = new Date()): number {
  const then = new Date(now);
  then.setMonth(then.getMonth() - months);
  return Math.floor(then.getTime() / 1000);
}
