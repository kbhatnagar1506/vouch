// Top 30 subscription catalog, ported verbatim from kbhatnagar1506/vouch-ui's
// src/data/catalog.js. This is static brand metadata (name/color/logo for
// well-known services) — not user data — so it's safe to reuse for real
// merchants detected from Gmail: matching a real charge's merchant name
// against this catalog gives it a real logo/color instead of only a
// lettermark, without inventing anything about the user's own usage.
export interface CatalogEntry {
  name: string;
  key: string;
  color: string;
  price: number;
  category: string;
  logo: string | null;
  initial: string;
}

export const catalog: CatalogEntry[] = [
  { name: "Spotify", key: "spotify", color: "#1DB954", price: 11.99, category: "Music", logo: "/assets/logos/spotify.svg", initial: "S" },
  { name: "Netflix", key: "netflix", color: "#E50914", price: 15.49, category: "Streaming", logo: "/assets/logos/netflix.svg", initial: "N" },
  { name: "YouTube Premium", key: "youtube", color: "#FF0000", price: 13.99, category: "Streaming", logo: "/assets/logos/youtube.svg", initial: "Y" },
  { name: "Apple Music", key: "applemusic", color: "#FA243C", price: 10.99, category: "Music", logo: "/assets/logos/applemusic.svg", initial: "A" },
  { name: "Amazon Prime", key: "amazonprime", color: "#00A8E1", price: 14.99, category: "Streaming", logo: null, initial: "A" },
  { name: "Disney+", key: "disneyplus", color: "#113CCF", price: 13.99, category: "Streaming", logo: null, initial: "D" },
  { name: "HBO Max", key: "hbomax", color: "#8A2BE2", price: 15.99, category: "Streaming", logo: "/assets/logos/hbomax.svg", initial: "H" },
  { name: "Hulu", key: "hulu", color: "#1CE783", price: 17.99, category: "Streaming", logo: null, initial: "H" },
  { name: "OpenAI", key: "openai", color: "#10A37F", price: 20.0, category: "AI & tools", logo: null, initial: "O" },
  { name: "Claude", key: "claude", color: "#D97706", price: 20.0, category: "AI & tools", logo: "/assets/logos/claude.svg", initial: "C" },
  { name: "Notion", key: "notion", color: "#000000", price: 10.0, category: "Productivity", logo: "/assets/logos/notion.svg", initial: "N" },
  { name: "Adobe CC", key: "adobe", color: "#FF0000", price: 59.99, category: "Creative", logo: null, initial: "A" },
  { name: "Dropbox", key: "dropbox", color: "#0061FF", price: 11.99, category: "Storage", logo: "/assets/logos/dropbox.svg", initial: "D" },
  { name: "Google Drive", key: "googledrive", color: "#1FA463", price: 9.99, category: "Storage", logo: "/assets/logos/googledrive.svg", initial: "G" },
  { name: "iCloud+", key: "icloud", color: "#3693F3", price: 2.99, category: "Storage", logo: "/assets/logos/icloud.svg", initial: "I" },
  { name: "Microsoft 365", key: "office", color: "#D83B01", price: 6.99, category: "Productivity", logo: null, initial: "M" },
  { name: "Slack", key: "slack", color: "#4A154B", price: 8.75, category: "Productivity", logo: null, initial: "S" },
  { name: "Zoom", key: "zoom", color: "#0B5CFF", price: 13.32, category: "Productivity", logo: "/assets/logos/zoom.svg", initial: "Z" },
  { name: "Canva", key: "canva", color: "#00C4CC", price: 12.99, category: "Creative", logo: null, initial: "C" },
  { name: "Figma", key: "figma", color: "#F24E1E", price: 12.0, category: "Creative", logo: "/assets/logos/figma.svg", initial: "F" },
  { name: "GitHub", key: "github", color: "#181717", price: 4.0, category: "Developer", logo: "/assets/logos/github.svg", initial: "G" },
  { name: "Audible", key: "audible", color: "#F8991C", price: 14.95, category: "Audiobooks", logo: "/assets/logos/audible.svg", initial: "A" },
  { name: "NYT", key: "nyt", color: "#000000", price: 17.0, category: "News", logo: "/assets/logos/nyt.svg", initial: "N" },
  { name: "Twitch", key: "twitch", color: "#9146FF", price: 8.99, category: "Streaming", logo: "/assets/logos/twitch.svg", initial: "T" },
  { name: "Paramount+", key: "paramountplus", color: "#0064FF", price: 11.99, category: "Streaming", logo: "/assets/logos/paramountplus.svg", initial: "P" },
  { name: "Peacock", key: "peacock", color: "#000000", price: 7.99, category: "Streaming", logo: null, initial: "P" },
  { name: "Patreon", key: "patreon", color: "#FF424D", price: 8.0, category: "Creators", logo: "/assets/logos/patreon.svg", initial: "P" },
  { name: "Duolingo", key: "duolingo", color: "#58CC02", price: 6.99, category: "Education", logo: "/assets/logos/duolingo.svg", initial: "D" },
  { name: "Grammarly", key: "grammarly", color: "#15C39A", price: 12.0, category: "Productivity", logo: "/assets/logos/grammarly.svg", initial: "G" },
  { name: "LinkedIn Premium", key: "linkedin", color: "#0A66C2", price: 39.99, category: "Career", logo: null, initial: "L" },
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Case/punctuation-insensitive match of a real merchant name against the static brand catalog. */
export function findCatalogEntry(merchantName: string): CatalogEntry | undefined {
  const target = normalize(merchantName);
  if (!target) return undefined;
  return catalog.find((entry) => {
    const key = normalize(entry.key);
    const name = normalize(entry.name);
    return target === key || target === name || target.includes(key) || key.includes(target) || target.includes(name) || name.includes(target);
  });
}

/** Spend category for a real merchant, from the static catalog — "Other" for anything unrecognized. */
export function categoryFor(merchantName: string): string {
  return findCatalogEntry(merchantName)?.category ?? "Other";
}

const CATEGORY_COLORS: Record<string, string> = {
  Streaming: "#e50914",
  Music: "#1db954",
  "AI & tools": "#10a37f",
  Productivity: "#1f3df0",
  Creative: "#c47d18",
  Storage: "#0b5cff",
  News: "#1a1a1a",
  Developer: "#181717",
  Audiobooks: "#f8991c",
  Creators: "#ff424d",
  Education: "#58cc02",
  Career: "#0a66c2",
  Other: "#86868f",
};

export function colorForCategory(category: string): string {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.Other;
}

const FALLBACK_COLORS = ["#1f3df0", "#0b8a5a", "#c47d18", "#c0392f", "#6d5ef0", "#0d9488", "#be185d"];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Brand styling for a merchant name: real catalog entry when we recognize it, else a stable lettermark color. */
export function brandFor(merchantName: string): { color: string; initial: string; logo: string | null } {
  const entry = findCatalogEntry(merchantName);
  if (entry) return { color: entry.color, initial: entry.initial, logo: entry.logo };
  const trimmed = merchantName.trim();
  const color = FALLBACK_COLORS[hashString(trimmed) % FALLBACK_COLORS.length];
  return { color, initial: (trimmed[0] || "?").toUpperCase(), logo: null };
}
