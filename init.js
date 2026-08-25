// ===== APP INITIALIZATION =====

// Safely parse a value expected to be an array
function _safeArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    const t = val.trim();
    if (t.startsWith('[')) {
      try { const p = JSON.parse(t); if (Array.isArray(p)) return p; } catch(e) {}
    }
  }
  return [];
}

// Safely parse a value expected to be a plain object
function _safeObject(val) {
  if (val && typeof val === 'object' && !Array.isArray(val)) return val;
  if (typeof val === 'string') {
    const t = val.trim();
    if (t.startsWith('{')) {
      try { return JSON.parse(t); } catch(e) {}
    }
  }
  return {};
}

window.onload = async function() {
  window.loadTheme();
  window.loadFontSize();
  // Load custom tabs before anything else
  if (typeof window._loadCustomTabs === 'function') window._loadCustomTabs();
  const soundInput = document.getElementById('notifSoundUrl');
  if (soundInput && window.notifSoundUrl) soundInput.value = window.notifSoundUrl;
  const anyUrl = localStorage.getItem('bs_any_url_set')
    || localStorage.getItem('bs_jay_script_url')
    || localStorage.getItem('bs_cath_script_url')
    || localStorage.getItem('bs_script_url');
  if (!anyUrl) {
    document.getElementById('urlSetup').style.display = 'flex';
    return;
  }
  document.getElementById('profilePage').style.display = 'flex';
};

window.enterApp = async function(userKey) {
  const user = window.USERS[userKey];
  if (!user) return;
  window.currentUser = user;
  window.resetState();

  // ── Record the time this user "started work" today, in Philippine time.
  //    Persisted in localStorage so a refresh doesn't reset it. Resets
  //    automatically the next PH calendar day (so a user working past PH
  //    midnight gets a fresh anchor for the new day).
  try {
    // PH "today" string in M/D/YY format
    const phParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: '2-digit', month: 'numeric', day: 'numeric'
    }).formatToParts(new Date());
    const phMo = phParts.find(p => p.type === 'month')?.value || '';
    const phDy = phParts.find(p => p.type === 'day')?.value   || '';
    const phYr = phParts.find(p => p.type === 'year')?.value  || '';
    const phToday = `${phMo}/${phDy}/${phYr}`;

    const key = 'bs_' + userKey + '_workStart';
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    if (!stored || stored.date !== phToday) {
      // PH 24h time HH:MM (for the <input type="time"> field) +
      // PH 12h display string (for any human-readable display).
      const t24 = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Manila',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date());
      const t12 = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        hour: 'numeric', minute: '2-digit', hour12: true
      }).format(new Date());
      localStorage.setItem(key, JSON.stringify({
        date:   phToday,
        time24: t24,
        time12: t12,
        ts:     Date.now()
      }));
    }
  } catch (e) { /* ignore */ }

  // Ensure custom tabs are loaded into state
  if (typeof window._loadCustomTabs === 'function') window._loadCustomTabs();
  window.ALL_TABS.forEach(t => {
    if (!window.state.leads[t]) window.state.leads[t] = [];
  });

  if (!window.SCRIPT_URL) {
    document.getElementById('profilePage').style.display = 'none';
    document.getElementById('urlSetup').style.display = 'flex';
    document.getElementById('urlSetupNote').textContent =
      `Setting up for ${user.name}. This URL will be saved for ${user.name} only.`;
    return;
  }
  window.showLoading('Loading ' + user.name + "'s data...");
  try {
    await window.api({ action: 'init' });
    await window.loadAllData(false, true);
    window.hideLoading();
    window.loadTheme();    // Reload theme with user prefix now that user is known
    window.loadFontSize(); // Reload font size with user prefix
    window.buildSidebar();
    document.getElementById('profilePage').style.display = 'none';
    document.getElementById('appPage').style.display = 'flex';
    document.getElementById('chatBtn').style.display = 'flex';
    window._refreshTopbarUserBadge();
    const greeting = document.getElementById('chatGreeting');
    if (greeting) greeting.textContent = 'Enter a name, phone number, or email to look up a lead.';
    window.updateGmailStatusBar();
    window.populateAttorneyDropdowns();
    window.updateCounters();
    window._updateScheduledBadge();
    window._startScheduler();
    window.showPage('intake');
    window.initVerseTicker();
    // ✅ New Features Init
    if (typeof window.initTheme === 'function') window.initTheme();
    if (typeof window.initStickyNotes === 'function') window.initStickyNotes();
    if (typeof window._checkLeadAlerts === 'function') window._checkLeadAlerts();
    // ✅ REMOVED: window.startDurationTicker(); (Duration column removed)
    window.startPolling(); // Enable real-time updates

    // ── Login reminder: show last-searched lead if one was saved ──────────────
    try {
      const remKey = 'bs_last_searched_' + userKey;
      const remRaw = localStorage.getItem(remKey);
      if (remRaw) {
        const rem = JSON.parse(remRaw);
        if (rem && rem.name && rem.tab) {
          setTimeout(() => window._showLastSearchedReminder(rem), 800);
        }
      }
    } catch(e) {}

    window._autoConnectGmail().then(() => {
      if (typeof window._startInboxPoller === 'function') window._startInboxPoller();
    });
  } catch(e) {
    window.hideLoading();
    document.getElementById('profilePage').style.display = 'none';
    document.getElementById('urlSetup').style.display = 'flex';
    const errEl = document.getElementById('urlError');
    if (errEl) errEl.textContent = 'Could not connect: ' + e.message;
  }
};

