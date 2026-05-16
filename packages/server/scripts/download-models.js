#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');

const BASE = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model';
const MODEL_DIR = path.join(__dirname, '..', 'models');
const FILES = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model.bin',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin',
];

async function downloadOne(name) {
  const dest = path.join(MODEL_DIR, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`[models] ${name} already present, skipping`);
    return;
  }
  const url = `${BASE}/${name}`;
  console.log(`[models] downloading ${name}`);
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(resp.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

async function main() {
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  for (const name of FILES) {
    await downloadOne(name);
  }
  console.log('[models] all face-api weights ready in', MODEL_DIR);
}

main().catch(err => {
  console.warn('[models] download failed:', err.message);
  console.warn('[models] face recognition will fall back to mock descriptors.');
  console.warn('[models] re-run with `npm run download-models` once network is available.');
});
