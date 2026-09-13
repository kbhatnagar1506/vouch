// Adapted from aaditisinghal/vouch-aaditi's src/lib/spending-categories.ts
// (commit 55eedf7) — only the db import changed (named `pool` export here,
// vs. a default export there). Logic is otherwise identical.
import { pool } from "@/lib/db";
import { embedTexts, toPgVectorLiteral } from "@/lib/embeddings";

export interface CategoryMatch {
  key: string;
  label: string;
  similarity: number;
}

export async function ensurePrototypeEmbeddings(): Promise<void> {
  const { rows } = await pool.query<{
    key: string;
    description: string;
    prototype_embedding: string | null;
  }>("SELECT key, description, prototype_embedding FROM spending_categories");

  const unembedded = rows.filter((row) => row.prototype_embedding === null);
  if (unembedded.length === 0) return;

  const embeddings = await embedTexts(unembedded.map((row) => row.description));

  await Promise.all(
    unembedded.map((row, i) =>
      pool.query(
        "UPDATE spending_categories SET prototype_embedding = $1::vector, updated_at = now() WHERE key = $2",
        [toPgVectorLiteral(embeddings[i]), row.key],
      ),
    ),
  );
}

export async function classifyEmbedding(vector: number[]): Promise<CategoryMatch> {
  const literal = toPgVectorLiteral(vector);
  const { rows } = await pool.query<{
    key: string;
    label: string;
    similarity: number;
  }>(
    `SELECT key, label, 1 - (prototype_embedding <=> $1::vector) AS similarity
       FROM spending_categories
      WHERE prototype_embedding IS NOT NULL
      ORDER BY prototype_embedding <=> $1::vector
      LIMIT 1`,
    [literal],
  );

  if (rows.length === 0) {
    throw new Error(
      "No spending category prototype embeddings available — call ensurePrototypeEmbeddings() first",
    );
  }

  return rows[0];
}

export async function upsertClassification(
  messageId: string,
  match: CategoryMatch,
): Promise<void> {
  await pool.query(
    `INSERT INTO gmail_message_classifications (message_id, category_key, similarity)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id) DO UPDATE SET
       category_key = EXCLUDED.category_key,
       similarity = EXCLUDED.similarity,
       classified_at = now()`,
    [messageId, match.key, match.similarity],
  );
}