// ===================== PROFILE PHOTOS =====================
// Photos are stored per-browser in localStorage as base64 data URLs.
// They are resized to a 200x200 square before storage to keep size small
// (~25-40KB each) and avoid bumping into the 5MB localStorage cap.

window._profilePhotoKey = function(userKey) {
  return 'bs_user_photo_' + userKey;
};

window._getProfilePhoto = function(userKey) {
  try { return localStorage.getItem(window._profilePhotoKey(userKey)) || null; }
  catch(e) { return null; }
};

window._setProfilePhoto = function(userKey, dataUrl) {
  try {
    localStorage.setItem(window._profilePhotoKey(userKey), dataUrl);
    window._renderProfileCardPhoto(userKey);
    if (window.currentUser && window.currentUser.key === userKey) {
      window._refreshTopbarUserBadge();
    }
  } catch(e) {
    if (window.showSuccess) window.showSuccess('Photo too large', 'Try a smaller image.');
  }
};

window._clearProfilePhoto = function(userKey) {
  try { localStorage.removeItem(window._profilePhotoKey(userKey)); } catch(e) {}
  window._renderProfileCardPhoto(userKey);
  if (window.currentUser && window.currentUser.key === userKey) {
    window._refreshTopbarUserBadge();
  }
};

// Open file picker for the specified user, then process the chosen image.
window._pickProfilePhoto = function(userKey) {
  const input = document.getElementById('_profilePhotoFile');
  if (!input) return;
  // Re-bind every time so listeners don't accumulate
  input.value = '';
  input.onchange = function() {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      if (window.showSuccess) window.showSuccess('Invalid file', 'Please choose an image.');
      return;
    }
    window._processProfilePhoto(file, userKey);
    input.value = '';
  };
  input.click();
};

// Read the file, draw it onto a 200x200 canvas (cover-fit, centered),
// export as JPEG, and persist.
window._processProfilePhoto = function(file, userKey) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const SIZE = 200;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      // Cover-fit: scale so the smaller dimension fills, then center-crop
      const scale = Math.max(SIZE / img.width, SIZE / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (SIZE - w) / 2;
      const y = (SIZE - h) / 2;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.drawImage(img, x, y, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      window._setProfilePhoto(userKey, dataUrl);
    };
    img.onerror = function() {
      if (window.showSuccess) window.showSuccess('Image error', 'Could not read this image.');
    };
    img.src = e.target.result;
  };
  reader.onerror = function() {
    if (window.showSuccess) window.showSuccess('Read error', 'Could not read the file.');
  };
  reader.readAsDataURL(file);
};

// Update one card's avatar to show the stored photo (or fall back to the letter).
window._renderProfileCardPhoto = function(userKey) {
  const card = document.querySelector(`.profile-card[data-user="${userKey}"]`);
  if (!card) return;
  const avatar = card.querySelector('.profile-avatar');
  if (!avatar) return;
  const photo = window._getProfilePhoto(userKey);
  const user = window.USERS[userKey];
  const initial = user ? (user.initial || (user.name || '?')[0]) : '?';
  if (photo) {
    avatar.innerHTML = `<img src="${photo}" alt="${user?.name || ''}" draggable="false">`;
    avatar.classList.add('has-photo');
  } else {
    avatar.innerHTML = initial;
    avatar.classList.remove('has-photo');
  }
};

