// Redrawn to match the current Gmail "M" mark (square icon, not the older
// envelope-flap style this used to approximate) — red checkmark/M over
// blue/green side panels with small yellow/dark-red corner accents, per
// Google's Gmail brand colors.
export function GmailIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="6" fill="#fff" />
      <path d="M0,0 L6,12 L24,36 L24,48 L6,48 Q0,48 0,42 L0,0 Z" fill="#4285F4" />
      <path d="M48,0 L42,12 L24,36 L24,48 L42,48 Q48,48 48,42 L48,0 Z" fill="#34A853" />
      <path d="M6,12 L24,36 L42,12 L33,12 L24,23 L15,12 Z" fill="#EA4335" />
      <path d="M0,0 L16,0 L6,12 Z" fill="#C5221F" />
      <path d="M48,0 L32,0 L42,12 Z" fill="#FBBC04" />
    </svg>
  );
}
