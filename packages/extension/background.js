// Service worker — orchestrates page scan and calls the me.txt API.

const MAX_IMAGES = 12;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'SCAN_TAB') {
    handleScanTab(msg.tabId, msg.apiUrl)
      .then(results => sendResponse({ ok: true, results }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

async function handleScanTab(tabId, apiUrl) {
  // Inject content script (idempotent — guarded by __metxtContentScriptLoaded)
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });

  const collection = await chrome.tabs.sendMessage(tabId, {
    type: 'METXT_COLLECT_IMAGES',
    maxImages: MAX_IMAGES,
  });
  if (!collection || !collection.ok) {
    throw new Error('Failed to collect images from page');
  }

  const images = collection.images || [];
  const pageUrl = collection.pageUrl || '';
  if (images.length === 0) return [];

  const results = [];
  for (const img of images) {
    try {
      const verdict = await matchImage(apiUrl, img.src, pageUrl);
      results.push({ imageUrl: img.src, rect: img.rect, ...verdict });
    } catch (err) {
      results.push({ imageUrl: img.src, rect: img.rect, error: err.message });
    }
  }

  const matches = results.filter(r => r.match);
  if (matches.length > 0) {
    await chrome.tabs.sendMessage(tabId, {
      type: 'METXT_INJECT_OVERLAYS',
      matches,
    });
  } else {
    await chrome.tabs.sendMessage(tabId, { type: 'METXT_CLEAR_OVERLAYS' }).catch(() => {});
  }

  return results;
}

async function matchImage(apiUrl, imageUrl, pageUrl) {
  let imageBase64;
  try {
    imageBase64 = await fetchAsBase64(imageUrl);
  } catch (err) {
    return { verdict: 'FETCH_FAILED', match: null, error: err.message };
  }

  const resp = await fetch(apiUrl.replace(/\/$/, '') + '/api/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_base64: imageBase64, source_url: pageUrl }),
  });
  if (!resp.ok) throw new Error('API ' + resp.status);
  return resp.json();
}

async function fetchAsBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Fetch ' + resp.status);
  const blob = await resp.blob();
  return await blobToBase64(blob);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