window._refreshProfilePhotos = function() {
  Object.keys(window.USERS || {}).forEach(k => window._renderProfileCardPhoto(k));
};

// Card click: enter the app. (Camera button uses stopPropagation, so this fires for
// taps on the avatar / name area only.)
// ── Last-searched lead reminder popup ──────────────────────────────────────
// Shows once per login session if a lead was previously searched.
// Dismissed by clicking "Go to Lead" or "Dismiss".
window._showLastSearchedReminder = function(rem) {
  const modal = document.getElementById('modalLastSearchReminder');
  if (!modal) return;
  const nameEl  = document.getElementById('lsrLeadName');
  const tabEl   = document.getElementById('lsrLeadTab');
  const timeEl  = document.getElementById('lsrLeadTime');
  const label   = (window.TAB_LABELS && window.TAB_LABELS[rem.tab]) || rem.tab.toUpperCase();
  if (nameEl)  nameEl.textContent  = rem.name;
  if (tabEl)   tabEl.textContent   = label;
  if (timeEl)  timeEl.textContent  = rem.time ? ('Last searched: ' + rem.time) : '';
  modal.classList.add('active');
};

window._lsrGoToLead = function() {
  const modal = document.getElementById('modalLastSearchReminder');
  if (modal) modal.classList.remove('active');
  try {
    const remKey = 'bs_last_searched_' + (window.currentUser?.key || 'anon');
    const remRaw = localStorage.getItem(remKey);
    if (remRaw) {
      const rem = JSON.parse(remRaw);
      if (rem && rem.tab && rem.id) {
        window._topbarChatGoToLead(rem.tab, rem.id);
      }
    }
  } catch(e) {}
};

window._lsrDismiss = function() {
  const modal = document.getElementById('modalLastSearchReminder');
  if (modal) modal.classList.remove('active');
};

window._profileCardClick = function(event, userKey) {
  // If the click came from a control inside the card that already handled it, bail.
  if (event && event.defaultPrevented) return;
  // Show the "start fresh?" modal before entering the app
  window._pendingLoginUser = userKey;
  const modal = document.getElementById('modalLoginClear');
  if (modal) { modal.classList.add('active'); }
  else { window.enterApp(userKey); } // fallback if modal missing
};

// Called by the Yes/No buttons in the login clear modal
window._loginClearAnswer = async function(shouldClear) {
  const modal = document.getElementById('modalLoginClear');
  if (modal) modal.classList.remove('active');
  const userKey = window._pendingLoginUser;
  window._pendingLoginUser = null;
  if (!userKey) return;

  // Enter app first so state/leads are loaded
  await window.enterApp(userKey);

  if (!shouldClear) return; // No — keep everything as-is

  // Yes — clear all checkboxes across all tabs
  const CHK_FIELDS = ['call','vm','emailChk','text','upload'];
  const allTabs = window.ALL_TABS || Object.keys(window.state.leads);
  allTabs.forEach(tab => {
    (window.state.leads[tab] || []).forEach(lead => {
      const needsReset = CHK_FIELDS.some(f => lead[f]);
      if (needsReset) {
        CHK_FIELDS.forEach(f => lead[f] = false);
        window._queueSave({ action:'updateLead', tab, lead: JSON.stringify(lead) });
      }
    });
  });
  // Clear EOD
  window.state.eod = [];
  window._queueSave({ action:'saveMeta', eod:'[]' });
  // Re-render current tab
  const activeTab = window.state.activeTab || (window.ALL_TABS && window.ALL_TABS[0]);
  if (activeTab) {
    if (activeTab === 'intake') window.renderIntakeList();
    else window.renderLeadPage(activeTab);
  }
  // Update EOD display if visible
  if (typeof window.renderEODLog === 'function') window.renderEODLog();
};

// Right-click to remove a stored photo.
window._profileCardContext = function(event, userKey) {
  if (!window._getProfilePhoto(userKey)) return; // nothing to remove
  event.preventDefault();
  if (confirm('Remove ' + (window.USERS[userKey]?.name || 'this user') + "'s photo?")) {
    window._clearProfilePhoto(userKey);
  }
};

// Topbar user badge: show photo (if any) + name. Falls back to plain name.
window._refreshTopbarUserBadge = function() {
  const badge = document.getElementById('topbarUserBadge');
  if (!badge) return;
  const user = window.currentUser;
  if (!user) { badge.innerHTML = ''; return; }
  const photo = window._getProfilePhoto(user.key);
  if (photo) {
    badge.classList.add('has-photo');
    badge.innerHTML = `<img src="${photo}" class="user-badge-photo" alt=""><span>${user.name}</span>`;
  } else {
    badge.classList.remove('has-photo');
    badge.textContent = user.name;
  }
};

