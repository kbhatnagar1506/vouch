#!/usr/bin/env node
// Minimal migration runner: applies migrations/*.sql in filename order,
// tracking what's been applied in a `_migrations` table (shared with any
// sibling service's migrations against the same DB — tracked by filename,
// so distinct branches' migration files never collide).
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10_000 });

  try {
    await pool.query(`
      create table if not exists _migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    const { rows: applied } = await pool.query("select name from _migrations");
    const appliedNames = new Set(applied.map((r) => r.name));

    for (const file of files) {
      if (appliedNames.has(file)) {
        console.log(`skip  ${file} (already applied)`);
        continue;
      }
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      console.log(`apply ${file}`);
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into _migrations (name) values ($1)", [file]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : error}`);
      } finally {
        client.release();
      }
    }
    console.log("Done.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
