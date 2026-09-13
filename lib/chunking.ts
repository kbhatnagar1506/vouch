// Ported verbatim from aaditisinghal/vouch-aaditi's src/lib/chunking.ts
// (commit 55eedf7) — no DB or auth dependency, no adaptation needed.

export interface TextChunk {
  index: number;
  text: string;
}

export interface ChunkOptions {
  targetChars?: number;
  maxChunks?: number;
}

const DEFAULT_TARGET_CHARS = 1800;
const DEFAULT_MAX_CHUNKS = 8;

function splitOversizedParagraph(paragraph: string, targetChars: number): string[] {
  if (paragraph.length <= targetChars) return [paragraph];

  const sentences = paragraph.match(/[^.!?]+[.!?]*\s*/g) ?? [paragraph];
  const pieces: string[] = [];
  let buffer = "";

  for (const sentence of sentences) {
    if (sentence.length > targetChars) {
      if (buffer) {
        pieces.push(buffer.trim());
        buffer = "";
      }
      const words = sentence.split(/\s+/);
      let wordBuffer = "";
      for (const word of words) {
        if ((wordBuffer + " " + word).trim().length > targetChars) {
          if (wordBuffer) pieces.push(wordBuffer.trim());
          wordBuffer = word;
        } else {
          wordBuffer = (wordBuffer + " " + word).trim();
        }
      }
      if (wordBuffer) pieces.push(wordBuffer.trim());
      continue;
    }

    if ((buffer + sentence).length > targetChars) {
      pieces.push(buffer.trim());
      buffer = sentence;
    } else {
      buffer += sentence;
    }
  }
  if (buffer.trim()) pieces.push(buffer.trim());

  return pieces;
}

export function chunkText(text: string, opts: ChunkOptions = {}): TextChunk[] {
  const targetChars = opts.targetChars ?? DEFAULT_TARGET_CHARS;
  const maxChunks = opts.maxChunks ?? DEFAULT_MAX_CHUNKS;

  const trimmed = text.trim();
  if (!trimmed) return [];

  const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const pieces: string[] = [];
  let buffer = "";

  for (const paragraph of paragraphs) {
    const candidates =
      paragraph.length > targetChars
        ? splitOversizedParagraph(paragraph, targetChars)
        : [paragraph];

    for (const candidate of candidates) {
      const combined = buffer ? `${buffer}\n\n${candidate}` : candidate;
      if (combined.length > targetChars && buffer) {
        pieces.push(buffer);
        buffer = candidate;
      } else {
        buffer = combined;
      }
    }
  }
  if (buffer) pieces.push(buffer);

  while (pieces.length > maxChunks) {
    let smallestPairIndex = 0;
    let smallestPairSize = Infinity;
    for (let i = 0; i < pieces.length - 1; i++) {
      const size = pieces[i].length + pieces[i + 1].length;
      if (size < smallestPairSize) {
        smallestPairSize = size;
        smallestPairIndex = i;
      }
    }
    const merged = `${pieces[smallestPairIndex]}\n\n${pieces[smallestPairIndex + 1]}`;
    pieces.splice(smallestPairIndex, 2, merged);
  }

  return pieces.map((text, index) => ({ index, text }));
}
