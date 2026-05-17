import { db } from "../db";
import { newApiToken, newId } from "../lib/ids";

export async function createAccount(name: string) {
  const id = newId("account");
  const api_token = newApiToken();
  const row = await db
    .insertInto("accounts")
    .values({ id, name, api_token })
    .returningAll()
    .executeTakeFirstOrThrow();
  return row;
}

export async function findByToken(token: string) {
  return db.selectFrom("accounts").selectAll().where("api_token", "=", token).executeTakeFirst();
}
