// Internal API consumed only by the Python worker (Decision 3).
// No auth: this router is only reachable on the in-cluster network in production.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  failRequest,
  indexJobResult,
  leaseRequest,
  scanJobResult,
  succeedRequest,
} from "@ipd/contracts";
import { db } from "../db";
import { failJob, getJob, leaseNext, succeedJob } from "../services/jobs";
import { presignDownload } from "../services/storage";
import {
  listEmbeddingsForAccount,
  storeReferenceEmbedding,
} from "../services/embeddings";
import { getReferenceImage, setReferenceStatus } from "../services/references";
import { setSubjectStatus } from "../services/subjects";
import { persistDetections, setScanStatus } from "../services/scans";

const app = new Hono();

app.post("/jobs/lease", zValidator("json", leaseRequest), async (c) => {
  const { worker_id, lease_seconds, kinds } = c.req.valid("json");
  const job = await leaseNext(worker_id, lease_seconds, kinds);
  if (!job) return c.body(null, 204);
  return c.json(job);
});

app.post("/jobs/:id/succeed", zValidator("json", succeedRequest), async (c) => {
  const id = c.req.param("id");
  const job = await getJob(id);
  if (!job) return c.json({ error: "job not found" }, 404);

  const body = c.req.valid("json");

  if (job.kind === "index_reference") {
    const parsed = indexJobResult.safeParse(body.result);
    if (!parsed.success) {
      return c.json({ error: "invalid index_reference result" }, 400);
    }
    const payload = job.payload as { reference_image_id: string; subject_id: string };
    await storeReferenceEmbedding({
      referenceImageId: payload.reference_image_id,
      subjectId: payload.subject_id,
      model: parsed.data.model,
      dim: parsed.data.dim,
      values: parsed.data.embedding,
    });
    await setReferenceStatus(payload.reference_image_id, "indexed", {
      width: parsed.data.width ?? 0,
      height: parsed.data.height ?? 0,
    });
    // Subject is "indexed" once it has at least one indexed reference.
    await setSubjectStatus(payload.subject_id, "indexed");
  } else if (job.kind === "detect_scan") {
    const parsed = scanJobResult.safeParse(body.result);
    if (!parsed.success) {
      return c.json({ error: "invalid detect_scan result" }, 400);
    }
    const payload = job.payload as { scan_id: string };
    await persistDetections(payload.scan_id, parsed.data.detections);
    await setScanStatus(payload.scan_id, "complete", true);
  }

  await succeedJob(id);
  return c.body(null, 204);
});

app.post("/jobs/:id/fail", zValidator("json", failRequest), async (c) => {
  const id = c.req.param("id");
  const job = await getJob(id);
  if (!job) return c.json({ error: "job not found" }, 404);
  const { error, retry } = c.req.valid("json");

  // Mark the related entity as failed when retries are exhausted.
  if (!retry || job.attempts >= 3) {
    if (job.kind === "index_reference") {
      const payload = job.payload as { reference_image_id: string; subject_id: string };
      await setReferenceStatus(payload.reference_image_id, "failed");
    } else if (job.kind === "detect_scan") {
      const payload = job.payload as { scan_id: string };
      await setScanStatus(payload.scan_id, "failed", true);
    }
  }

  await failJob(id, error, retry);
  return c.body(null, 204);
});

app.get("/index-jobs/:id/context", async (c) => {
  const job = await getJob(c.req.param("id"));
  if (!job || job.kind !== "index_reference") {
    return c.json({ error: "index job not found" }, 404);
  }
  const payload = job.payload as { reference_image_id: string; subject_id: string };
  const ref = await getReferenceImage(payload.reference_image_id);
  if (!ref) return c.json({ error: "reference image missing" }, 404);

  const downloadUrl = await presignDownload(ref.storage_key, 900);
  return c.json({
    job_id: job.id,
    reference_image_id: ref.id,
    subject_id: ref.subject_id,
    download_url: downloadUrl,
    storage_key: ref.storage_key,
  });
});

app.get("/scan-jobs/:id/context", async (c) => {
  const job = await getJob(c.req.param("id"));
  if (!job || job.kind !== "detect_scan") {
    return c.json({ error: "scan job not found" }, 404);
  }
  const payload = job.payload as { scan_id: string };
  const scan = await db
    .selectFrom("scans")
    .selectAll()
    .where("id", "=", payload.scan_id)
    .executeTakeFirst();
  if (!scan) return c.json({ error: "scan not found" }, 404);

  const downloadUrl = await presignDownload(scan.query_storage_key, 900);
  const references = await listEmbeddingsForAccount(scan.account_id);

  // Mark the scan as processing once the worker pulls context.
  await setScanStatus(scan.id, "processing");

  return c.json({
    job_id: job.id,
    scan_id: scan.id,
    download_url: downloadUrl,
    storage_key: scan.query_storage_key,
    references,
  });
});

export default app;
