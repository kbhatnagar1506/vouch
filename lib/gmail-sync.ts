// Adapted from aaditisinghal/vouch-aaditi's src/lib/gmail-sync.ts
// (commit 55eedf7) — only the db import changed (named `pool` export here,
// vs. a default export there). Everything else, including
// getGmailClientForUser from this repo's own lib/google.ts, matches by name
// already.
import { pool } from "@/lib/db";
import { getGmailClientForUser } from "@/lib/google";
import { buildSearchQuery } from "@/lib/gmail-query";
import {
  extractPlainTextBody,
  extractHeader,
  extractMerchant,
  extractAmountCents,
} from "@/lib/gmail-body";
import { chunkText } from "@/lib/chunking";
import { embedTexts, meanPool, toPgVectorLiteral } from "@/lib/embeddings";
import {
  ensurePrototypeEmbeddings,
  classifyEmbedding,
  upsertClassification,
} from "@/lib/spending-categories";
import { createMemory } from "@/lib/memory/store";
import { ensureBackboardAssistant, addMemory as addBackboardMemory } from "@/lib/backboard";

const DEFAULT_MAX_MESSAGES = 300;
const PAGE_SIZE = 100;
const WATERMARK_OVERLAP_SECONDS = 60 * 60;

export interface SyncOptions {
  sinceUnixSeconds: number;
  maxMessages?: number;
}

export interface SyncError {
  gmailMessageId: string;
  error: string;
}

export interface SyncResult {
  userId: string;
  connected: boolean;
  fetched: number;
  imported: number;
  skippedEmptyBody: number;
  classified: number;
  memoriesWritten: number;
  backboardMemoriesWritten: number;
  backboardMemoriesSkipped: number;
  errors: SyncError[];
}

/**
 * Pushes a classified message into the memory subsystem (lib/memory) so
 * it gets deduplication, bitemporal versioning and hybrid search for free.
 * Failure here must never undo the gmail_messages import that already
 * succeeded -- it's recorded as its own error and the sync moves on.
 */
