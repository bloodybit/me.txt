#!/usr/bin/env bun
// Seed (Decision 11): creates a dev account, two subjects, and uploads
// reference images from tests/fixtures/. The `index_reference` jobs are
// created automatically by the API when references are uploaded.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const API_URL = process.env.API_URL ?? "http://localhost:8080";
const FIXTURES = join(import.meta.dir, "..", "tests", "fixtures");

async function jsonRequest<T>(path: string, init: RequestInit & { token?: string }): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.body && !(init.body instanceof FormData) && typeof init.body !== "string") {
    headers.set("Content-Type", "application/json");
  } else if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}

async function uploadImage(
  token: string,
  subjectId: string,
  filename: string,
): Promise<{ reference: { id: string }; job_id: string }> {
  const body = await readFile(join(FIXTURES, "references", filename));
  const res = await fetch(`${API_URL}/v1/subjects/${subjectId}/references`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "image/jpeg",
    },
    body,
  });
  if (!res.ok) throw new Error(`upload ${filename}: ${res.status} ${await res.text()}`);
  return (await res.json()) as { reference: { id: string }; job_id: string };
}

async function main(): Promise<void> {
  console.log(`[seed] using API at ${API_URL}`);

  const account = await jsonRequest<{ id: string; api_token: string }>("/v1/auth/dev", {
    method: "POST",
    body: JSON.stringify({ name: "dev" }),
  });
  console.log(`[seed] account ${account.id} token=${account.api_token}`);

  const subjects: Array<{ id: string; name: string; references: string[] }> = [
    { id: "", name: "Acme Logo", references: [] },
    { id: "", name: "Rocket Mascot", references: [] },
  ];

  for (const s of subjects) {
    const created = await jsonRequest<{ id: string }>("/v1/subjects", {
      method: "POST",
      token: account.api_token,
      body: JSON.stringify({ name: s.name }),
    });
    s.id = created.id;
    console.log(`[seed] subject ${s.id} (${s.name})`);
  }

  let fixtureFiles: string[] = [];
  try {
    fixtureFiles = (await readdir(join(FIXTURES, "references"))).filter((f) =>
      /\.(jpg|jpeg|png)$/i.test(f),
    );
  } catch {
    console.warn(`[seed] no fixtures at ${FIXTURES}/references — skipping uploads`);
    return;
  }

  // Round-robin distribute fixtures across the two subjects.
  for (let i = 0; i < fixtureFiles.length; i++) {
    const subject = subjects[i % subjects.length]!;
    const filename = fixtureFiles[i]!;
    const { reference, job_id } = await uploadImage(account.api_token, subject.id, filename);
    console.log(`[seed]   ${subject.name} ← ${filename} (ref=${reference.id} job=${job_id})`);
  }

  console.log("[seed] done. Export this token to run more calls:");
  console.log(`  export IPD_TOKEN=${account.api_token}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
