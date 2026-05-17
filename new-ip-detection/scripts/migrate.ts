#!/usr/bin/env bun
// Lightweight migration runner.
// Tracks applied migrations in `schema_migrations`. Runs numbered .sql files in order.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "infra", "migrations");
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ipdetection";

async function listMigrationFiles(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith(".sql")).sort();
}

async function ensureSchemaTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedSet(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations ORDER BY filename",
  );
  return new Set(rows.map((r) => r.filename));
}

async function up(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await ensureSchemaTable(pool);
    const applied = await appliedSet(pool);
    const files = await listMigrationFiles();
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log("up-to-date — no pending migrations");
      return;
    }

    for (const file of pending) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`applying ${file}…`);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`  ✓ ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

async function status(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await ensureSchemaTable(pool);
    const applied = await appliedSet(pool);
    const files = await listMigrationFiles();
    for (const file of files) {
      console.log(`${applied.has(file) ? "✓" : " "}  ${file}`);
    }
    const pending = files.filter((f) => !applied.has(f)).length;
    console.log(`\n${applied.size} applied, ${pending} pending`);
  } finally {
    await pool.end();
  }
}

async function create(name: string): Promise<void> {
  if (!name) {
    console.error("usage: migrate create <name>");
    process.exit(1);
  }
  const files = await listMigrationFiles();
  const next = files.length
    ? String(Number(files[files.length - 1]!.slice(0, 3)) + 1).padStart(3, "0")
    : "001";
  const slug = name.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const filename = `${next}_${slug}.sql`;
  await writeFile(join(MIGRATIONS_DIR, filename), `-- ${name}\n`);
  console.log(`created ${filename}`);
}

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case "up":
    await up();
    break;
  case "status":
    await status();
    break;
  case "create":
    await create(rest.join(" "));
    break;
  default:
    console.error("usage: migrate up | status | create <name>");
    process.exit(1);
}
