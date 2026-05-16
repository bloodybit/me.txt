const crypto = require('crypto');

const {
  initDb,
  createProfile,
  addEmbedding,
  updateConsent,
  getProfile,
  deleteProfile,
} = require('./db');
const { initFace, getDescriptor } = require('./face');

const LEGACY_PROFILE_IDS = ['me_demo01'];

const DEMO_PROFILE_ID = 'me_vin01';
const DEMO_NAME = 'Vin Diesel';
const DEMO_HANDLE = 'vin-diesel';
const DEMO_PHOTO_URLS = [
  'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRwj2m3QXkw69XTStiRWEZhwjZD3OwQenjmHtw2W5ntvi-tRGn1-9YMpdJXNt46Xa8COv_LPOXxEbTsxVfpNP5s8eeni1StZsG8KOoM6O4&s=10',
  'https://upload.wikimedia.org/wikipedia/commons/8/83/Vin_Diesel_by_Gage_Skidmore_2.jpg?utm_source=en.wikipedia.org&utm_campaign=index&utm_content=original',
  'https://ntvb.tmsimg.com/assets/assets/79719_v9_bc.jpg?w=360&h=480',
];

async function fetchImage(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'metxt-seed/0.1' },
    redirect: 'follow',
  });
  if (!resp.ok) {
    throw new Error(`failed to fetch ${url}: HTTP ${resp.status}`);
  }
  const arr = await resp.arrayBuffer();
  return Buffer.from(arr);
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

  if (getProfile(DEMO_PROFILE_ID)) {
    console.log(`[seed] Demo profile "${DEMO_PROFILE_ID}" already exists. Skipping.`);
    return;
  }

  createProfile(DEMO_PROFILE_ID, DEMO_NAME, DEMO_HANDLE);

  for (const url of DEMO_PHOTO_URLS) {
    console.log(`[seed] Fetching ${url}`);
    const buffer = await fetchImage(url);
    const descriptor = await getDescriptor(buffer);
    const photoHash = crypto.createHash('sha256').update(buffer).digest('hex');
    addEmbedding(DEMO_PROFILE_ID, descriptor, photoHash);
  }

  updateConsent(DEMO_PROFILE_ID, 'editorial', 'allow');
  updateConsent(DEMO_PROFILE_ID, 'commercial', 'deny');
  updateConsent(DEMO_PROFILE_ID, 'ai_training', 'deny');
  updateConsent(DEMO_PROFILE_ID, 'satire', 'deny');

  console.log(`[seed] Created demo profile "${DEMO_PROFILE_ID}" (${DEMO_NAME}).`);
  console.log(`[seed] Visit /${DEMO_HANDLE}/me.txt to see its me.txt.`);
}

seed()
  .catch(err => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