// Render stored photos as soon as the profile page is shown.
(function _initProfilePhotoRender() {
  const tryRender = () => {
    if (document.querySelector('.profile-card')) {
      window._refreshProfilePhotos();
    } else {
      setTimeout(tryRender, 50);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryRender);
  } else {
    tryRender();
  }
})();

window.doLogout = function() {
  window.stopPolling();
  document.getElementById('appPage').style.display = 'none';
  document.getElementById('chatBtn').style.display = 'none';
  document.getElementById('profilePage').style.display = 'flex';
  window.currentUser = null;
};

window.loadAllData = async function(silent, initial) {
  if (!silent) window.setSyncStatus('syncing', 'Loading...');
  else window.setSyncStatus('syncing', 'Auto-syncing...');
  
  const [lr, mr] = await Promise.all([
    window.api({ action: 'getAll' }),
    window.api({ action: 'getMeta' })
  ]);

  const sheetLeads = lr.leads || {};

  if (initial) {
    window.state.leads = sheetLeads;
    window.ALL_TABS.forEach(t => {
      if (!Array.isArray(window.state.leads[t])) window.state.leads[t] = [];
      // Deduplicate by id — the sheet can accumulate duplicate rows (e.g. from
      // failed moves/deletes). Keep the last occurrence so the most recent
      // field values win, and eliminate ghost entries that reappear on login.
      const seen = new Map();
      window.state.leads[t].forEach(l => { if (l.id) seen.set(l.id, l); });
      window.state.leads[t] = [...seen.values()];
      // Sanitize all date fields on every lead coming from the sheet
      window.state.leads[t].forEach(l => window.sanitizeLeadDates && window.sanitizeLeadDates(l));
    });
    // Apply persisted local overrides — fields the user changed locally that haven't expired
    if (window._localOverrides && typeof window._localOverrides === 'object') {
      const now = Date.now();
      window.ALL_TABS.forEach(t => {
        (window.state.leads[t]||[]).forEach(lead => {
          const ov = window._localOverrides[lead.id];
          if (!ov) return;
          Object.keys(ov).forEach(field => {
            if ((ov[field]||0) < now) return;
            // For boolean fields like 'starred' and 'prioTomorrow', the override means
            // "the user toggled this off recently — ignore sheet's stale value"
            if (field === 'starred' || field === 'prioTomorrow') {
              // Look up the locally-cached value from localStorage if available
              const cacheKey = (window.userPrefix?window.userPrefix():'')+'overrideValues';
              try{
                const cached = JSON.parse(localStorage.getItem(cacheKey)||'{}');
                if (cached[lead.id] && cached[lead.id][field] !== undefined) {
                  lead[field] = cached[lead.id][field];
                }
              }catch(e){}
            }
          });
        });
      });
    }
  } else {
    window.ALL_TABS.forEach(t => {
      const crmArray   = window.state.leads[t] || [];
      const sheetArray = Array.isArray(sheetLeads[t]) ? sheetLeads[t] : [];
      // Sanitize incoming sheet data before merging
      sheetArray.forEach(l => window.sanitizeLeadDates && window.sanitizeLeadDates(l));
      const sheetMap   = new Map(sheetArray.map(l => [l.id, l]));
      crmArray.forEach(crmLead => {
        const fresh = sheetMap.get(crmLead.id);
        if (fresh) {
          const now = Date.now();
          // _localOverrides: { leadId: { field: expiresAt } }
          // Any field overridden locally within the last 15s is protected
          // from being overwritten by a stale sheet response
          const overrides = window._localOverrides?.[crmLead.id] || {};
          Object.keys(fresh).forEach(k => {
            if (k === 'id') return;
            const protectedUntil = overrides[k] || 0;
            if (now < protectedUntil) return; // local value wins
            crmLead[k] = fresh[k];
          });
          sheetMap.delete(crmLead.id);
        }
      });
      sheetMap.forEach(newLead => crmArray.push(newLead));
      // Deduplicate by id in case the sheet has accumulated duplicate rows
      const seenRefresh = new Map();
      crmArray.forEach(l => { if (l.id) seenRefresh.set(l.id, l); });
      window.state.leads[t] = [...seenRefresh.values()];
    });
    // Do not rewrite Sheet row order during login or auto-sync.
    // Reordering is a write operation and must happen only after an intentional
    // user reorder, not every time fresh data is loaded.
  }

  window.state.templates    = _safeArray(mr.templates).length ? _safeArray(mr.templates) : [];
  // SMS templates: sheet is source of truth (cross-device sync), 
  // localStorage is offline-resilience cache (survives temporary connection loss).
  const lsKey = window.userPrefix() + 'smsTemplates';
  const fromSheet = _safeArray(mr.smsTemplates);
  if (fromSheet.length > 0) {
    // Sheet has data → use it, mirror to localStorage for offline access
    window.state.smsTemplates = fromSheet;
    try { localStorage.setItem(lsKey, JSON.stringify(fromSheet)); } catch(e) {}
  } else {
    // Sheet empty → check localStorage (could be: never synced, or sheet rebuilt)
    try {
      const lsRaw = localStorage.getItem(lsKey);
      const lsArr = lsRaw ? JSON.parse(lsRaw) : [];
      window.state.smsTemplates = Array.isArray(lsArr) ? lsArr : [];
      // If localStorage has templates that the sheet doesn't, push them back to sheet
      if (window.state.smsTemplates.length > 0 && window._queueSave) {
        window._queueSave({ action:'saveMeta', smsTemplates: JSON.stringify(window.state.smsTemplates) });
      }
    } catch(e) {
      window.state.smsTemplates = [];
    }
  }

  // OpenRouter API key: same pattern (sheet → localStorage cache)
  if (mr.openrouterKey && typeof mr.openrouterKey === 'string') {
    window.openrouterKey = mr.openrouterKey;
    try { localStorage.setItem(window.userPrefix() + 'openrouter_key', mr.openrouterKey); } catch(e) {}
  }

  window.state.attorneys    = _safeArray(mr.attorneys).length ? _safeArray(mr.attorneys) : ['Binh', 'Faris', 'Samantha'];
  window.state.emailHistory = _safeObject(mr.emailHistory);
  window.state.eod          = _safeArray(mr.eod);
  window.state.sequences    = _safeObject(mr.sequences);
  window.state.scheduled    = _safeArray(mr.scheduled);

  // ✅ Load settings that must survive browser cache clears
  const _loadBackendPref = (key, metaKey) => {
    if (mr[metaKey]) {
      try { localStorage.setItem(window.userPrefix() + key, typeof mr[metaKey] === 'string' ? mr[metaKey] : JSON.stringify(mr[metaKey])); } catch(e) {}
    }
  };
  _loadBackendPref('evidence_opts',   'evidenceOpts');
  _loadBackendPref('evidence_codes',  'evidenceCodes');
  _loadBackendPref('status_opts',     'statusOpts');
  _loadBackendPref('theme_custom',    'themeCustom');
  _loadBackendPref('ticker_verses',   'tickerVerses');
  _loadBackendPref('ticker_speed',    'tickerSpeed');

  // ✅ Load sticky notes from backend
  if (mr.stickyNotes) {
    try {
      const sn = typeof mr.stickyNotes === 'string' ? JSON.parse(mr.stickyNotes) : mr.stickyNotes;
      if (Array.isArray(sn) && sn.length) {
        window.state.stickyNotes = sn;
        if (typeof window._mergeStickyNotesFromBackend === 'function') window._mergeStickyNotesFromBackend(sn);
      }
    } catch(e) { console.warn('Failed to parse sticky notes from backend:', e); }
  }

  if (mr.customTabs) {
    try {
      const ct = typeof mr.customTabs === 'string' ? JSON.parse(mr.customTabs) : mr.customTabs;
      if (ct && ct.tabs) {
        const merged = { tabs: ct.tabs, labels: ct.labels || {} };
        localStorage.setItem('bs_custom_tabs', JSON.stringify(merged));
        if (typeof window._loadCustomTabs === 'function') window._loadCustomTabs();
      }
    } catch(e) {}
  }

  window.updateCounters();

  if (!initial) {
    window._patchVisibleCells();
  } else {
    if (document.getElementById('appPage').style.display !== 'none') {
      const activeNav = document.querySelector('.nav-item.active');
      if (activeNav) {
        const tab = activeNav.id.replace('nav-', '');
        if (tab && !['settings', 'eod', 'sequences'].includes(tab)) {
          if (typeof window.renderLeadPage === 'function') window.renderLeadPage(tab);
        }
      }
    }
  }

  window.setSyncStatus('ok', 'Synced ' + new Date().toLocaleTimeString());
};

