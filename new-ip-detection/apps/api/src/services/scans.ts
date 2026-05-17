import { sql } from "kysely";
import { db } from "../db";
import { newId } from "../lib/ids";

export async function createScan(accountId: string, queryStorageKey: string) {
  const id = newId("scan");
  return db
    .insertInto("scans")
    .values({
      id,
      account_id: accountId,
      query_storage_key: queryStorageKey,
      status: "pending",
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function getScan(accountId: string, id: string) {
  return db
    .selectFrom("scans")
    .selectAll()
    .where("id", "=", id)
    .where("account_id", "=", accountId)
    .executeTakeFirst();
}

export async function setScanStatus(id: string, status: string, complete = false) {
  return db
    .updateTable("scans")
    .set({
      status,
      ...(complete ? { completed_at: sql`now()` } : {}),
    })
    .where("id", "=", id)
    .execute();
}

export async function listDetections(accountId: string, scanId: string) {
  return db
    .selectFrom("detections as d")
    .innerJoin("scans as s", "s.id", "d.scan_id")
    .innerJoin("subjects as sub", "sub.id", "d.subject_id")
    .select([
      "d.id",
      "d.scan_id",
      "d.subject_id",
      "sub.name as subject_name",
      "d.reference_image_id",
      "d.score",
      "d.confidence",
      "d.bbox_x",
      "d.bbox_y",
      "d.bbox_w",
      "d.bbox_h",
      "d.method",
      "d.model",
      "d.created_at",
    ])
    .where("d.scan_id", "=", scanId)
    .where("s.account_id", "=", accountId)
    .orderBy("d.score", "desc")
    .execute();
}

export async function persistDetections(
  scanId: string,
  detections: Array<{
    subject_id: string;
    reference_image_id: string | null;
    score: number;
    confidence: number;
    bbox: { x: number; y: number; w: number; h: number } | null;
    method: string;
    model: string;
  }>,
): Promise<void> {
  if (detections.length === 0) return;
  const rows = detections.map((d) => ({
    id: newId("detection"),
    scan_id: scanId,
    subject_id: d.subject_id,
    reference_image_id: d.reference_image_id,
    score: d.score,
    confidence: d.confidence,
    bbox_x: d.bbox?.x ?? null,
    bbox_y: d.bbox?.y ?? null,
    bbox_w: d.bbox?.w ?? null,
    bbox_h: d.bbox?.h ?? null,
    method: d.method,
    model: d.model,
  }));
  await db.insertInto("detections").values(rows).execute();
}
