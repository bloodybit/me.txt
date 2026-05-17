import { db } from "../db";
import { newId } from "../lib/ids";

export async function createReferenceImage(
  subjectId: string,
  storageKey: string,
) {
  const id = newId("reference");
  return db
    .insertInto("reference_images")
    .values({ id, subject_id: subjectId, storage_key: storageKey, status: "pending" })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function getReferenceImage(id: string) {
  return db.selectFrom("reference_images").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function listReferencesForSubject(subjectId: string) {
  return db
    .selectFrom("reference_images")
    .selectAll()
    .where("subject_id", "=", subjectId)
    .orderBy("created_at", "asc")
    .execute();
}

export async function setReferenceStatus(
  id: string,
  status: string,
  dims?: { width: number; height: number },
) {
  return db
    .updateTable("reference_images")
    .set({
      status,
      ...(dims ? { width: dims.width, height: dims.height } : {}),
    })
    .where("id", "=", id)
    .execute();
}
