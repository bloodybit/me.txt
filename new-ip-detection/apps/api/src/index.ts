import { Hono } from "hono";
import { logger } from "hono/logger";
import v1 from "./routes/v1";
import internal from "./routes/internal";
import { env } from "./lib/env";
import { ensureBucket } from "./services/storage";

const app = new Hono();
app.use("*", logger());

app.get("/health", (c) => c.json({ ok: true }));
app.route("/v1", v1);
app.route("/internal", internal);

app.onError((err, c) => {
  console.error("[api] unhandled error", err);
  return c.json({ error: err.message || "internal error" }, 500);
});

await ensureBucket().catch((err) => {
  // Non-fatal at boot: the bucket may already exist or be created later.
  console.warn("[api] ensureBucket warning:", err.message);
});

console.log(`[api] listening on :${env.apiPort}`);

export default {
  port: env.apiPort,
  fetch: app.fetch,
};