async function writeToMemory(
  userId: string,
  gmailMessageId: string,
  params: {
    bodyText: string;
    merchant: string | null;
    amountCents: number | null;
    receivedAt: Date | null;
    categoryKey?: string;
    similarity?: number;
  },
  result: SyncResult,
): Promise<void> {
  try {
    await createMemory(userId, {
      content: params.bodyText,
      source: "gmail",
      tags: params.categoryKey ? [params.categoryKey] : [],
      metadata: {
        gmailMessageId,
        merchant: params.merchant,
        amountCents: params.amountCents,
        categoryKey: params.categoryKey ?? null,
        similarity: params.similarity ?? null,
      },
      occurredAt: params.receivedAt ?? new Date(),
    });
    result.memoriesWritten += 1;
  } catch (err) {
    result.errors.push({
      gmailMessageId,
      error: `memory write failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/**
 * Mirrors a classified message into Backboard's persistent memory (one
 * Backboard assistant per Vouch user, created lazily). Independent of, and
 * just as non-fatal as, writeToMemory -- a Backboard outage never undoes the
 * gmail_messages import or the local memory write that already succeeded.
 *
 * Backboard's own /memories endpoint has no dedup of its own, so a re-sync
 * would otherwise re-push every message ever seen on every run.
 * gmail_messages.backboard_memory_id (migration 0013) tracks what's already
 * been pushed; once set for a message, this is a permanent no-op for it.
 */
async function writeToBackboard(
  userId: string,
  gmailMessageId: string,
  params: {
    bodyText: string;
    merchant: string | null;
    amountCents: number | null;
    categoryKey?: string;
    similarity?: number;
  },
  result: SyncResult,
): Promise<void> {
  if (!process.env.BACKBOARD_API_KEY) return;

  try {
    const existing = await pool.query<{ backboard_memory_id: string | null }>(
      "SELECT backboard_memory_id FROM gmail_messages WHERE user_id = $1 AND gmail_message_id = $2",
      [userId, gmailMessageId],
    );
    if (existing.rows[0]?.backboard_memory_id) {
      result.backboardMemoriesSkipped += 1;
      return;
    }

    const assistantId = await ensureBackboardAssistant(userId);
    const memory = await addBackboardMemory(assistantId, params.bodyText, {
      gmailMessageId,
      merchant: params.merchant,
      amountCents: params.amountCents,
      categoryKey: params.categoryKey ?? null,
      similarity: params.similarity ?? null,
    });
    await pool.query(
      "UPDATE gmail_messages SET backboard_memory_id = $1 WHERE user_id = $2 AND gmail_message_id = $3",
      [memory.id, userId, gmailMessageId],
    );
    result.backboardMemoriesWritten += 1;
  } catch (err) {
    result.errors.push({
      gmailMessageId,
      error: `backboard write failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

export function computeWatermark(
  sinceUnixSeconds: number,
  receivedTimestampsMs: number[],
  overlapSeconds: number = WATERMARK_OVERLAP_SECONDS,
): number {
  if (receivedTimestampsMs.length === 0) return sinceUnixSeconds;
  const maxReceivedSeconds = Math.floor(Math.max(...receivedTimestampsMs) / 1000);
  return Math.max(sinceUnixSeconds, maxReceivedSeconds - overlapSeconds);
}

export async function syncGmailForUser(
  userId: string,
  opts: SyncOptions,
): Promise<SyncResult> {
  const maxMessages = opts.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const result: SyncResult = {
    userId,
    connected: false,
    fetched: 0,
    imported: 0,
    skippedEmptyBody: 0,
    classified: 0,
    memoriesWritten: 0,
    backboardMemoriesWritten: 0,
    backboardMemoriesSkipped: 0,
    errors: [],
  };

  const client = await getGmailClientForUser(userId);
  if (!client) return result;
  result.connected = true;

  await ensurePrototypeEmbeddings();

  const q = buildSearchQuery(opts.sinceUnixSeconds);
  const messageIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const list = await client.gmail.users.messages.list({
      userId: "me",
      q,
      pageToken,
      maxResults: PAGE_SIZE,
    });
    for (const m of list.data.messages ?? []) {
      if (m.id) messageIds.push(m.id);
    }
    pageToken = list.data.nextPageToken ?? undefined;
  } while (pageToken && messageIds.length < maxMessages);

  const capped = messageIds.slice(0, maxMessages);
  result.fetched = capped.length;

  const receivedTimestampsMs: number[] = [];

  for (const gmailMessageId of capped) {
    try {
      const { data } = await client.gmail.users.messages.get({
        userId: "me",
        id: gmailMessageId,
        format: "full",
      });

      const headers = data.payload?.headers ?? undefined;
      const subject = extractHeader(headers, "Subject");
      const fromHeader = extractHeader(headers, "From");
      const merchant = extractMerchant(fromHeader);
      const bodyText = extractPlainTextBody(data.payload ?? undefined);
      const amountCents = extractAmountCents(bodyText);
      const receivedAt = data.internalDate
        ? new Date(Number(data.internalDate))
        : null;

      if (receivedAt) receivedTimestampsMs.push(receivedAt.getTime());

      const chunks = chunkText(bodyText);

      if (chunks.length === 0) {
        const inserted = await pool.query<{ id: string }>(
          `INSERT INTO gmail_messages
             (user_id, gmail_message_id, gmail_thread_id, subject, from_header,
              merchant, amount_cents, received_at, body_text, embedding, chunk_count)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,0)
           ON CONFLICT (user_id, gmail_message_id) DO UPDATE SET
             gmail_thread_id = EXCLUDED.gmail_thread_id,
             subject = EXCLUDED.subject,
             from_header = EXCLUDED.from_header,
             merchant = EXCLUDED.merchant,
             amount_cents = EXCLUDED.amount_cents,
             received_at = EXCLUDED.received_at,
             body_text = EXCLUDED.body_text,
             embedding = NULL,
             chunk_count = 0,
             updated_at = now()
           RETURNING id`,
          [
            userId,
            gmailMessageId,
            data.threadId ?? null,
            subject,
            fromHeader,
            merchant,
            amountCents,
            receivedAt,
            bodyText,
          ],
        );
        void inserted;
        result.imported += 1;
        result.skippedEmptyBody += 1;
        continue;
      }

      const chunkEmbeddings = await embedTexts(chunks.map((c) => c.text));
      const messageEmbedding = meanPool(chunkEmbeddings);

      const messageRow = await pool.query<{ id: string }>(
        `INSERT INTO gmail_messages
           (user_id, gmail_message_id, gmail_thread_id, subject, from_header,
            merchant, amount_cents, received_at, body_text, embedding, chunk_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector,$11)
         ON CONFLICT (user_id, gmail_message_id) DO UPDATE SET
           gmail_thread_id = EXCLUDED.gmail_thread_id,
           subject = EXCLUDED.subject,
           from_header = EXCLUDED.from_header,
           merchant = EXCLUDED.merchant,
           amount_cents = EXCLUDED.amount_cents,
           received_at = EXCLUDED.received_at,
           body_text = EXCLUDED.body_text,
           embedding = EXCLUDED.embedding,
           chunk_count = EXCLUDED.chunk_count,
           updated_at = now()
         RETURNING id`,
        [
          userId,
          gmailMessageId,
          data.threadId ?? null,
          subject,
          fromHeader,
          merchant,
          amountCents,
          receivedAt,
          bodyText,
          toPgVectorLiteral(messageEmbedding),
          chunks.length,
        ],
      );

      const messageId = messageRow.rows[0].id;

      for (let i = 0; i < chunks.length; i++) {
        await pool.query(
          `INSERT INTO gmail_message_chunks (message_id, chunk_index, chunk_text, embedding)
           VALUES ($1,$2,$3,$4::vector)
           ON CONFLICT (message_id, chunk_index) DO UPDATE SET
             chunk_text = EXCLUDED.chunk_text,
             embedding = EXCLUDED.embedding`,
          [messageId, chunks[i].index, chunks[i].text, toPgVectorLiteral(chunkEmbeddings[i])],
        );
      }

      const match = await classifyEmbedding(messageEmbedding);
      await upsertClassification(messageId, match);

      result.imported += 1;
      result.classified += 1;

      // Classification (the "filter system") has to finish first -- both
      // writes below tag themselves with its output (categoryKey/similarity).
      // But the two writes are independent of each other (different
      // systems, different failure modes, each already self-contained and
      // non-fatal -- see writeToMemory/writeToBackboard above), so running
      // them concurrently instead of one-after-another is free concurrency
      // that meaningfully speeds up a first sync's few hundred messages.
      await Promise.all([
        writeToMemory(
          userId,
          gmailMessageId,
          { bodyText, merchant, amountCents, receivedAt, categoryKey: match.key, similarity: match.similarity },
          result,
        ),
        writeToBackboard(
          userId,
          gmailMessageId,
          { bodyText, merchant, amountCents, categoryKey: match.key, similarity: match.similarity },
          result,
        ),
      ]);
    } catch (err) {
      result.errors.push({
        gmailMessageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const newWatermark = computeWatermark(opts.sinceUnixSeconds, receivedTimestampsMs);
  await pool.query(
    "UPDATE gmail_connections SET last_synced_at = to_timestamp($1) WHERE user_id = $2",
    [newWatermark, userId],
  );

  return result;
}
