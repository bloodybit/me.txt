import { z } from "zod";

// ID prefixes follow Stripe convention (Decision 6).
export const ID_PREFIXES = {
  account: "acc",
  subject: "sub",
  reference: "ref",
  embedding: "emb",
  scan: "scn",
  detection: "det",
  job: "job",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export const accountId = z.string().regex(/^acc_[a-z0-9]+$/);
export const subjectId = z.string().regex(/^sub_[a-z0-9]+$/);
export const referenceId = z.string().regex(/^ref_[a-z0-9]+$/);
export const scanId = z.string().regex(/^scn_[a-z0-9]+$/);
export const detectionId = z.string().regex(/^det_[a-z0-9]+$/);
export const jobId = z.string().regex(/^job_[a-z0-9]+$/);

export const errorResponse = z.object({ error: z.string() });
export type ErrorResponse = z.infer<typeof errorResponse>;

// All persisted statuses share this enum surface.
export const lifecycleStatus = z.enum(["pending", "processing", "indexed", "failed", "complete"]);
