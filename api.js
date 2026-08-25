// ===== API LAYER v2 =====
// CHANGES:
//   - Write-through localStorage cache: UI updates instantly, backend syncs async
//   - Retry logic: failed saves retry up to 3 times with backoff
//   - Date sanitization injected into every updateLead / addLead call
//   - batchUpdate error handling improved

window.CORS_PROXY_URL = 'https://damp-darkness-be57.jasonjavier57.workers.dev';

// ── Sync status ───────────────────────────────────────────
window.setSyncStatus = function(status, text) {
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncText');
  if (dot) dot.className = 'sync-dot ' + status;
  if (txt) txt.textContent = text;
};

// ── Write-through local cache ─────────────────────────────
// Key: "bs_cache_<tab>_<leadId>" → JSON lead
// This lets the UI read back fresh data instantly while backend is saving

window._cacheKey = function(tab, leadId) {
  return `bs_cache_${window.currentUser?.key||'jay'}_${tab}_${leadId}`;
};

window._cacheWrite = function(tab, lead) {
  if (!lead || !lead.id) return;
  try {
    // Sanitize dates before caching
    const clean = window.sanitizeLeadDates ? window.sanitizeLeadDates({...lead}) : {...lead};
    localStorage.setItem(window._cacheKey(tab, lead.id), JSON.stringify(clean));
  } catch(e) { /* storage full — ignore */ }
};

window._cacheRead = function(tab, leadId) {
  try {
    const s = localStorage.getItem(window._cacheKey(tab, leadId));
    return s ? JSON.parse(s) : null;
  } catch(e) { return null; }
};

window._cacheDelete = function(tab, leadId) {
  try { localStorage.removeItem(window._cacheKey(tab, leadId)); } catch(e) {}
};

// Merge cache over a freshly-loaded lead array (protects recent local edits)
window._mergeCacheIntoLeads = function(tab, leads) {
  return leads.map(lead => {
    const cached = window._cacheRead(tab, lead.id);
    if (!cached) return lead;
    // Only use cache if it's newer (has a _cachedAt timestamp)
    if (cached._cachedAt && lead._cachedAt && cached._cachedAt >= lead._cachedAt) {
      return { ...lead, ...cached };
    }
    return lead;
  });
};

