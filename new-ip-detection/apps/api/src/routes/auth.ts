// Bearer-token auth (Decision 13). Static API token per account, validated
// against the accounts.api_token column. Sets `c.var.accountId` for handlers.

import type { Context, MiddlewareHandler } from "hono";
import { findByToken } from "../services/accounts";

declare module "hono" {
  interface ContextVariableMap {
    accountId: string;
  }
}

export const requireAccount: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return c.json({ error: "missing or malformed Authorization header" }, 401);
  const account = await findByToken(match[1]!.trim());
  if (!account) return c.json({ error: "invalid api token" }, 401);
  c.set("accountId", account.id);
  await next();
};

export function accountId(c: Context): string {
  return c.get("accountId");
}
