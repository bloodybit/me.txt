// Content script — runs in page context.
// Programmatically injected by background.js when the user triggers a scan.

(function () {
  if (window.__metxtContentScriptLoaded) return;
  window.__metxtContentScriptLoaded = true;

  const MIN_IMAGE_EDGE = 60;

  function collectImages(maxImages) {
    const results = [];
    const seen = new Set();

    function addImage(src, rect, sourceType) {
      if (results.length >= maxImages) return;
      if (!src || seen.has(src)) return;
      if (rect.width < MIN_IMAGE_EDGE || rect.height < MIN_IMAGE_EDGE) return;
      seen.add(src);
      results.push({
        src,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        sourceType,
      });
    }

    for (const el of Array.from(document.images || [])) {
      if (results.length >= maxImages) break;
      const src = el.currentSrc || el.src;
      const rect = el.getBoundingClientRect();
      addImage(src, rect, 'img');
    }

    return results;
  }

  function ensureStyles() {
    const STYLE_ID = 'metxt-overlay-style';
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.metxt-overlay-root{position:absolute;z-index:2147483647;pointer-events:none;font-family:-apple-system,system-ui,sans-serif;}' +
      '.metxt-box{position:absolute;inset:0;border:3px solid #ff1744;border-radius:6px;box-shadow:0 0 16px rgba(255,23,68,0.6);pointer-events:none;}' +
      '.metxt-badge{position:absolute;top:-14px;right:-8px;background:#ff1744;color:white;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;letter-spacing:1.5px;box-shadow:0 4px 20px rgba(255,23,68,0.5);pointer-events:auto;}' +
      '.metxt-info{position:absolute;left:0;right:0;bottom:-78px;background:rgba(0,0,0,0.9);color:white;border:1px solid rgba(255,23,68,0.4);border-radius:8px;padding:10px 14px;font-size:11px;line-height:1.6;backdrop-filter:blur(8px);pointer-events:auto;}' +
      '.metxt-info .ttl{color:#ff1744;font-weight:700;letter-spacing:0.5px;display:block;margin-bottom:4px;}' +
      '.metxt-info .val{color:white;}' +
      '.metxt-info .conf{color:#ff6b6b;}' +
      '.metxt-info a{color:#64b5f6;text-decoration:underline;}';
    document.documentElement.appendChild(style);
  }

  function clearOverlays() {
    document.querySelectorAll('.metxt-overlay-root').forEach(el => el.remove());
  }

  function injectOverlays(matches) {
    ensureStyles();
    clearOverlays();
    for (const m of matches) {
      const el = Array.from(document.images || []).find(img => (img.currentSrc || img.src) === m.imageUrl);
      if (!el) continue;

      const rect = el.getBoundingClientRect();
      const wrapper = document.createElement('div');
      wrapper.className = 'metxt-overlay-root';
      wrapper.style.top = (rect.top + window.scrollY) + 'px';
      wrapper.style.left = (rect.left + window.scrollX) + 'px';
      wrapper.style.width = rect.width + 'px';
      wrapper.style.height = rect.height + 'px';

      const box = document.createElement('div');
      box.className = 'metxt-box';
      wrapper.appendChild(box);

      const badge = document.createElement('div');
      badge.className = 'metxt-badge';
      badge.textContent = 'AI STOP';
      wrapper.appendChild(badge);

      const conf = m.match && m.match.confidence != null
        ? (m.match.confidence * 100).toFixed(1) + '%'
        : 'n/a';
      const profileUrl = (m.takedown && m.takedown.profile_url) || '#';
      const name = (m.match && m.match.name) || 'Unknown';
      const profileId = (m.match && m.match.profile_id) || '—';

      const info = document.createElement('div');
      info.className = 'metxt-info';
      info.innerHTML =
        '<span class="ttl">REGISTERED LIKENESS — NO CONSENT</span>' +
        'Match: <span class="val"></span> · Confidence: <span class="conf"></span><br/>' +
        'Profile: <span class="val pid"></span> · <a target="_blank" rel="noopener">View evidence packet →</a>';
      info.querySelector('.val').textContent = name;
      info.querySelector('.conf').textContent = conf;
      info.querySelector('.pid').textContent = profileId;
      info.querySelector('a').href = profileUrl;
      wrapper.appendChild(info);

      document.documentElement.appendChild(wrapper);
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'METXT_COLLECT_IMAGES') {
      sendResponse({ ok: true, images: collectImages(msg.maxImages || 12), pageUrl: location.href });
      return;
    }
    if (msg.type === 'METXT_INJECT_OVERLAYS') {
      injectOverlays(msg.matches || []);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'METXT_CLEAR_OVERLAYS') {
      clearOverlays();
      sendResponse({ ok: true });
      return;
    }
  });
})();
