'use strict';

const DEFAULT_BASE_URL = 'https://developer.thehog.ai';

function getConfig() {
  return {
    baseUrl: (process.env.HOG_API_BASE_URL || process.env.THEHOG_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    accessKey: process.env.HOG_ACCESS_KEY || process.env.THEHOG_ACCESS_KEY || process.env.THE_HOG_ACCESS_KEY || '',
    secretKey: process.env.HOG_SECRET_KEY || process.env.THEHOG_SECRET_KEY || process.env.THE_HOG_SECRET_KEY || '',
  };
}

function extractImages(tweetData) {
  if (!tweetData) return [];
  const media =
    (tweetData.extendedEntities && tweetData.extendedEntities.media) ||
    (tweetData.entities && tweetData.entities.media) ||
    tweetData.media ||
    [];
  return media
    .filter(m => m.type === 'photo')
    .map(m => m.media_url_https || m.url)
    .filter(Boolean);
}

async function searchTweets({ query, maxTweets, dateFrom, dateTo, lang }) {
  const config = getConfig();
  if (!config.accessKey || !config.secretKey) {
    throw new Error('HOG_ACCESS_KEY and HOG_SECRET_KEY required for X/Twitter search');
  }

  const body = { query };
  if (maxTweets) body.maxTweets = maxTweets;

  const options = {};
  if (dateFrom) options.dateFrom = dateFrom;
  if (dateTo) options.dateTo = dateTo;
  if (lang) options.lang = lang;
  if (Object.keys(options).length) body.options = options;

  const resp = await fetch(config.baseUrl + '/api/v1/platform/scrapers/x/search-tweets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Key': config.accessKey,
      'X-Secret-Key': config.secretKey,
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('X search API returned non-JSON: ' + text.slice(0, 200));
  }

  if (!resp.ok) {
    const detail = (data && (data.message || data.error)) || text.slice(0, 240);
    throw new Error('X search API ' + resp.status + ': ' + detail);
  }

  return data.data || [];
}

function configured() {
  const config = getConfig();
  return Boolean(config.accessKey && config.secretKey);
}

module.exports = { searchTweets, extractImages, configured };
