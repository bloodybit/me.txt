const DEFAULT_API = 'http://localhost:3000';

const scanBtn = document.getElementById('scan-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const dashLink = document.getElementById('open-dashboard');
const tabTitleEl = document.getElementById('tab-title');
const tabUrlEl = document.getElementById('tab-url');

let apiUrl = DEFAULT_API;
let activeTab = null;

chrome.storage.local.get(['apiUrl'], data => {
  if (data.apiUrl) apiUrl = data.apiUrl;
  dashLink.href = apiUrl + '/#dashboard';
});

dashLink.href = DEFAULT_API + '/#dashboard';
dashLink.addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: apiUrl.replace(/\/$/, '') + '/#dashboard' });
});

function isScannable(url) {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

async function loadActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
    if (!tab) {
      tabTitleEl.textContent = 'No active tab';
      tabUrlEl.textContent = '—';
      scanBtn.disabled = true;
      return;
    }
    tabTitleEl.textContent = tab.title || '(untitled page)';
    tabUrlEl.textContent = tab.url || '—';
    if (!isScannable(tab.url)) {
      scanBtn.disabled = true;
      setStatus('This page cannot be scanned (only http/https pages are supported).', '');
    } else {
      scanBtn.disabled = false;
    }
  } catch (err) {
    tabTitleEl.textContent = 'Unable to read active tab';
    tabUrlEl.textContent = '—';
    scanBtn.disabled = true;
  }
}

loadActiveTab();

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = 'status ' + cls;
}

function renderResults(results) {
  resultsEl.innerHTML = '';
  if (!results || results.length === 0) {
    setStatus('No images found on this page.', '');
    return;
  }
  const matches = results.filter(r => r.match);
  if (matches.length === 0) {
    setStatus('Scanned ' + results.length + ' image(s). No registered likenesses detected.', 'success');
  } else {
    setStatus('Found ' + matches.length + ' registered likeness(es).', 'error');
  }
  matches.forEach(r => {
    const row = document.createElement('div');
    row.className = 'result-row match';
    const conf = r.match.confidence != null
      ? (r.match.confidence * 100).toFixed(1) + '%'
      : 'n/a';
    row.innerHTML =
      '<div class="top">' +
        '<span class="name">' + escapeHtml(r.match.name || 'Unknown') + '</span>' +
        '<span class="badge">' + escapeHtml(r.verdict) + '</span>' +
      '</div>' +
      '<div class="meta">Confidence: ' + conf + ' &middot; ' + escapeHtml(r.match.profile_id || '') + '</div>' +
      '<div class="meta">' + escapeHtml(r.imageUrl || '') + '</div>';
    resultsEl.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

scanBtn.addEventListener('click', async () => {
  const endpoint = (apiUrl || DEFAULT_API).replace(/\/$/, '');

  scanBtn.disabled = true;
  setStatus('Scanning page…', '');
  resultsEl.innerHTML = '';

  try {
    const tab = activeTab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab || !tab.id) throw new Error('No active tab');
    if (!isScannable(tab.url)) throw new Error('This page cannot be scanned.');

    const resp = await chrome.runtime.sendMessage({
      type: 'SCAN_TAB',
      tabId: tab.id,
      apiUrl: endpoint,
    });

    if (!resp || !resp.ok) {
      throw new Error((resp && resp.error) || 'Scan failed');
    }
    renderResults(resp.results || []);
  } catch (err) {
    setStatus(err.message || 'Scan failed.', 'error');
  } finally {
    scanBtn.disabled = false;
  }
});
