// Kysely DB client + table types. Embeddings stay as `unknown` here — the
// pgvector column is serialized as a vector literal string in raw SQL where
// it is read/written. Keeping it out of the typed surface avoids confusion
// between `number[]` and the string Postgres returns.

import { Kysely, PostgresDialect, type Generated } from "kysely";
import { Pool } from "pg";
import { env } from "./lib/env";

export interface AccountsTable {
  id: string;
  name: string;
  api_token: string;
  created_at: Generated<Date>;
}

export interface SubjectsTable {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  status: Generated<string>;
  created_at: Generated<Date>;
}

export interface ReferenceImagesTable {
  id: string;
  subject_id: string;
  storage_key: string;
  width: number | null;
  height: number | null;
  status: Generated<string>;
  created_at: Generated<Date>;
}

export interface ReferenceEmbeddingsTable {
  id: string;
  reference_image_id: string;
  subject_id: string;
  model: string;
  dim: number;
  // Stored as pgvector; read as string. Use rawQuery helpers when round-tripping.
  embedding: unknown;
  created_at: Generated<Date>;
}

export interface ScansTable {
  id: string;
  account_id: string;
  query_storage_key: string;
  status: Generated<string>;
  created_at: Generated<Date>;
  completed_at: Date | null;
}

export interface DetectionsTable {
  id: string;
  scan_id: string;
  subject_id: string;
  reference_image_id: string | null;
  score: number;
  confidence: number;
  bbox_x: number | null;
  bbox_y: number | null;
  bbox_w: number | null;
  bbox_h: number | null;
  method: string | null;
  model: string | null;
  created_at: Generated<Date>;
}

export interface JobsTable {
  id: string;
  kind: string;
  status: Generated<string>;
  payload: Generated<unknown>;
  attempts: Generated<number>;
  leased_by: string | null;
  lease_expires_at: Date | null;
  error: string | null;
  created_at: Generated<Date>;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface Database {
  accounts: AccountsTable;
  subjects: SubjectsTable;
  reference_images: ReferenceImagesTable;
  reference_embeddings: ReferenceEmbeddingsTable;
  scans: ScansTable;
  detections: DetectionsTable;
  jobs: JobsTable;
}

export const pool = new Pool({ connectionString: env.databaseUrl, max: 10 });

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});

// Format a number[] as the pgvector text literal: '[1,2,3]'.
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

// pgvector returns vectors as strings shaped like '[1,2,3]'. Parse back to number[].
export function parseVector(value: unknown): number[] {
  if (Array.isArray(value)) return value as number[];
  if (typeof value !== "string") return [];
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .filter(Boolean)
    .map((v) => Number(v));
}
