'use strict';

const ETSY_API_BASE = 'https://openapi.etsy.com/v3/application';
const REQUEST_TIMEOUT_MS = 15000;

const QPS_LIMIT = parseInt(process.env.ETSY_API_QPS_LIMIT, 10) || 5;
const QPD_LIMIT = parseInt(process.env.ETSY_API_QPD_LIMIT, 10) || 5000;

class EtsyApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'EtsyApiError';
    this.status = status || null;
    this.code = code || null;
  }
}

const recentRequestTimes = [];
let dailyWindowStart = Date.now();
let dailyCount = 0;

function rollDailyWindowIfNeeded() {
  const DAY_MS = 24 * 60 * 60 * 1000;
  if (Date.now() - dailyWindowStart >= DAY_MS) {
    dailyWindowStart = Date.now();
    dailyCount = 0;
  }
}

async function reserveQuota() {
  rollDailyWindowIfNeeded();
  if (dailyCount >= QPD_LIMIT) {
    throw new EtsyApiError('etsy api daily quota exhausted', { code: 'QPD_EXHAUSTED' });
  }

  while (true) {
    const now = Date.now();
    while (recentRequestTimes.length && now - recentRequestTimes[0] >= 1000) {
      recentRequestTimes.shift();
    }
    if (recentRequestTimes.length < QPS_LIMIT) {
      recentRequestTimes.push(now);
      dailyCount++;
      return;
    }
    const waitMs = 1000 - (now - recentRequestTimes[0]) + 5;
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}

function authHeader() {
  const raw = String(process.env.ETSY_API_KEY || '').trim();
  if (!raw) throw new EtsyApiError('ETSY_API_KEY env var not set', { code: 'NO_KEY' });
  return raw;
}

function pickImageUrl(image) {
  if (!image) return null;
  return (
    image.url_570xN ||
    image.url_680x540 ||
    image.url_300x300 ||
    image.url_170x135 ||
    image.url_75x75 ||
    image.url_fullxfull ||
    null
  );
}

async function searchListings({ keywords, limit = 16 }) {
  if (!keywords || !String(keywords).trim()) {
    throw new EtsyApiError('keywords required', { code: 'BAD_INPUT' });
  }

  const key = authHeader();
  await reserveQuota();

  const url = new URL(`${ETSY_API_BASE}/listings/active`);
  url.searchParams.set('keywords', String(keywords).trim());
  url.searchParams.set('limit', String(Math.min(Math.max(parseInt(limit, 10) || 16, 1), 100)));
  url.searchParams.set('includes', 'Images');

  const resp = await fetch(url, {
    headers: {
      'x-api-key': key,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await resp.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* keep raw */ }

  if (resp.status === 401 || resp.status === 403) {
    const message = (body && body.error) || `etsy api auth rejected (${resp.status})`;
    throw new EtsyApiError(message, { status: resp.status, code: 'AUTH' });
  }
  if (resp.status === 429) {
    throw new EtsyApiError('etsy api rate limit hit', { status: 429, code: 'RATE_LIMIT' });
  }
  if (!resp.ok) {
    throw new EtsyApiError(
      (body && body.error) || `etsy api error (${resp.status})`,
      { status: resp.status }
    );
  }

  const results = Array.isArray(body && body.results) ? body.results : [];
  return results.map((item, index) => {
    const firstImage = Array.isArray(item.images) && item.images.length ? item.images[0] : null;
    const imageUrl = pickImageUrl(firstImage);
    return {
      rank: index + 1,
      title: item.title || 'Etsy listing',
      pageUrl: item.url || `https://www.etsy.com/listing/${item.listing_id}`,
      imageUrl,
      thumbnailUrl: imageUrl,
      width: firstImage && firstImage.full_width || null,
      height: firstImage && firstImage.full_height || null,
      source: 'etsy-api',
    };
  });
}

function status() {
  rollDailyWindowIfNeeded();
  return {
    configured: Boolean(process.env.ETSY_API_KEY),
    qps_limit: QPS_LIMIT,
    qpd_limit: QPD_LIMIT,
    qpd_used: dailyCount,
  };
}

module.exports = {
  searchListings,
  status,
  EtsyApiError,
};
