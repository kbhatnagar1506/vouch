// Ported verbatim from aaditisinghal/vouch-aaditi's src/lib/memory/store.ts
// (commit 55eedf7). userId is now a plain TEXT user id (not a UUID string)
// throughout, but every query here already binds it as an opaque parameter
// rather than casting it to ::uuid, so no query changes were needed — only
// the memories.id / memory_relations.source_id / target_id columns (still
// UUID) get an explicit ::uuid[] cast, and those are unchanged.
import { createHash } from "crypto";
import type { PoolClient } from "pg";
import { withUserScope } from "@/lib/memory/tenant";
import { chunkText } from "@/lib/chunking";
import { embedTexts, toPgVectorLiteral } from "@/lib/embeddings";

export type MemoryStatus = "active" | "superseded" | "archived";
export type RelationType = "supersedes" | "contradicts" | "derived_from" | "references";

export interface Memory {
  id: string;
  userId: string;
  content: string;
  summary: string;
  metadata: Record<string, unknown>;
  tags: string[];
  source: string;
  status: MemoryStatus;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
  contentSha256: string;
  version: number;
}

export interface MemoryVersion {
  version: number;
  content: string;
  summary: string;
  metadata: Record<string, unknown>;
  tags: string[];
  source: string;
  status: MemoryStatus;
  occurredAt: Date;
  validFrom: Date;
  validTo: Date | null;
}

export interface CreateMemoryInput {
  content: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  source?: string;
  occurredAt?: Date;
}

export interface UpdateMemoryInput {
  content?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
  source?: string;
  occurredAt?: Date;
}

export interface CreateMemoryResult {
  created: boolean;
  memory: Memory;
}

export interface Lineage {
  memoryId: string;
  /** What this memory replaced, transitively. First hop first. */
  ancestors: string[];
  /** What replaced this memory, transitively. First hop first. */
  successors: string[];
  isCurrent: boolean;
  head: string;
}

