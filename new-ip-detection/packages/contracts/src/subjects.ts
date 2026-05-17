import { z } from "zod";
import { accountId, subjectId } from "./common";

export const subjectStatus = z.enum(["pending", "indexing", "indexed", "failed"]);
export type SubjectStatus = z.infer<typeof subjectStatus>;

export const subject = z.object({
  id: subjectId,
  account_id: accountId,
  name: z.string(),
  description: z.string().nullable(),
  status: subjectStatus,
  created_at: z.string(),
});
export type Subject = z.infer<typeof subject>;

export const createSubjectRequest = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});
export type CreateSubjectRequest = z.infer<typeof createSubjectRequest>;
