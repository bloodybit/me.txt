#!/usr/bin/env node
const path = require('node:path');
const { existsSync, statSync, readdirSync } = require('node:fs');

const CACHE_DIR =
  process.env.PUPPETEER_CACHE_DIR ||
  path.join(__dirname, '..', '..', '..', '.cache', 'puppeteer');
process.env.PUPPETEER_CACHE_DIR = CACHE_DIR;

function alreadyInstalled() {
  const root = path.join(CACHE_DIR, 'chrome');
  if (!existsSync(root)) return false;
  return readdirSync(root).some(entry => {
    const dir = path.join(root, entry);
    try { return statSync(dir).isDirectory(); } catch { return false; }
  });
}

if (alreadyInstalled()) {
  console.log(`[puppeteer] Chromium already present in ${CACHE_DIR}`);
  return;
}

(async () => {
  let install;
  try {
    ({ install } = require('@puppeteer/browsers'));
  } catch (err) {
    console.warn('[puppeteer] @puppeteer/browsers not available — skipping Chromium install:', err.message);
    return;
  }

  const PUPPETEER_REVISIONS = require('puppeteer-core/lib/cjs/puppeteer/revisions.js').PUPPETEER_REVISIONS;
  const buildId = PUPPETEER_REVISIONS.chrome;

  console.log(`[puppeteer] installing Chrome ${buildId} into ${CACHE_DIR}`);
  try {
    await install({ browser: 'chrome', buildId, cacheDir: CACHE_DIR });
    console.log('[puppeteer] Chrome install complete');
  } catch (err) {
    console.warn('[puppeteer] Chrome install failed (continuing without):', err.message);
  }
})();