interface MemoryRow {
  id: string;
  user_id: string;
  content: string;
  summary: string;
  metadata: Record<string, unknown>;
  tags: string[];
  source: string;
  status: MemoryStatus;
  occurred_at: Date;
  created_at: Date;
  updated_at: Date;
  content_sha256: string;
  version: number;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    summary: row.summary,
    metadata: row.metadata,
    tags: row.tags,
    source: row.source,
    status: row.status,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contentSha256: row.content_sha256,
    version: row.version,
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function insertChunks(
  client: PoolClient,
  userId: string,
  memoryId: string,
  content: string,
): Promise<number> {
  const chunks = chunkText(content);
  if (chunks.length === 0) return 0;

  const embeddings = await embedTexts(chunks.map((c) => c.text));
  for (let i = 0; i < chunks.length; i++) {
    await client.query(
      `INSERT INTO memory_chunks (memory_id, user_id, ordinal, chunk_text, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (memory_id, ordinal) DO UPDATE SET
         chunk_text = EXCLUDED.chunk_text,
         embedding = EXCLUDED.embedding`,
      [memoryId, userId, chunks[i].index, chunks[i].text, toPgVectorLiteral(embeddings[i])],
    );
  }
  return chunks.length;
}

async function insertVersionRow(
  client: PoolClient,
  userId: string,
  memory: Memory,
): Promise<void> {
  await client.query(
    `INSERT INTO memory_versions
       (memory_id, user_id, version, content, summary, metadata, tags, source,
        status, occurred_at, valid_from, valid_to)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), NULL)`,
    [
      memory.id,
      userId,
      memory.version,
      memory.content,
      memory.summary,
      memory.metadata,
      memory.tags,
      memory.source,
      memory.status,
      memory.occurredAt,
    ],
  );
}

export async function createMemory(
  userId: string,
  input: CreateMemoryInput,
): Promise<CreateMemoryResult> {
  const contentSha256 = sha256(input.content);

  return withUserScope(userId, async (client) => {
    const existing = await client.query<MemoryRow>(
      `SELECT * FROM memories WHERE user_id = $1 AND content_sha256 = $2 AND status = 'active' LIMIT 1`,
      [userId, contentSha256],
    );
    if (existing.rows.length > 0) {
      return { created: false, memory: rowToMemory(existing.rows[0]) };
    }

    const inserted = await client.query<MemoryRow>(
      `INSERT INTO memories
         (user_id, content, summary, metadata, tags, source, occurred_at, content_sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        userId,
        input.content,
        input.summary ?? "",
        input.metadata ?? {},
        input.tags ?? [],
        input.source ?? "",
        input.occurredAt ?? new Date(),
        contentSha256,
      ],
    );
    const memory = rowToMemory(inserted.rows[0]);

    await insertChunks(client, userId, memory.id, memory.content);
    await insertVersionRow(client, userId, memory);

    return { created: true, memory };
  });
}

export async function updateMemory(
  userId: string,
  memoryId: string,
  patch: UpdateMemoryInput,
): Promise<Memory> {
  return withUserScope(userId, async (client) => {
    const current = await client.query<MemoryRow>(
      `SELECT * FROM memories WHERE id = $1 AND user_id = $2`,
      [memoryId, userId],
    );
    if (current.rows.length === 0) {
      throw new Error(`memory not found: ${memoryId}`);
    }
    const before = rowToMemory(current.rows[0]);

    const contentChanged = patch.content !== undefined && patch.content !== before.content;
    const nextContent = patch.content ?? before.content;
    const nextContentSha256 = contentChanged ? sha256(nextContent) : before.contentSha256;

    await client.query(
      `UPDATE memory_versions SET valid_to = now() WHERE memory_id = $1 AND valid_to IS NULL`,
      [memoryId],
    );

    const updated = await client.query<MemoryRow>(
      `UPDATE memories SET
         content = $1, summary = $2, metadata = $3, tags = $4, source = $5,
         occurred_at = $6, content_sha256 = $7, version = version + 1, updated_at = now()
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [
        nextContent,
        patch.summary ?? before.summary,
        patch.metadata ?? before.metadata,
        patch.tags ?? before.tags,
        patch.source ?? before.source,
        patch.occurredAt ?? before.occurredAt,
        nextContentSha256,
        memoryId,
        userId,
      ],
    );
    const memory = rowToMemory(updated.rows[0]);

    await insertVersionRow(client, userId, memory);

    if (contentChanged) {
      await client.query(`DELETE FROM memory_chunks WHERE memory_id = $1`, [memoryId]);
      await insertChunks(client, userId, memoryId, memory.content);
    }

    return memory;
  });
}

export async function getMemory(userId: string, memoryId: string): Promise<Memory | null> {
  return withUserScope(userId, async (client) => {
    const result = await client.query<MemoryRow>(
      `SELECT * FROM memories WHERE id = $1 AND user_id = $2`,
      [memoryId, userId],
    );
    return result.rows.length > 0 ? rowToMemory(result.rows[0]) : null;
  });
}

export async function getMemoriesByIds(userId: string, memoryIds: string[]): Promise<Memory[]> {
  if (memoryIds.length === 0) return [];
  return withUserScope(userId, async (client) => {
    const result = await client.query<MemoryRow>(
      `SELECT * FROM memories WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, memoryIds],
    );
    return result.rows.map(rowToMemory);
  });
}

export async function getMemoryAsOf(
  userId: string,
  memoryId: string,
  asOf: Date,
): Promise<MemoryVersion | null> {
  return withUserScope(userId, async (client) => {
    const result = await client.query(
      `SELECT * FROM memory_versions
       WHERE memory_id = $1 AND user_id = $2
         AND valid_from <= $3 AND (valid_to IS NULL OR valid_to > $3)
       ORDER BY valid_from DESC LIMIT 1`,
      [memoryId, userId, asOf],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      version: row.version,
      content: row.content,
      summary: row.summary,
      metadata: row.metadata,
      tags: row.tags,
      source: row.source,
      status: row.status,
      occurredAt: row.occurred_at,
      validFrom: row.valid_from,
      validTo: row.valid_to,
    };
  });
}

async function upsertRelation(
  client: PoolClient,
  userId: string,
  sourceId: string,
  targetId: string,
  type: RelationType,
  reason: string,
): Promise<void> {
  await client.query(
    `INSERT INTO memory_relations (user_id, source_id, target_id, type, reason)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, source_id, target_id, type) DO UPDATE SET reason = EXCLUDED.reason`,
    [userId, sourceId, targetId, type, reason],
  );
}

/** `newMemoryId` supersedes `replacesMemoryId`: the old memory is flipped to `superseded`. */
export async function supersede(
  userId: string,
  newMemoryId: string,
  replacesMemoryId: string,
  reason = "",
): Promise<void> {
  await withUserScope(userId, async (client) => {
    await upsertRelation(client, userId, newMemoryId, replacesMemoryId, "supersedes", reason);
    await client.query(
      `UPDATE memories SET status = 'superseded', updated_at = now() WHERE id = $1 AND user_id = $2`,
      [replacesMemoryId, userId],
    );
  });
}

/** Symmetric: neither memory is hidden. An agent told two facts disagree can ask; one handed a winner cannot. */
export async function contradict(
  userId: string,
  memoryIdA: string,
  memoryIdB: string,
  reason = "",
): Promise<void> {
  await withUserScope(userId, async (client) => {
    await upsertRelation(client, userId, memoryIdA, memoryIdB, "contradicts", reason);
    await upsertRelation(client, userId, memoryIdB, memoryIdA, "contradicts", reason);
  });
}

/** For provenance (`derived_from`) or a soft mention (`references`). */
export async function link(
  userId: string,
  sourceId: string,
  targetId: string,
  type: Extract<RelationType, "derived_from" | "references">,
  reason = "",
): Promise<void> {
  await withUserScope(userId, (client) => upsertRelation(client, userId, sourceId, targetId, type, reason));
}

export async function getLineage(userId: string, memoryId: string): Promise<Lineage> {
  return withUserScope(userId, async (client) => {
    async function walk(startId: string, direction: "ancestors" | "successors"): Promise<string[]> {
      const column = direction === "ancestors" ? "source_id" : "target_id";
      const otherColumn = direction === "ancestors" ? "target_id" : "source_id";
      const visited = new Set<string>([startId]);
      const chain: string[] = [];
      let cursor = startId;

      // Transitive walk, not a single hop: a fact two revisions out of date
      // must still resolve to the true head/root.
      for (;;) {
        const result = await client.query(
          `SELECT ${otherColumn} AS next_id FROM memory_relations
           WHERE user_id = $1 AND ${column} = $2 AND type = 'supersedes' LIMIT 1`,
          [userId, cursor],
        );
        if (result.rows.length === 0) break;
        const nextId = result.rows[0].next_id as string;
        if (visited.has(nextId)) break;
        visited.add(nextId);
        chain.push(nextId);
        cursor = nextId;
      }
      return chain;
    }

    const ancestors = await walk(memoryId, "ancestors");
    const successors = await walk(memoryId, "successors");

    return {
      memoryId,
      ancestors,
      successors,
      isCurrent: successors.length === 0,
      head: successors.length > 0 ? successors[successors.length - 1] : memoryId,
    };
  });
}
