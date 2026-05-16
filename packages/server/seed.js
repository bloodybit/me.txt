const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  initDb,
  createProfile,
  addEmbedding,
  updateConsent,
  getProfile,
} = require('./db');
const { initFace, getDescriptor } = require('./face');

const DEMO_PROFILE_ID = 'me_demo01';
const DEMO_NAME = 'Demo User';
const SAMPLE_FACE_CANDIDATES = [
  path.join(__dirname, '..', 'web', 'demo-face.svg'),
  path.join(__dirname, '..', 'web', 'demo-face.png'),
];

async function seed() {
  initDb();
  await initFace();

  if (getProfile(DEMO_PROFILE_ID)) {
    console.log(`[seed] Demo profile "${DEMO_PROFILE_ID}" already exists. Skipping.`);
    return;
  }

  createProfile(DEMO_PROFILE_ID, DEMO_NAME);

  const samplePath = SAMPLE_FACE_CANDIDATES.find(p => fs.existsSync(p));
  const buffer = samplePath
    ? fs.readFileSync(samplePath)
    : Buffer.from('metxt-demo-seed-fallback', 'utf-8');
  if (samplePath) {
    console.log(`[seed] Using demo image: ${samplePath}`);
  }

  const descriptor = await getDescriptor(buffer);
  const photoHash = crypto.createHash('sha256').update(buffer).digest('hex');
  addEmbedding(DEMO_PROFILE_ID, descriptor, photoHash);

  updateConsent(DEMO_PROFILE_ID, 'editorial', 'allow');
  updateConsent(DEMO_PROFILE_ID, 'commercial', 'deny');
  updateConsent(DEMO_PROFILE_ID, 'ai_training', 'deny');
  updateConsent(DEMO_PROFILE_ID, 'satire', 'deny');

  console.log(`[seed] Created demo profile "${DEMO_PROFILE_ID}" (${DEMO_NAME}).`);
  console.log(`[seed] Visit /.well-known/me.txt?id=${DEMO_PROFILE_ID} to see its me.txt.`);
}

seed()
  .catch(err => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
