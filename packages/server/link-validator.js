'use strict';

const VALIDATION_TIMEOUT_MS = 8000;
const VALIDATION_CONCURRENCY = 6;
const VALIDATION_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEAD_BODY_MARKERS = {
  'etsy.com': [
    /sorry,?\s*what\s+you[^<.]{0,40}looking\s+for/i,
    /sorry,?\s*the\s+page\s+you[^<.]{0,40}looking\s+for/i,
    /not\s+available\s+on\s+etsy/i,
    /this\s+item\s+is\s+unavailable/i,
    /this\s+listing\s+(?:has\s+been\s+removed|is\s+no\s+longer\s+available)/i,
  ],
  'ebay.com': [
    /this\s+listing\s+has\s+ended/i,
    /the\s+item\s+you[^<.]{0,40}no\s+longer\s+available/i,
    /the\s+listing\s+you[^<.]{0,40}no\s+longer\s+available/i,
    /listing\s+has\s+been\s+removed/i,
  ],
  'amazon.com': [
    /we\s+couldn[’']?t\s+find\s+that\s+page/i,
    /looking\s+for\s+something\?\s+we[^<.]{0,40}sorry/i,
  ],
};

function hostKey(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

async function checkOne(url) {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': VALIDATION_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
    });

    if (resp.status === 404 || resp.status === 410) {
      return { alive: false, reason: `status ${resp.status}` };
    }
    if (resp.status >= 400) {
      return { alive: true, inconclusive: true, reason: `status ${resp.status}` };
    }

    const finalHost = hostKey(resp.url) || hostKey(url);
    const markers = DEAD_BODY_MARKERS[finalHost];
    if (!markers || !markers.length) {
      return { alive: true };
    }

    const text = await resp.text();
    const sample = text.slice(0, 200000);
    for (const marker of markers) {
      if (marker.test(sample)) {
        return { alive: false, reason: 'dead-listing marker matched' };
      }
    }
    return { alive: true };
  } catch (err) {
    return { alive: true, inconclusive: true, reason: err.message || 'fetch failed' };
  }
}

async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workerCount = Math.min(limit, items.length) || 1;
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function validateCandidates(candidates) {
  if (!candidates || !candidates.length) {
    return { results: [], removedDead: 0, checked: 0 };
  }

  const verdicts = await mapLimited(candidates, VALIDATION_CONCURRENCY, async candidate => {
    if (!candidate.pageUrl) return { alive: true };
    return checkOne(candidate.pageUrl);
  });

  const kept = [];
  let removedDead = 0;
  candidates.forEach((candidate, index) => {
    const verdict = verdicts[index] || { alive: true };
    if (verdict.alive === false) {
      removedDead++;
      return;
    }
    kept.push(candidate);
  });

  kept.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });

  return { results: kept, removedDead, checked: candidates.length };
}

module.exports = {
  validateCandidates,
  checkOne,
};
