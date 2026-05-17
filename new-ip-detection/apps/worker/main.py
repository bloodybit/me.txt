"""Worker entry point: single-process poll loop (Decision 2).

Steady state:
  1. POST /internal/jobs/lease — get next job (or sleep)
  2. Dispatch by job.kind to the matching handler
  3. POST /internal/jobs/:id/succeed (or fail) with the result
"""

from __future__ import annotations

import logging
import os
import sys
import time
import traceback

import httpx

import models
from handlers import detect_scan, index_reference

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s | %(message)s",
)
log = logging.getLogger("worker")


def main() -> None:
    api_url = os.environ.get("API_INTERNAL_URL", "http://api:8080")
    worker_id = os.environ.get("WORKER_ID", "worker-1")
    poll_interval = float(os.environ.get("WORKER_POLL_INTERVAL_SECONDS", "2"))
    lease_seconds = int(os.environ.get("WORKER_LEASE_SECONDS", "120"))
    model_name = os.environ.get("EMBEDDING_MODEL", "fake-deterministic")
    embedding_dim = int(os.environ.get("EMBEDDING_DIM", "768"))

    log.info("loading embedding model: %s (dim=%d)", model_name, embedding_dim)
    model = models.load(model_name, embedding_dim)
    log.info("worker %s ready — polling %s every %.1fs", worker_id, api_url, poll_interval)

    handlers = {
        "index_reference": index_reference.handle,
        "detect_scan": detect_scan.handle,
    }

    with httpx.Client(base_url=api_url, timeout=120) as api:
        while True:
            try:
                resp = api.post(
                    "/internal/jobs/lease",
                    json={"worker_id": worker_id, "lease_seconds": lease_seconds},
                )
            except httpx.HTTPError as exc:
                log.warning("lease request failed: %s", exc)
                time.sleep(poll_interval)
                continue

            if resp.status_code == 204 or not resp.content:
                time.sleep(poll_interval)
                continue

            resp.raise_for_status()
            job = resp.json()
            log.info("leased job %s kind=%s attempt=%d", job["id"], job["kind"], job["attempts"])

            handler = handlers.get(job["kind"])
            if handler is None:
                api.post(
                    f"/internal/jobs/{job['id']}/fail",
                    json={"error": f"unknown job kind: {job['kind']}", "retry": False},
                )
                continue

            try:
                result = handler(api, job, model)
                api.post(
                    f"/internal/jobs/{job['id']}/succeed",
                    json={"result": result},
                ).raise_for_status()
                log.info("job %s succeeded", job["id"])
            except Exception as exc:  # noqa: BLE001 — broad catch so the worker keeps running
                tb = traceback.format_exc()
                log.error("job %s failed: %s\n%s", job["id"], exc, tb)
                api.post(
                    f"/internal/jobs/{job['id']}/fail",
                    json={"error": str(exc), "retry": True},
                )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("shutting down")
        sys.exit(0)
