import { db } from "../db";
import { newId } from "../lib/ids";

export async function createSubject(
  accountId: string,
  name: string,
  description: string | null,
) {
  const id = newId("subject");
  return db
    .insertInto("subjects")
    .values({ id, account_id: accountId, name, description, status: "pending" })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function listSubjects(accountId: string) {
  return db
    .selectFrom("subjects")
    .selectAll()
    .where("account_id", "=", accountId)
    .orderBy("created_at", "desc")
    .execute();
}

export async function getSubject(accountId: string, id: string) {
  return db
    .selectFrom("subjects")
    .selectAll()
    .where("id", "=", id)
    .where("account_id", "=", accountId)
    .executeTakeFirst();
}

export async function deleteSubject(accountId: string, id: string): Promise<boolean> {
  const res = await db
    .deleteFrom("subjects")
    .where("id", "=", id)
    .where("account_id", "=", accountId)
    .executeTakeFirst();
  return Number(res.numDeletedRows) > 0;
}

export async function setSubjectStatus(id: string, status: string): Promise<void> {
  await db.updateTable("subjects").set({ status }).where("id", "=", id).execute();
}
