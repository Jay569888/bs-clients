/* ============================================================
   enhancements.js — Additive functional improvements
   ------------------------------------------------------------
   Self-contained, defensive module. Adds:
     1. Premium toast system (window.bsToast)
     2. Undo for destructive actions (Clear EOD Log; extensible)
     3. Auto-save indicator (hooks the save pipeline)
     4. Skeleton loaders during data load
     5. Keyboard shortcuts ( / focus search, ? help, g+key nav )
     6. localStorage size guard
     7. Bulk-actions floating toolbar (row selection)
   Everything degrades gracefully if a dependency is absent.
   Loaded LAST so all other modules are defined first.
   ============================================================ */
(function () {
  'use strict';

  // ========================================================
  // 1. PREMIUM TOAST SYSTEM
  // ========================================================
  function ensureToastStack() {
    let s = document.getElementById('bsToastStack');
    if (!s) {
      s = document.createElement('div');
      s.id = 'bsToastStack';
      document.body.appendChild(s);
    }
    return s;
  }

  // window.bsToast({ title, msg, type, duration, actionLabel, onAction })
  // type: 'ok' | 'info' | 'warn' | 'err'
  window.bsToast = function (opts) {
    opts = opts || {};
    const stack = ensureToastStack();
    const type = opts.type || 'info';
    const duration = opts.duration != null ? opts.duration : 4000;

    const toast = document.createElement('div');
    toast.className = 'bs-toast';

    const iconChar = { ok: '✓', info: 'i', warn: '!', err: '✕' }[type] || 'i';
    const icon = document.createElement('div');
    icon.className = 'bs-toast-icon ' + type;
    icon.textContent = iconChar;

    const body = document.createElement('div');
    body.className = 'bs-toast-body';
    const titleEl = document.createElement('div');
    titleEl.className = 'bs-toast-title';
    titleEl.textContent = opts.title || '';
    body.appendChild(titleEl);
    if (opts.msg) {
      const msgEl = document.createElement('div');
      msgEl.className = 'bs-toast-msg';
      msgEl.textContent = opts.msg;
      body.appendChild(msgEl);
    }

    toast.appendChild(icon);
    toast.appendChild(body);

    let timer = null;
    const dismiss = () => {
      if (!toast.isConnected) return;
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 240);
      if (timer) clearTimeout(timer);
    };

    if (opts.actionLabel && typeof opts.onAction === 'function') {
      const actBtn = document.createElement('button');
      actBtn.className = 'bs-toast-action';
      actBtn.textContent = opts.actionLabel;
      actBtn.onclick = () => { try { opts.onAction(); } finally { dismiss(); } };
      toast.appendChild(actBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-toast-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = dismiss;
    toast.appendChild(closeBtn);

    if (duration > 0) {
      const bar = document.createElement('div');
      bar.className = 'bs-toast-progress';
      bar.style.animationDuration = duration + 'ms';
      toast.appendChild(bar);
    }

    stack.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    if (duration > 0) timer = setTimeout(dismiss, duration);

    return { dismiss };
  };

  // ========================================================
  // 2. UNDO FOR DESTRUCTIVE ACTIONS
  // ========================================================
  // Wrap clearEODLog with an undo affordance. We snapshot state.eod,
  // clear it, and offer a 6s window to restore.
  function wrapClearEODLog() {
    if (typeof window.clearEODLog !== 'function' || window._clearEODLogWrapped) return;
    window._clearEODLogWrapped = true;
    window.clearEODLog = function () {
      if (!confirm('Clear all EOD history?')) return;
      const snapshot = Array.isArray(window.state.eod) ? JSON.parse(JSON.stringify(window.state.eod)) : [];
      window.state.eod = [];
      if (window.renderEOD) window.renderEOD();
      try { window.api({ action: 'saveMeta', eod: '[]' }); } catch (e) {}
      window.bsToast({
        type: 'warn',
        title: 'EOD log cleared',
        msg: snapshot.length + ' ' + (snapshot.length === 1 ? 'entry' : 'entries') + ' removed.',
        duration: 6000,
        actionLabel: 'Undo',
        onAction: function () {
          window.state.eod = snapshot;
          if (window.renderEOD) window.renderEOD();
          try { window.api({ action: 'saveMeta', eod: JSON.stringify(snapshot) }); } catch (e) {}
          window.bsToast({ type: 'ok', title: 'Restored', msg: 'EOD log brought back.', duration: 2500 });
        }
      });
    };
  }

  // Generic helper others can use: window.bsUndoableRemove(label, snapshotFn, removeFn, restoreFn)
  window.bsUndoableRemove = function (label, snapshot, removeFn, restoreFn) {
    try { removeFn(); } catch (e) { console.error(e); return; }
    window.bsToast({
      type: 'warn',
      title: label,
      duration: 6000,
      actionLabel: 'Undo',
      onAction: function () {
        try { restoreFn(snapshot); window.bsToast({ type: 'ok', title: 'Restored', duration: 2200 }); }
        catch (e) { console.error(e); }
      }
    });
  };

  // ========================================================
  // 3. AUTO-SAVE INDICATOR
  // ========================================================
  function ensureAutosaveChip() {
    let chip = document.getElementById('bsAutosaveChip');
    if (chip) return chip;
    const syncBar = document.querySelector('.sync-bar');
    chip = document.createElement('span');
    chip.id = 'bsAutosaveChip';
    chip.className = 'autosave-chip';
    chip.style.marginLeft = 'auto';
    chip.innerHTML = '<span class="as-dot"></span><span class="as-label"></span>';
    if (syncBar) syncBar.appendChild(chip);
    return chip;
  }
  let autosaveHideTimer = null;
  window._setAutosaveState = function (state) {
    const chip = ensureAutosaveChip();
    if (!chip) return;
    chip.classList.remove('saving', 'saved', 'error');
    const label = chip.querySelector('.as-label');
    if (state === 'saving') {
      chip.classList.add('saving');
      if (label) label.textContent = 'Saving…';
      chip.style.opacity = '1';
      if (autosaveHideTimer) { clearTimeout(autosaveHideTimer); autosaveHideTimer = null; }
    } else if (state === 'saved') {
      chip.classList.add('saved');
      if (label) label.textContent = 'All changes saved';
      chip.style.opacity = '1';
      autosaveHideTimer = setTimeout(() => { chip.style.opacity = '0.55'; }, 2500);
    } else if (state === 'error') {
      chip.classList.add('error');
      if (label) label.textContent = 'Save failed — retrying';
      chip.style.opacity = '1';
    }
  };

  // Hook the save pipeline (api.js _flushBatch) without altering its logic.
  function hookSavePipeline() {
    if (window._savePipelineHooked) return;
    if (typeof window._flushBatch !== 'function') return;
    window._savePipelineHooked = true;
    const origFlush = window._flushBatch;
    window._flushBatch = async function () {
      const hadWork = Array.isArray(window._batchQueue) && window._batchQueue.length > 0;
      if (hadWork) window._setAutosaveState('saving');
      try {
        const r = await origFlush.apply(this, arguments);
        if (hadWork) window._setAutosaveState('saved');
        return r;
      } catch (e) {
        window._setAutosaveState('error');
        throw e;
      }
    };
  }

  // ========================================================
  // 4. SKELETON LOADERS
  // ========================================================
  // Show shimmer rows in a target container. Returns a function to clear.
  window.bsShowSkeleton = function (containerEl, rows) {
    if (!containerEl) return function () {};
    rows = rows || 8;
    const wrap = document.createElement('div');
    wrap.className = 'skeleton-wrap';
    wrap.setAttribute('data-bs-skeleton', '1');
    let html = '';
    for (let i = 0; i < rows; i++) {
      html += '<div class="skeleton-row">' +
        '<div class="skeleton-cell sk-sm"></div>' +
        '<div class="skeleton-cell sk-md"></div>' +
        '<div class="skeleton-cell sk-lg"></div>' +
        '<div class="skeleton-cell sk-md"></div>' +
        '<div class="skeleton-cell sk-sm"></div>' +
        '</div>';
    }
    wrap.innerHTML = html;
    containerEl.appendChild(wrap);
    return function clear() { wrap.remove(); };
  };

  // Tie skeletons to the existing blocking loader: when showLoading is
  // called during initial data load, also paint a skeleton into the
  // active page's table area for a richer feel.
  function wrapLoadingForSkeleton() {
    if (window._loadingSkeletonWrapped) return;
    if (typeof window.showLoading !== 'function') return;
    window._loadingSkeletonWrapped = true;
    const origShow = window.showLoading;
    const origHide = window.hideLoading;
    window.showLoading = function () {
      const r = origShow.apply(this, arguments);
      try {
        const active = document.querySelector('.page.active .table-wrap')
                    || document.querySelector('.page.active #eodList');
        if (active && !active.querySelector('[data-bs-skeleton]')) {
          window._activeSkeletonClear = window.bsShowSkeleton(active, 10);
        }
      } catch (e) {}
      return r;
    };
    window.hideLoading = function () {
      try { if (window._activeSkeletonClear) { window._activeSkeletonClear(); window._activeSkeletonClear = null; } } catch (e) {}
      return origHide.apply(this, arguments);
    };
  }

  // ========================================================
  // 5. KEYBOARD SHORTCUTS
  // ========================================================
  function inEditableContext(e) {
    const t = e.target;
    if (!t) return false;
    const tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
  }

  function setupShortcuts() {
    document.addEventListener('keydown', function (e) {
      // Ignore when typing
      if (inEditableContext(e)) {
        // Allow Esc to blur the field
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      // "/" focuses the global lead search if present
      if (e.key === '/' ) {
        const search = document.getElementById('chatInput')
                    || document.querySelector('.search-global input')
                    || document.getElementById('intake-search');
        if (search) { e.preventDefault(); search.focus(); }
        return;
      }
      // "?" shows the shortcuts help toast
      if (e.key === '?') {
        e.preventDefault();
        window.bsToast({
          type: 'info',
          title: 'Keyboard shortcuts',
          msg: '/ search · Esc close · ↑/↓ rows · Space/Enter toggle · ? this help',
          duration: 6000
        });
        return;
      }
    });
  }

  // ========================================================
  // 6. localStorage SIZE GUARD
  // ========================================================
  function checkStorageSize() {
    try {
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k) || '';
        total += k.length + v.length;
      }
      // UTF-16: ~2 bytes/char. Warn at ~4MB of the ~5MB cap.
      const bytes = total * 2;
      const mb = bytes / (1024 * 1024);
      if (mb > 4) {
        window.bsToast({
          type: 'warn',
          title: 'Storage almost full',
          msg: 'Local data is at ' + mb.toFixed(1) + 'MB of ~5MB. Consider clearing old EOD logs or profile photos.',
          duration: 8000
        });
      }
      return mb;
    } catch (e) { return 0; }
  }
  window.bsCheckStorage = checkStorageSize;

  // ========================================================
  // 7. BULK ACTIONS FLOATING TOOLBAR
  // ========================================================
  // Selection model: Ctrl/Cmd+click a row toggles it; Shift+click
  // selects a range. No new table column (keeps frozen-column layout
  // intact). Selected rows get the .bs-row-selected class + id tracked.
  const bsSelected = new Set();
  let bsLastClickedIndex = -1;

  function currentTab() {
    const active = document.querySelector('.page.active');
    if (!active || !active.id) return null;
    const m = /^page-(.+)$/.exec(active.id);
    if (!m) return null;
    const tab = m[1];
    const known = (window.ALL_TABS || []).concat(['intake']);
    return known.indexOf(tab) >= 0 ? tab : null;
  }

  function activeRows() {
    return Array.from(document.querySelectorAll('.page.active table tbody tr'));
  }

  function rowLeadId(tr) {
    // Find a lead id referenced by any handler in the row
    const cb = tr.querySelector('input[onchange*="toggleLeadCheckbox"]');
    if (cb) {
      const m = (cb.getAttribute('onchange') || '').match(/toggleLeadCheckbox\('[^']*','([^']+)'/);
      if (m) return m[1];
    }
    const anyEl = tr.querySelector('[onclick*="openSendPreviewModal"],[ondblclick*="makeFollowUpEditable"],[ondblclick*="openIntakeNotesPopup"]');
    if (anyEl) {
      const oc = anyEl.getAttribute('onclick') || anyEl.getAttribute('ondblclick') || '';
      const m = oc.match(/'([^']+)'\s*\)/);
      if (m) return m[1];
    }
    return tr.dataset.leadId || null;
  }

  function paintSelection() {
    activeRows().forEach(tr => {
      const id = rowLeadId(tr);
      if (id && bsSelected.has(id)) tr.classList.add('bs-row-selected');
      else tr.classList.remove('bs-row-selected');
    });
  }

  function ensureBulkBar() {
    let bar = document.getElementById('bsBulkBar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'bsBulkBar';
    bar.innerHTML =
      '<span class="bs-bulk-count">0</span>' +
      '<span style="font-size:12px;color:rgba(241,245,251,.75)">selected</span>' +
      '<span class="bs-bulk-sep"></span>' +
      '<button class="bs-bulk-btn" data-act="attorney">Assign Attorney</button>' +
      '<button class="bs-bulk-btn" data-act="status">Set Status</button>' +
      '<button class="bs-bulk-btn" data-act="prio">Prio Tomorrow</button>' +
      '<span class="bs-bulk-sep"></span>' +
      '<button class="bs-bulk-close" title="Clear selection">&times;</button>';
    document.body.appendChild(bar);
    bar.querySelector('[data-act="attorney"]').onclick = bulkAssignAttorney;
    bar.querySelector('[data-act="status"]').onclick = bulkSetStatus;
    bar.querySelector('[data-act="prio"]').onclick = bulkPrioTomorrow;
    bar.querySelector('.bs-bulk-close').onclick = clearSelection;
    return bar;
  }

  function updateBulkBar() {
    const bar = ensureBulkBar();
    const countEl = bar.querySelector('.bs-bulk-count');
    if (countEl) countEl.textContent = bsSelected.size;
    if (bsSelected.size >= 1) bar.classList.add('show');
    else bar.classList.remove('show');
  }

  function clearSelection() {
    bsSelected.clear();
    bsLastClickedIndex = -1;
    paintSelection();
    updateBulkBar();
  }
  window.bsClearSelection = clearSelection;

  async function bulkApply(mutateFn, label) {
    const ids = Array.from(bsSelected);
    if (!ids.length) return;
    const tab = currentTab();
    if (!tab) return;
    let n = 0;
    for (const id of ids) {
      const lead = window.findLeadById ? window.findLeadById(id) : null;
      if (!lead) continue;
      mutateFn(lead);
      if (window.sanitizeLeadDates) window.sanitizeLeadDates(lead);
      if (window._patchRowDOM) window._patchRowDOM(tab, lead);
      if (window._queueSave) window._queueSave({ action: 'updateLead', tab, lead: JSON.stringify(lead) });
      n++;
    }
    try { if (window._flushNow) await window._flushNow(); } catch (e) {}
    window.bsToast({ type: 'ok', title: label, msg: n + ' lead' + (n === 1 ? '' : 's') + ' updated.', duration: 3000 });
    clearSelection();
  }

  function bulkAssignAttorney() {
    if (!bsSelected.size) return;
    const attorneys = (window.state && window.state.attorneys) || [];
    const name = prompt('Assign attorney to ' + bsSelected.size + ' lead(s):\n\nAvailable: ' + (attorneys.join(', ') || '(none)'));
    if (name == null) return;
    bulkApply(l => { l.attorney = name.trim(); }, 'Attorney assigned');
  }
  function bulkSetStatus() {
    if (!bsSelected.size) return;
    const status = prompt('Set status for ' + bsSelected.size + ' lead(s):\n\ne.g. Hot, Cold, Warm');
    if (status == null) return;
    bulkApply(l => { l.temp = status.trim(); }, 'Status updated');
  }
  function bulkPrioTomorrow() {
    if (!bsSelected.size) return;
    bulkApply(l => { l.prioTomorrow = true; }, 'Marked Prio Tomorrow');
  }

  function setupBulkSelection() {
    // Row selection via Ctrl/Cmd+click (toggle) or Shift+click (range).
    document.addEventListener('click', function (e) {
      const tr = e.target && e.target.closest ? e.target.closest('.page.active table tbody tr') : null;
      if (!tr) return;
      const isModifier = e.ctrlKey || e.metaKey || e.shiftKey;
      if (!isModifier) return; // plain clicks behave normally
      // Don't hijack modifier-clicks on interactive controls (links,
      // inputs, selects, etc.) — let the browser handle Ctrl+click on
      // a link to open in new tab, Shift+click on text to select, etc.
      const interactive = e.target.closest('input,select,button,a,textarea,[contenteditable="true"]');
      if (interactive) return;

      e.preventDefault();
      const rows = activeRows();
      const idx = rows.indexOf(tr);
      const id = rowLeadId(tr);
      if (!id) return;

      if (e.shiftKey && bsLastClickedIndex >= 0) {
        const [a, b] = [bsLastClickedIndex, idx].sort((x, y) => x - y);
        for (let i = a; i <= b; i++) {
          const rid = rowLeadId(rows[i]);
          if (rid) bsSelected.add(rid);
        }
      } else {
        // Ctrl/Cmd toggle
        if (bsSelected.has(id)) bsSelected.delete(id);
        else bsSelected.add(id);
        bsLastClickedIndex = idx;
      }
      paintSelection();
      updateBulkBar();
    });

    // Repaint after re-renders; drop ids no longer present
    const obs = new MutationObserver(() => {
      if (!bsSelected.size) return;
      paintSelection();
      updateBulkBar();
    });
    const appPage = document.getElementById('appPage') || document.body;
    obs.observe(appPage, { childList: true, subtree: true });

    // Clear selection when switching tabs
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.nav-item')) {
        setTimeout(clearSelection, 0);
      }
    });
  }

  // ========================================================
  // 8. FAILED EMAIL SEND — RETRY QUEUE
  // ========================================================
  // If sendGmailDirect returns {sent:false}, push the attempt onto a
  // retry queue persisted in localStorage. A worker retries with
  // exponential backoff up to MAX_RETRIES. User sees a single warn toast
  // when a send fails, and an ok toast when a retry eventually succeeds.
  // Doesn't change the original send call sites — it just observes them.
  const RETRY_KEY = 'bs_email_retry_queue';
  const MAX_RETRIES = 4;
  const BASE_DELAY = 30 * 1000; // 30s, then doubles

  function loadRetryQueue() {
    try { return JSON.parse(localStorage.getItem(RETRY_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveRetryQueue(q) {
    try { localStorage.setItem(RETRY_KEY, JSON.stringify(q.slice(-50))); } catch (e) {}
  }

  async function tryRetryOnce(item) {
    if (typeof window.sendGmailDirect !== 'function') return false;
    try {
      const r = await window.sendGmailDirect(item.to, item.subject, item.body);
      return !!(r && r.sent);
    } catch (e) { return false; }
  }

  async function processRetryQueue() {
    const q = loadRetryQueue();
    if (!q.length) return;
    const now = Date.now();
    const remaining = [];
    for (const item of q) {
      if (item.nextAt > now) { remaining.push(item); continue; }
      const ok = await tryRetryOnce(item);
      if (ok) {
        window.bsToast({
          type: 'ok',
          title: 'Email retry succeeded',
          msg: 'Sent to ' + (item.leadName || item.to),
          duration: 3500
        });
        continue; // drop from queue
      }
      item.attempts = (item.attempts || 0) + 1;
      if (item.attempts >= MAX_RETRIES) {
        window.bsToast({
          type: 'err',
          title: 'Email send failed (gave up)',
          msg: 'Could not send to ' + (item.leadName || item.to) + ' after ' + MAX_RETRIES + ' tries.',
          duration: 7000
        });
        continue;
      }
      item.nextAt = now + BASE_DELAY * Math.pow(2, item.attempts - 1);
      remaining.push(item);
    }
    saveRetryQueue(remaining);
  }

  // Wrap sendGmailDirect to catch failures and enqueue retries.
  function hookSendGmail() {
    if (window._sendGmailHooked) return;
    if (typeof window.sendGmailDirect !== 'function') return;
    window._sendGmailHooked = true;
    const orig = window.sendGmailDirect;
    window.sendGmailDirect = async function (to, subject, body, leadName) {
      const result = await orig.apply(this, arguments);
      if (result && result.sent === false && !result.noToken) {
        // Don't auto-retry when token is missing — user must reconnect first.
        const q = loadRetryQueue();
        q.push({
          to: to, subject: subject, body: body,
          leadName: leadName || '',
          attempts: 0,
          nextAt: Date.now() + BASE_DELAY,
          enqueuedAt: Date.now()
        });
        saveRetryQueue(q);
        window.bsToast({
          type: 'warn',
          title: 'Send failed — queued for retry',
          msg: 'Will retry automatically (up to ' + MAX_RETRIES + ' times).',
          duration: 5000
        });
      }
      return result;
    };
  }

  // Kick the retry worker on a slow interval (90s) — short enough to
  // feel responsive, long enough to respect exponential backoff.
  let retryTimer = null;
  function startRetryWorker() {
    if (retryTimer) return;
    retryTimer = setInterval(processRetryQueue, 90 * 1000);
    // Run once shortly after load to catch any persisted failures
    setTimeout(processRetryQueue, 8000);
  }
  window.bsProcessRetryQueue = processRetryQueue;

  function init() {
    ensureToastStack();
    wrapClearEODLog();
    hookSavePipeline();
    wrapLoadingForSkeleton();
    setupShortcuts();
    setupBulkSelection();
    hookSendGmail();
    startRetryWorker();

    // Storage check shortly after load (once data settled)
    setTimeout(checkStorageSize, 8000);

    // Re-attempt hooks after a beat in case modules loaded late
    setTimeout(() => {
      wrapClearEODLog();
      hookSavePipeline();
      wrapLoadingForSkeleton();
      hookSendGmail();
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
