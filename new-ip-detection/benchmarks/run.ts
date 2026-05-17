#!/usr/bin/env bun
// End-to-end benchmark harness.
// Walks the full customer flow against a running stack:
//   create account → register subjects → upload references → wait for index
//   → upload query images → wait for scan → collect detections + latency
// Emits a single JSON summary on stdout.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const API_URL = process.env.API_URL ?? "http://localhost:8080";
const FIXTURES = join(import.meta.dir, "..", "tests", "fixtures");
const TIMEOUT_MS = Number(process.env.BENCHMARK_TIMEOUT_MS ?? "60000");

interface Subject {
  id: string;
  name: string;
}

async function api<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function uploadImage<T>(
  endpoint: string,
  token: string,
  filepath: string,
): Promise<T> {
  const body = await readFile(filepath);
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" },
    body,
  });
  if (!res.ok) throw new Error(`${endpoint} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function waitForJob(
  token: string,
  jobId: string,
): Promise<{ status: string; elapsed_ms: number }> {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    const job = await api<{ status: string }>(`/v1/jobs/${jobId}`, { token });
    if (job.status === "succeeded" || job.status === "failed") {
      return { status: job.status, elapsed_ms: Date.now() - start };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for job ${jobId}`);
}

async function main(): Promise<void> {
  const summary: Record<string, unknown> = { api_url: API_URL };
  const t0 = Date.now();

  const account = await api<{ id: string; api_token: string }>("/v1/auth/dev", {
    method: "POST",
    body: JSON.stringify({ name: "bench" }),
  });
  summary.account_id = account.id;

  const subjects: Subject[] = [];
  for (const name of ["Acme Logo", "Rocket Mascot"]) {
    const created = await api<Subject>("/v1/subjects", {
      method: "POST",
      token: account.api_token,
      body: JSON.stringify({ name }),
    });
    subjects.push(created);
  }

  const refDir = join(FIXTURES, "references");
  const refFiles = (await readdir(refDir)).filter((f) => /\.(jpe?g|png)$/i.test(f));
  const indexLatencies: number[] = [];
  for (let i = 0; i < refFiles.length; i++) {
    const subject = subjects[i % subjects.length]!;
    const { job_id } = await uploadImage<{ job_id: string }>(
      `/v1/subjects/${subject.id}/references`,
      account.api_token,
      join(refDir, refFiles[i]!),
    );
    const { elapsed_ms, status } = await waitForJob(account.api_token, job_id);
    if (status !== "succeeded") throw new Error(`index_reference failed for ${refFiles[i]}`);
    indexLatencies.push(elapsed_ms);
  }

  const queryDir = join(FIXTURES, "queries");
  let queryFiles: string[] = [];
  try {
    queryFiles = (await readdir(queryDir)).filter((f) => /\.(jpe?g|png)$/i.test(f));
  } catch {
    queryFiles = [];
  }

  const scanResults: Array<{
    file: string;
    scan_id: string;
    job_elapsed_ms: number;
    detections: number;
    top_score: number;
  }> = [];

  for (const file of queryFiles) {
    const upload = await uploadImage<{ scan: { id: string }; job_id: string }>(
      "/v1/scans",
      account.api_token,
      join(queryDir, file),
    );
    const { status, elapsed_ms } = await waitForJob(account.api_token, upload.job_id);
    if (status !== "succeeded") throw new Error(`detect_scan failed for ${file}`);
    const detections = await api<Array<{ score: number }>>(
      `/v1/scans/${upload.scan.id}/detections`,
      { token: account.api_token },
    );
    const topScore = detections.length ? Math.max(...detections.map((d) => d.score)) : 0;
    scanResults.push({
      file,
      scan_id: upload.scan.id,
      job_elapsed_ms: elapsed_ms,
      detections: detections.length,
      top_score: topScore,
    });
  }

  summary.totals = {
    references_indexed: indexLatencies.length,
    scans_completed: scanResults.length,
    wall_clock_ms: Date.now() - t0,
  };
  summary.index_latency_ms = stats(indexLatencies);
  summary.scan_latency_ms = stats(scanResults.map((r) => r.job_elapsed_ms));
  summary.detections_per_scan = stats(scanResults.map((r) => r.detections));
  summary.top_score_per_scan = stats(scanResults.map((r) => r.top_score));
  summary.scans = scanResults;

  console.log(JSON.stringify(summary, null, 2));
}

function stats(values: number[]): Record<string, number> {
  if (values.length === 0) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)]!,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
