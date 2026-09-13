// The real Gmail logo (public/gmail-logo.png), not a hand-drawn
// reproduction — a plain <img> since this only ever renders at 16-20px
// inline next to text, where Next/Image's lazy-load/srcset machinery buys
// nothing.
export function GmailIcon({ size = 24 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/gmail-logo.png" alt="" width={size} height={size} style={{ display: "block" }} />
  );
}
