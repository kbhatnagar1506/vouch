// Ported verbatim from vouch-ui's src/components/BrandLogo.jsx.
// Renders a real brand logo when we have one, else a clean lettermark tile.
export default function BrandLogo({
  name,
  initial,
  color,
  logo,
  size = 42,
  radius = 12,
}: {
  name: string;
  initial: string;
  color: string;
  logo: string | null;
  size?: number;
  radius?: number;
}) {
  const px = `${size}px`;
  if (logo) {
    return (
      <span
        style={{
          width: px,
          height: px,
          borderRadius: radius,
          background: "#fff",
          border: "1px solid var(--line)",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          boxShadow: "0 1px 2px rgba(13,13,15,.05)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={name} style={{ width: size * 0.58, height: size * 0.58, objectFit: "contain" }} />
      </span>
    );
  }
  return (
    <span
      style={{
        width: px,
        height: px,
        borderRadius: radius,
        background: color,
        color: "#fff",
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        fontSize: size * 0.38,
      }}
    >
      {initial}
    </span>
  );
}