window._pushOrderToSheet = function() {
  const order = {};
  window.ALL_TABS.forEach(t => {
    order[t] = (window.state.leads[t] || []).map(l => l.id);
  });
  if (window.SCRIPT_URL) {
    fetch(window.CORS_PROXY_URL || window.SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({
        _targetUrl: window.SCRIPT_URL,
        action: 'reorderLeads',
        order: JSON.stringify(order)
      }),
      headers: { 'Content-Type': 'text/plain' }
    }).catch(() => {});
  }
};

window._patchVisibleCells = function() {
  // Skip full re-renders if the user is actively interacting with the table
  // (typing in a cell, has a dropdown open, has a modal open, etc.)
  const active = document.activeElement;
  const userBusy = active && (
    active.tagName === 'INPUT' ||
    active.tagName === 'SELECT' ||
    active.tagName === 'TEXTAREA' ||
    active.isContentEditable ||
    active.closest('.modal-overlay, .send-preview-overlay, .sms-gen-overlay, .schedule-email-overlay, .email-history-overlay, .edit-lead-overlay, .evidence-menu, #ctxMenu')
  );

  const _preserveScroll = (selector, renderFn) => {
    const wrap = document.querySelector(selector);
    const sx = wrap ? wrap.scrollLeft : 0;
    const sy = wrap ? wrap.scrollTop  : 0;
    try { renderFn(); } catch(e){ console.warn('Re-render failed:', e); return; }
    requestAnimationFrame(() => {
      const w2 = document.querySelector(selector);
      if (w2) { w2.scrollLeft = sx; w2.scrollTop = sy; }
    });
  };

  // If the intake page is active, do a full re-render to avoid any column-mapping
  // drift that can happen when polling races with user interactions. Cell-level
  // patching is fragile when select/dropdown cells get replaced; a full render
  // is cheap and guaranteed correct.
  if (!userBusy) {
    const intakeActive = document.getElementById('page-intake')?.classList.contains('active');
    if (intakeActive && typeof window.renderIntakeList === 'function') {
      _preserveScroll('#intake-table-wrap', window.renderIntakeList);
    }
    // Same defensive full-render for non-intake lead pages
    const activeLeadTabs = ['pc','star','o','dbb','clients','retainer','drop'];
    for (const t of activeLeadTabs) {
      const page = document.getElementById('page-'+t);
      if (page && page.classList.contains('active')) {
        if (typeof window.renderLeadPage === 'function') {
          _preserveScroll('#leadtable-wrap-'+t+', .leadtable-wrap', () => window.renderLeadPage(t));
        }
        break;
      }
    }
  }

  // For any other rows (e.g. Today's Focus modal) that we don't fully re-render,
  // still patch individual cells.
  document.querySelectorAll('tr[data-id][data-tab]').forEach(row => {
    // Skip rows inside the main lead tables (already re-rendered above)
    if (row.closest('#intake-table-wrap, .leadtable-wrap, [id^="leadtable-wrap-"]')) return;
    const id   = row.dataset.id;
    const tab  = row.dataset.tab;
    const lead = window.findLeadById(id);
    if (!lead) return;
    try { window._patchRowDOM(tab, lead); } catch(e) {}
  });
};

