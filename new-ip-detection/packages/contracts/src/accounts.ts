import { z } from "zod";
import { accountId } from "./common";

export const account = z.object({
  id: accountId,
  name: z.string(),
  api_token: z.string(),
  created_at: z.string(),
});
export type Account = z.infer<typeof account>;

export const createDevAccountRequest = z.object({
  name: z.string().min(1).max(120).default("dev"),
});
export type CreateDevAccountRequest = z.infer<typeof createDevAccountRequest>;
