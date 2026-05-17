// Postgres-backed job queue. Worker leases pending/expired rows with
// FOR UPDATE SKIP LOCKED so multiple workers (future) never collide.

import { sql } from "kysely";
import { db } from "../db";
import { newId } from "../lib/ids";

export type JobPayload = Record<string, unknown>;

export async function enqueueJob(kind: string, payload: JobPayload): Promise<string> {
  const id = newId("job");
  await db
    .insertInto("jobs")
    .values({
      id,
      kind,
      status: "pending",
      payload: JSON.stringify(payload) as unknown as object,
      attempts: 0,
    })
    .execute();
  return id;
}

export async function getJob(id: string) {
  return db.selectFrom("jobs").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function leaseNext(
  workerId: string,
  leaseSeconds: number,
  kinds?: string[],
) {
  // Two-step: pick a candidate via SELECT FOR UPDATE SKIP LOCKED, then UPDATE it
  // inside the same transaction. Kysely doesn't expose SKIP LOCKED on UPDATE directly,
  // so we fall back to raw SQL for the lock acquisition.
  return db.transaction().execute(async (trx) => {
    const kindsFilter = kinds && kinds.length > 0
      ? sql`AND kind = ANY(${sql.lit(kinds)}::text[])`
      : sql``;

    const picked = await sql<{ id: string }>`
      SELECT id FROM jobs
      WHERE (status = 'pending'
             OR (status = 'leased' AND lease_expires_at < now()))
            ${kindsFilter}
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `.execute(trx);

    const id = picked.rows[0]?.id;
    if (!id) return null;

    const leased = await trx
      .updateTable("jobs")
      .set({
        status: "leased",
        leased_by: workerId,
        lease_expires_at: sql`now() + (${leaseSeconds} || ' seconds')::interval`,
        attempts: sql`attempts + 1`,
        started_at: sql`COALESCE(started_at, now())`,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();

    return leased;
  });
}

export async function succeedJob(id: string): Promise<void> {
  await db
    .updateTable("jobs")
    .set({
      status: "succeeded",
      completed_at: sql`now()`,
      lease_expires_at: null,
      error: null,
    })
    .where("id", "=", id)
    .execute();
}

const MAX_ATTEMPTS = 3;

export async function failJob(id: string, error: string, retry: boolean): Promise<void> {
  const job = await getJob(id);
  if (!job) return;
  const shouldRetry = retry && job.attempts < MAX_ATTEMPTS;
  await db
    .updateTable("jobs")
    .set({
      status: shouldRetry ? "pending" : "failed",
      leased_by: null,
      lease_expires_at: null,
      completed_at: shouldRetry ? null : sql`now()`,
      error,
    })
    .where("id", "=", id)
    .execute();
}