window.manualRefresh = async function() {
  window.setSyncStatus('syncing', 'Refreshing...');
  try {
    await window.loadAllData(false, false);
    window.setSyncStatus('ok', 'Refreshed ' + new Date().toLocaleTimeString());
  } catch(e) {
    window.setSyncStatus('err', 'Refresh failed: ' + e.message);
  }
};

window.startPolling = function() {
  // Auto-sync polling is disabled by user preference.
  // The CRM now only syncs when the user makes changes (saves go through _queueSave).
  // To manually refresh from the sheet, use the Refresh button which calls window.manualRefresh().
  window.stopPolling();
};

window.stopPolling  = function() {
  if (window._pollTimer)      { clearTimeout(window._pollTimer);       window._pollTimer      = null; }
  if (window._durationTicker) { clearInterval(window._durationTicker); window._durationTicker = null; }
};

// ✅ REMOVED: window.startDurationTicker function entirely (no longer needed)

window.showIntakeDoneStep = function(n) {
  [1, 2, 3].forEach(s => {
    document.getElementById('intakeDoneStep' + s).style.display = s === n ? 'block' : 'none';
  });
  const bar = document.getElementById('intakeDoneStepBar');
  bar.innerHTML = ['Send Email', 'Move Tab', 'Confirm'].map((lbl, idx) => {
    const s   = idx + 1;
    const cls = s < n ? 'done' : s === n ? 'active' : '';
    return (idx > 0 ? '<div class="step-line"></div>' : '') +
      `<div class="step-dot ${cls}">${s < n ? '✓' : s}</div>` +
      `<span style="font-size:11px;color:${s === n ? 'var(--primary)' : 'var(--text-muted)'};font-weight:${s === n ? 600 : 400}">${lbl}</span>`;
  }).join('');
};