// ── Core fetch ────────────────────────────────────────────
window.api = async function(params) {
  if (!window.SCRIPT_URL) throw new Error('No Apps Script URL configured.');
  window.setSyncStatus('syncing', 'Syncing...');

  // Sanitize dates on any lead save
  if ((params.action === 'updateLead' || params.action === 'addLead') && params.lead) {
    try {
      const lead = typeof params.lead === 'string' ? JSON.parse(params.lead) : params.lead;
      const clean = window.sanitizeLeadDates ? window.sanitizeLeadDates({...lead}) : lead;
      clean._cachedAt = Date.now();
      params = { ...params, lead: JSON.stringify(clean) };
      // Write-through cache
      if (params.tab) window._cacheWrite(params.tab, clean);
    } catch(e) {}
  }

  try {
    const sanitized = { _targetUrl: window.SCRIPT_URL };
    for (const [k, v] of Object.entries(params)) {
      sanitized[k] = (typeof v === 'object' && v !== null) ? JSON.stringify(v) : v;
    }
    const res = await fetch(window.CORS_PROXY_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' },
      body:    JSON.stringify(sanitized),
      redirect:'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch(e) { throw new Error('Non-JSON response. Re-deploy Apps Script.'); }
    if (!data.ok) throw new Error(data.error || 'API error');
    window.setSyncStatus('ok', 'Synced ' + new Date().toLocaleTimeString());
    // On successful save, clear cache entry (backend is now source of truth)
    if ((params.action === 'updateLead' || params.action === 'addLead') && params.tab && params.lead) {
      try {
        const lead = typeof params.lead === 'string' ? JSON.parse(params.lead) : params.lead;
        if (lead.id) window._cacheDelete(params.tab, lead.id);
      } catch(e) {}
    }
    return data;
  } catch(e) {
    const msg = e.message || '';
    if (msg.includes('Failed to fetch') || e.name === 'TypeError') {
      window.setSyncStatus('err', 'CORS/Network error — check Apps Script URL');
    } else {
      window.setSyncStatus('err', 'Error: ' + msg);
    }
    throw e;
  }
};

// ── Retry wrapper ─────────────────────────────────────────
// Use this for critical saves (lead updates). Retries up to 3x with backoff.
window.apiWithRetry = async function(params, maxRetries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await window.api(params);
    } catch(e) {
      lastErr = e;
      if (attempt < maxRetries) {
        const delay = attempt * 800; // 800ms, 1600ms, 2400ms
        console.warn(`API attempt ${attempt} failed, retrying in ${delay}ms:`, e.message);
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }
  console.error('API failed after', maxRetries, 'attempts:', lastErr?.message);
  throw lastErr;
};

// ── Read cache (25s TTL) ──────────────────────────────────
window._readCache = {};
window._cachedApi = async function(params, ttlMs) {
  const key = JSON.stringify(params);
  const entry = window._readCache[key];
  if (entry && Date.now() < entry.expires) return entry.data;
  const data = await window.api(params);
  window._readCache[key] = { data, expires: Date.now() + (ttlMs || 25000) };
  return data;
};
window.invalidateReadCache = function() { window._readCache = {}; };

// ── Batch write queue ─────────────────────────────────────
window._batchQueue     = [];
window._batchTimer     = null;
window._batchDedupeMap = {};

window._queueSave = function(params) {
  // Write-through cache immediately
  if (params.action === 'updateLead' && params.lead && params.tab) {
    try {
      const lead = typeof params.lead === 'string' ? JSON.parse(params.lead) : params.lead;
      if (lead && lead.id) {
        const clean = window.sanitizeLeadDates ? window.sanitizeLeadDates({...lead}) : lead;
        clean._cachedAt = Date.now();
        window._cacheWrite(params.tab, clean);
        params = { ...params, lead: JSON.stringify(clean) };
      }
    } catch(e) {}
  }

  // Deduplicate by leadId
  if (params.action === 'updateLead' && params.lead) {
    let lead;
    try { lead = typeof params.lead === 'string' ? JSON.parse(params.lead) : params.lead; } catch(e) {}
    if (lead && lead.id) {
      const idx = window._batchDedupeMap[lead.id];
      if (idx !== undefined) { window._batchQueue[idx] = params; return; }
      window._batchDedupeMap[lead.id] = window._batchQueue.length;
    }
  }
  window._batchQueue.push(params);
  clearTimeout(window._batchTimer);
  window._batchTimer = setTimeout(window._flushBatch, 300);
};

window._flushBatch = async function() {
  if (!window._batchQueue.length) return;
  const toSend = [...window._batchQueue];
  window._batchQueue = []; window._batchDedupeMap = {}; window._batchTimer = null;
  if (toSend.length === 1) {
    try { await window.apiWithRetry(toSend[0]); } catch(e) { console.warn('Save failed:', e.message); }
    return;
  }
  try {
    await window.apiWithRetry({ action: 'batchUpdate', updates: JSON.stringify(toSend) });
  } catch(e) {
    // Batch failed — retry each individually
    for (const p of toSend) {
      try { await window.apiWithRetry(p, 2); } catch(e2) { console.warn('Retry failed:', e2.message); }
    }
  }
};

window._flushNow = async function() {
  clearTimeout(window._batchTimer);
  await window._flushBatch();
};

// ── URL helpers ───────────────────────────────────────────
window.saveScriptUrl = function() {
  const url = document.getElementById('scriptUrlInput').value.trim();
  if (!url || !url.includes('script.google.com')) {
    document.getElementById('urlError').textContent = 'Invalid URL. Must be a script.google.com URL.'; return;
  }
  window.SCRIPT_URL = url;
  const key = window.currentUser ? window.userPrefix()+'script_url' : 'bs_script_url';
  localStorage.setItem(key, url);
  if (!localStorage.getItem('bs_any_url_set')) localStorage.setItem('bs_any_url_set','1');
  location.reload();
};
window.updateScriptUrl = function() {
  const url = document.getElementById('scriptUrlEdit').value.trim();
  if (!url || !url.includes('script.google.com')) { window.showSuccess('Invalid URL','Must be a script.google.com URL.'); return; }
  window.SCRIPT_URL = url;
  const key = window.currentUser ? window.userPrefix()+'script_url' : 'bs_script_url';
  localStorage.setItem(key, url);
  if (!localStorage.getItem('bs_any_url_set')) localStorage.setItem('bs_any_url_set','1');
  window.showSuccess('Updated!','URL saved.');
  setTimeout(() => location.reload(), 1200);
};
