'use strict';

const path = require('path');

if (!process.env.PUPPETEER_CACHE_DIR) {
  process.env.PUPPETEER_CACHE_DIR = path.join(__dirname, '..', '..', '.cache', 'puppeteer');
}

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const NAV_TIMEOUT_MS = 35000;
const MAX_CONCURRENCY = Math.max(1, parseInt(process.env.MONITOR_BROWSER_CONCURRENCY, 10) || 2);
const PROXY_URL = process.env.MONITOR_PROXY_URL || null;

class BlockedError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'BlockedError';
    this.status = status || null;
  }
}

let browserPromise = null;
let activePages = 0;
const waiters = [];

async function getBrowser() {
  if (!browserPromise) {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--lang=en-US,en',
    ];
    if (PROXY_URL) args.push(`--proxy-server=${PROXY_URL}`);

    browserPromise = puppeteer.launch({ headless: true, args }).catch(err => {
      browserPromise = null;
      throw err;
    });

    browserPromise.then(browser => {
      browser.on('disconnected', () => {
        browserPromise = null;
      });
    }, () => {});
  }
  return browserPromise;
}

function acquirePage() {
  return new Promise(resolve => {
    if (activePages < MAX_CONCURRENCY) {
      activePages++;
      resolve();
    } else {
      waiters.push(resolve);
    }
  });
}

function releasePage() {
  activePages--;
  const next = waiters.shift();
  if (next) {
    activePages++;
    next();
  }
}

async function withPage(fn) {
  await acquirePage();
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setViewport({ width: 1366, height: 900 });
    return await fn(page);
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
    releasePage();
  }
}

function ensureNotBlocked(status, title) {
  if (status && status >= 400) {
    throw new BlockedError(`marketplace returned status ${status}`, status);
  }
  const normalized = String(title || '').toLowerCase();
  if (normalized.includes('access denied') || normalized.includes('captcha') || normalized.includes('robot')) {
    throw new BlockedError(`marketplace returned challenge page: "${title}"`, status);
  }
}

async function scrapeEtsy({ keyword, limit }) {
  const url = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;
  return withPage(async page => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    const status = resp ? resp.status() : null;
    ensureNotBlocked(status, await page.title());

    await page.waitForSelector('a[href*="/listing/"]', { timeout: 10000 }).catch(() => {});

    const raw = await page.evaluate(() => {
      const seen = new Set();
      const out = [];
      const anchors = document.querySelectorAll('a[href*="/listing/"]');
      anchors.forEach(a => {
        const match = a.href.match(/etsy\.com\/listing\/(\d+)\//);
        if (!match) return;
        const id = match[1];
        if (seen.has(id)) return;
        seen.add(id);

        const img = a.querySelector('img') || (a.closest('[data-listing-id], .v2-listing-card, li') && a.closest('[data-listing-id], .v2-listing-card, li').querySelector('img'));
        const titleEl = a.querySelector('h3, [data-listing-card-listing-title]') || a;
        const aria = a.getAttribute('aria-label') || '';
        const title = (aria || (titleEl && titleEl.textContent) || '').trim();

        out.push({
          id,
          pageUrl: a.href.split('?')[0],
          imageUrl: img ? (img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('srcset') || '').split(' ')[0] : null,
          title,
        });
      });
      return out;
    });

    if (!raw.length) {
      throw new BlockedError('etsy returned no listings (likely a challenge page)', status);
    }

    return raw.slice(0, limit).map((item, index) => ({
      rank: index + 1,
      title: item.title || 'Etsy listing',
      pageUrl: item.pageUrl,
      imageUrl: item.imageUrl,
      thumbnailUrl: item.imageUrl,
      width: null,
      height: null,
      source: 'etsy',
    }));
  });
}

async function scrapeEbay({ keyword, limit }) {
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}`;
  return withPage(async page => {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    const status = resp ? resp.status() : null;
    ensureNotBlocked(status, await page.title());

    await page.waitForSelector('li.s-item, li[class*="s-card"]', { timeout: 10000 }).catch(() => {});

    const raw = await page.evaluate(() => {
      const seen = new Set();
      const out = [];
      const items = document.querySelectorAll('li.s-item, li[class*="s-card"]');
      items.forEach(li => {
        const link = li.querySelector('a.s-item__link, a[class*="s-card__link"], a[href*="/itm/"]');
        if (!link || !link.href) return;
        const match = link.href.match(/\/itm\/(?:[^/?]+\/)?(\d+)/);
        const id = match ? match[1] : link.href;
        if (seen.has(id)) return;
        seen.add(id);

        const titleEl = li.querySelector('.s-item__title, [class*="s-card__title"], [role="heading"]');
        const img = li.querySelector('img');
        const title = (titleEl && titleEl.textContent || '').trim();
        if (!title || /shop on ebay/i.test(title)) return;

        out.push({
          id,
          pageUrl: link.href.split('?')[0],
          imageUrl: img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : null,
          title,
        });
      });
      return out;
    });

    if (!raw.length) {
      throw new BlockedError('ebay returned no listings (likely a challenge page)', status);
    }

    return raw.slice(0, limit).map((item, index) => ({
      rank: index + 1,
      title: item.title || 'eBay listing',
      pageUrl: item.pageUrl,
      imageUrl: item.imageUrl,
      thumbnailUrl: item.imageUrl,
      width: null,
      height: null,
      source: 'ebay',
    }));
  });
}

const HANDLERS = {
  'etsy.com': scrapeEtsy,
  'www.etsy.com': scrapeEtsy,
  'ebay.com': scrapeEbay,
  'www.ebay.com': scrapeEbay,
};

function handlerFor(domain) {
  return HANDLERS[String(domain || '').toLowerCase()] || null;
}

async function shutdown() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    // ignore
  } finally {
    browserPromise = null;
  }
}

module.exports = {
  handlerFor,
  scrapeEtsy,
  scrapeEbay,
  shutdown,
  BlockedError,
  config: {
    proxyConfigured: Boolean(PROXY_URL),
    concurrency: MAX_CONCURRENCY,
  },
};
