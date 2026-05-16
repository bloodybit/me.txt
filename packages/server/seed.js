const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  initDb,
  createProfile,
  updateProfile,
  addEmbedding,
  deleteEmbeddings,
  updateConsent,
  getProfile,
  deleteProfile,
} = require('./db');
const { initFace, getDescriptor } = require('./face');

const LEGACY_PROFILE_IDS = ['me_demo01'];

const DEMO_PROFILE_ID = 'me_vin01';
const DEMO_NAME = 'Vin Diesel';
const DEMO_HANDLE = 'vin-diesel';
const DEMO_PHOTO_PATHS = [
  path.join(__dirname, 'fixtures', 'vin-diesel', 'seed-wikimedia.jpg'),
  path.join(__dirname, 'fixtures', 'vin-diesel', 'seed-tms.jpg'),
];

async function buildDemoEmbeddings() {
  const embeddings = [];
  for (const photoPath of DEMO_PHOTO_PATHS) {
    console.log(`[seed] Reading ${photoPath}`);
    const buffer = fs.readFileSync(photoPath);
    const descriptor = await getDescriptor(buffer);
    const photoHash = crypto.createHash('sha256').update(buffer).digest('hex');
    embeddings.push({ descriptor, photoHash });
  }
  return embeddings;
}

async function seed() {
  initDb();
  await initFace();

  for (const legacyId of LEGACY_PROFILE_IDS) {
    if (getProfile(legacyId)) {
      deleteProfile(legacyId);
      console.log(`[seed] Removed legacy profile "${legacyId}".`);
    }
  }

  const embeddings = await buildDemoEmbeddings();
  const existing = getProfile(DEMO_PROFILE_ID);

  if (existing) {
    updateProfile(DEMO_PROFILE_ID, DEMO_NAME, DEMO_HANDLE);
    deleteEmbeddings(DEMO_PROFILE_ID);
    console.log(`[seed] Refreshed demo profile "${DEMO_PROFILE_ID}".`);
  } else {
    createProfile(DEMO_PROFILE_ID, DEMO_NAME, DEMO_HANDLE);
    console.log(`[seed] Created demo profile "${DEMO_PROFILE_ID}".`);
  }

  for (const { descriptor, photoHash } of embeddings) {
    addEmbedding(DEMO_PROFILE_ID, descriptor, photoHash);
  }

  updateConsent(DEMO_PROFILE_ID, 'editorial', 'allow');
  updateConsent(DEMO_PROFILE_ID, 'commercial', 'deny');
  updateConsent(DEMO_PROFILE_ID, 'ai_training', 'deny');
  updateConsent(DEMO_PROFILE_ID, 'satire', 'deny');

  console.log(`[seed] Demo profile "${DEMO_PROFILE_ID}" ready (${DEMO_NAME}, ${embeddings.length} embedding(s)).`);
  console.log(`[seed] Visit /${DEMO_HANDLE}/me.txt to see its me.txt.`);
}

seed()
  .catch(err => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
