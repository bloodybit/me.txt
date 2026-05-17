// pgvector round-trip helpers. Embeddings are stored as `vector(768)`; we
// always go through raw SQL when reading/writing so the literal format is
// explicit and stays a single source of truth.

import { sql } from "kysely";
import { db, parseVector, toVectorLiteral } from "../db";
import { newId } from "../lib/ids";

export interface EmbeddingForScan {
  reference_image_id: string;
  subject_id: string;
  subject_name: string;
  model: string;
  embedding: number[];
}

export async function storeReferenceEmbedding(args: {
  referenceImageId: string;
  subjectId: string;
  model: string;
  dim: number;
  values: number[];
}): Promise<string> {
  const id = newId("embedding");
  const literal = toVectorLiteral(args.values);
  await sql`
    INSERT INTO reference_embeddings (id, reference_image_id, subject_id, model, dim, embedding)
    VALUES (${id}, ${args.referenceImageId}, ${args.subjectId}, ${args.model}, ${args.dim}, ${literal}::vector)
  `.execute(db);
  return id;
}

export async function listEmbeddingsForAccount(accountId: string): Promise<EmbeddingForScan[]> {
  // Pull every reference embedding belonging to a subject owned by this account.
  const rows = await sql<{
    reference_image_id: string;
    subject_id: string;
    subject_name: string;
    model: string;
    embedding: string;
  }>`
    SELECT
      e.reference_image_id,
      e.subject_id,
      s.name AS subject_name,
      e.model,
      e.embedding::text AS embedding
    FROM reference_embeddings e
    JOIN subjects s ON s.id = e.subject_id
    WHERE s.account_id = ${accountId}
    ORDER BY e.created_at ASC
  `.execute(db);

  return rows.rows.map((r) => ({
    reference_image_id: r.reference_image_id,
    subject_id: r.subject_id,
    subject_name: r.subject_name,
    model: r.model,
    embedding: parseVector(r.embedding),
  }));
}