window.previewIntakeThankyou = function() {
  if (!window.intakeDoneLead || window.intakeDoneLead.id !== window.intakeProcessingId) return;
  const idx = document.getElementById('intakeDoneTmplSelect').value;
  const pv  = document.getElementById('intakeThankyouPreview');
  if (idx === '') { pv.style.display = 'none'; return; }
  const t  = window.state.templates[parseInt(idx)];
  const fn = window.intakeDoneLead.name.trim().split(' ')[0];
  document.getElementById('intakeThankyouSubj').value =
    t.subject.replace(/{name}/g, fn).replace(/{email}/g, window.intakeDoneLead.email || '');
  document.getElementById('intakeThankyouBody').value =
    t.body.replace(/{name}/g, fn).replace(/{email}/g, window.intakeDoneLead.email || '');
  pv.style.display = 'block';
  window.updateIntakePreview();
};

window.updateIntakePreview = function() {
  const s = document.getElementById('intakeThankyouSubj').value;
  const b = document.getElementById('intakeThankyouBody').value;
  document.getElementById('intakeThankyouPreviewBox').textContent =
    (s ? 'Subject: ' + s + '\n\n' : '') + b;
};

window.intakeDoneStep2 = async function() {
  if (!window.intakeDoneLead || window.intakeDoneLead.id !== window.intakeProcessingId) {
    window.closeModal('modalIntakeDone'); return;
  }
  const idx  = document.getElementById('intakeDoneTmplSelect').value;
  const user = window.currentUser?.name || 'Jay';
  if (idx !== '') {
    const subj = document.getElementById('intakeThankyouSubj').value;
    const body = document.getElementById('intakeThankyouBody').value;
    if (window.intakeDoneLead.email && subj) {
      const r = await window.sendGmailDirect(window.intakeDoneLead.email, subj, body);
      const entry = {
        id: Date.now(), subject: subj, sentAt: window.nowFmt(),
        status: r.sent ? 'Sent' : 'Failed', sentBy: user, sequence: false
      };
      if (!window.state.emailHistory[window.intakeDoneLead.id])
        window.state.emailHistory[window.intakeDoneLead.id] = [];
      window.state.emailHistory[window.intakeDoneLead.id].unshift(entry);
      try { await window.api({ action: 'logEmail', leadId: window.intakeDoneLead.id, entry: JSON.stringify(entry) }); } catch(e) {}
      if (r.sent) window.upsertTodaysEodEntry({
        leadId: window.intakeDoneLead.id, leadName: window.intakeDoneLead.name,
        tab: 'intake', newText: `Chased intake - ${window.intakeDoneLead.name}`
      });
    }
  }
  window.showIntakeDoneStep(2);
};

window.intakeDoneStep3 = function() {
  if (!window.intakeDoneLead || window.intakeDoneLead.id !== window.intakeProcessingId) {
    window.closeModal('modalIntakeDone'); return;
  }
  const dest   = document.getElementById('intakeDoneDestTab').value;
  const gdrive = document.getElementById('intakeDoneGdrive').value.trim();
  if (!gdrive) { window.showSuccess('Missing Link', 'Google Drive link is required.'); return; }
  const sent = document.getElementById('intakeDoneTmplSelect').value !== '';
  document.getElementById('intakeDoneConfirmText').innerHTML =
    `Move <strong>${window.intakeDoneLead.name}</strong> to <strong>${window.TAB_LABELS[dest] || dest}</strong>?` +
    (sent ? '<br><span style="font-size:11px;color:var(--success-text)">✓ Thank-you email sent.</span>' : '') +
    `<br><span style="font-size:11px;color:var(--text-muted)">Drive: ${gdrive}</span>`;
  window.showIntakeDoneStep(3);
};

