// Public v1 API.
// Flat resource responses (Decision 5). All errors return { error: string }.

import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  createDevAccountRequest,
  createSubjectRequest,
} from "@ipd/contracts";
import { accountId, requireAccount } from "./auth";
import { createAccount } from "../services/accounts";
import {
  createSubject,
  deleteSubject,
  getSubject,
  listSubjects,
} from "../services/subjects";
import { createReferenceImage } from "../services/references";
import { createScan, getScan, listDetections } from "../services/scans";
import { enqueueJob, getJob } from "../services/jobs";
import { putObject, referenceKey, scanKey } from "../services/storage";

const app = new Hono();

// --- dev auth helper (Decision 13: keeps POST /v1/auth/dev for convenience) ---
app.post("/auth/dev", zValidator("json", createDevAccountRequest), async (c) => {
  const { name } = c.req.valid("json");
  const account = await createAccount(name);
  return c.json(account, 201);
});

// --- subjects ---
app.use("/subjects/*", requireAccount);
app.use("/subjects", requireAccount);

app.post("/subjects", zValidator("json", createSubjectRequest), async (c) => {
  const { name, description } = c.req.valid("json");
  const subject = await createSubject(accountId(c), name, description ?? null);
  return c.json(subject, 201);
});

app.get("/subjects", async (c) => {
  const subjects = await listSubjects(accountId(c));
  return c.json(subjects);
});

app.get("/subjects/:id", async (c) => {
  const subject = await getSubject(accountId(c), c.req.param("id"));
  if (!subject) return c.json({ error: "subject not found" }, 404);
  return c.json(subject);
});

app.delete("/subjects/:id", async (c) => {
  const ok = await deleteSubject(accountId(c), c.req.param("id"));
  if (!ok) return c.json({ error: "subject not found" }, 404);
  return c.body(null, 204);
});

// Accepts either a multipart "image" upload or raw image body.
async function readImage(c: Context): Promise<{
  body: Buffer;
  contentType: string;
} | null> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.startsWith("multipart/form-data")) {
    const form = await c.req.formData();
    const file = form.get("image");
    if (!(file instanceof File)) return null;
    return {
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type || "application/octet-stream",
    };
  }
  if (contentType.startsWith("image/") || contentType === "application/octet-stream") {
    const buf = Buffer.from(await c.req.arrayBuffer());
    if (buf.length === 0) return null;
    return { body: buf, contentType };
  }
  return null;
}

app.post("/subjects/:id/references", async (c) => {
  const subjectId = c.req.param("id");
  const subject = await getSubject(accountId(c), subjectId);
  if (!subject) return c.json({ error: "subject not found" }, 404);

  const image = await readImage(c);
  if (!image) return c.json({ error: "expected image upload (multipart or raw image body)" }, 400);

  // Create the DB row first so we have a stable id; the storage key is derived
  // from it (Decision 7 — normalize to .jpg).
  const reference = await createReferenceImage(subject.id, "");
  const key = referenceKey(subject.account_id, subject.id, reference.id);
  await putObject(key, image.body, image.contentType);

  // Persist the deterministic key and kick off the index_reference job.
  const { db } = await import("../db");
  await db
    .updateTable("reference_images")
    .set({ storage_key: key })
    .where("id", "=", reference.id)
    .execute();

  const jobId = await enqueueJob("index_reference", {
    reference_image_id: reference.id,
    subject_id: subject.id,
  });

  return c.json({ reference: { ...reference, storage_key: key }, job_id: jobId }, 201);
});

// --- scans ---
app.use("/scans/*", requireAccount);
app.use("/scans", requireAccount);

app.post("/scans", async (c) => {
  const image = await readImage(c);
  if (!image) return c.json({ error: "expected image upload (multipart or raw image body)" }, 400);

  const scan = await createScan(accountId(c), "");
  const key = scanKey(accountId(c), scan.id);
  await putObject(key, image.body, image.contentType);

  const { db } = await import("../db");
  await db
    .updateTable("scans")
    .set({ query_storage_key: key })
    .where("id", "=", scan.id)
    .execute();

  const jobId = await enqueueJob("detect_scan", { scan_id: scan.id });
  return c.json({ scan: { ...scan, query_storage_key: key }, job_id: jobId }, 201);
});

app.get("/scans/:id", async (c) => {
  const scan = await getScan(accountId(c), c.req.param("id"));
  if (!scan) return c.json({ error: "scan not found" }, 404);
  return c.json(scan);
});

app.get("/scans/:id/detections", async (c) => {
  const scan = await getScan(accountId(c), c.req.param("id"));
  if (!scan) return c.json({ error: "scan not found" }, 404);
  const rows = await listDetections(accountId(c), scan.id);
  return c.json(
    rows.map((r) => ({
      id: r.id,
      scan_id: r.scan_id,
      subject_id: r.subject_id,
      subject_name: r.subject_name,
      reference_image_id: r.reference_image_id,
      score: r.score,
      confidence: r.confidence,
      bbox:
        r.bbox_x !== null && r.bbox_y !== null && r.bbox_w !== null && r.bbox_h !== null
          ? { x: r.bbox_x, y: r.bbox_y, w: r.bbox_w, h: r.bbox_h }
          : null,
      method: r.method,
      model: r.model,
      created_at: r.created_at,
    })),
  );
});

// --- jobs ---
app.use("/jobs/*", requireAccount);
app.get("/jobs/:id", async (c) => {
  const job = await getJob(c.req.param("id"));
  if (!job) return c.json({ error: "job not found" }, 404);
  return c.json(job);
});

export default app;