window.intakeDoneExecute = async function() {
  if (!window.intakeDoneLead || window.intakeDoneLead.id !== window.intakeProcessingId) {
    window.closeModal('modalIntakeDone'); return;
  }
  const dest      = document.getElementById('intakeDoneDestTab').value;
  const gdrive    = document.getElementById('intakeDoneGdrive').value.trim();
  const freshLead = window.state.leads.intake.find(l => l.id === window.intakeProcessingId);
  if (!freshLead) {
    window.showSuccess('Not Found', 'This lead is no longer in Intake. Please refresh.');
    window.closeModal('modalIntakeDone');
    return;
  }
  const lead = { ...freshLead, gdrive };
  window.state.leads.intake = window.state.leads.intake.filter(l => l.id !== freshLead.id);
  if (!window.state.leads[dest]) window.state.leads[dest] = [];
  window.state.leads[dest].push(lead);
  window.closeModal('modalIntakeDone');
  window.renderIntakeList();
  window.updateCounters();
  window.playNotifSound();
  try { await window.api({ action: 'moveLead', fromTab: 'intake', toTab: dest, id: lead.id }); } catch(e) {}
  window.showSuccess('Moved!', `${lead.name} → ${window.TAB_LABELS[dest] || dest}.`);
};

window._autoConnectGmail = async function() {
  try {
    const r = await window.api({ action: 'getGmailToken' });
    if (r.token) {
      window.gmailToken = r.token;
      localStorage.setItem(window.userPrefix() + 'gmail_token', r.token);
      if (r.email) localStorage.setItem(window.userPrefix() + 'gmail_email', r.email);
      window.updateGmailStatusBar();
      clearInterval(window._gmailRefreshTimer);
      window._gmailRefreshTimer = setInterval(async () => {
        try {
          const rr = await window.api({ action: 'getGmailToken' });
          if (rr.token) {
            window.gmailToken = rr.token;
            localStorage.setItem(window.userPrefix() + 'gmail_token', rr.token);
            if (rr.email) localStorage.setItem(window.userPrefix() + 'gmail_email', rr.email);
            window.updateGmailStatusBar();
          }
        } catch(e) { console.warn('Gmail token refresh failed:', e.message); }
      }, 45 * 60 * 1000);
    }
  } catch(e) {
    console.warn('Gmail auto-connect failed:', e.message);
  }
};

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.target.isContentEditable) return;
  const navItems = [...document.querySelectorAll('#sidebar .nav-item')];
  const active   = navItems.findIndex(n => n.classList.contains('active'));
  if (e.key === 'ArrowDown' && active < navItems.length - 1) { navItems[active + 1].focus(); e.preventDefault(); }
  if (e.key === 'ArrowUp'   && active > 0)                   { navItems[active - 1].focus(); e.preventDefault(); }
  if (e.key === 'Enter') { const f = document.activeElement; if (f && f.classList.contains('nav-item')) f.click(); }
  const rows = [...document.querySelectorAll('tr[tabindex]')];
  const ri   = rows.findIndex(r => r === document.activeElement);
  if (e.key === 'ArrowDown' && ri < rows.length - 1) { rows[ri + 1].focus(); e.preventDefault(); }
  if (e.key === 'ArrowUp'   && ri > 0)               { rows[ri - 1].focus(); e.preventDefault(); }
});

// ===================== PHILIPPINE REAL-TIME CLOCK =====================
// Ticks once per second. Always reads the actual current time in
// Asia/Manila regardless of the user's system timezone (works in PH,
// works abroad, works on a misconfigured machine). Uses Intl with
// the explicit timeZone option so the browser does the conversion.
(function _initPhClock() {
  const tick = () => {
    const el = document.querySelector('#phClock .ph-clock-time');
    if (!el) return;
    try {
      const now = new Date();
      const time = now.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      el.textContent = time;
    } catch (e) {
      // Fallback for very old browsers without timeZone support:
      // PH is UTC+8, no DST.
      const utc = Date.now();
      const ph  = new Date(utc + 8 * 3600 * 1000);
      let h = ph.getUTCHours();
      const m = String(ph.getUTCMinutes()).padStart(2, '0');
      const s = String(ph.getUTCSeconds()).padStart(2, '0');
      const ap = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      el.textContent = `${String(h).padStart(2,'0')}:${m}:${s} ${ap}`;
    }
  };

  // Align to the next whole-second boundary so the clock ticks
  // cleanly instead of drifting (a setInterval started off-beat
  // will tick at .47s, .47s, ... forever; this anchors at .00).
  const start = () => {
    tick();
    const delay = 1000 - (Date.now() % 1000);
    setTimeout(() => {
      tick();
      setInterval(tick, 1000);
    }, delay);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
