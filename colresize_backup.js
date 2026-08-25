/* ============================================================
   colresize.js — Sheets-style persistent column resizing
   ------------------------------------------------------------
   Behavior matches Google Sheets:
   - A thin gray vertical line is always visible on the right
     edge of every column header.
   - Hovering it turns the line blue and shows the col-resize
     cursor; the line extends through the body of the column
     so you can see the boundary you're about to drag.
   - While dragging, the column itself does NOT resize in real
     time — instead, a vertical "guide line" follows the mouse
     across the table. The column snaps to the new width on
     mouse release. This avoids jittery table reflow during the
     drag.
   - Widths persist per user, per tab in localStorage and are
     restored on every render, refresh, and login.
   - Double-click the resize line to reset that column to its
     default width.

   We auto-wire tables via MutationObserver — no per-renderer
   hooks needed.
   ============================================================ */
(function () {
  'use strict';

  const MIN_W = 40;
  const MAX_W = 900;

  // ---------- helpers ----------

  function slug(s) {
    return String(s || '')
      .replace(/[▲▼↑↓★❤️🔗📞✏️✅—]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
  }

  function tabOf(wrap) {
    if (!wrap || !wrap.id) return null;
    if (wrap.id === 'intake-table-wrap') return 'intake';
    const m = /^leadtable-wrap-(.+)$/.exec(wrap.id);
    return m ? m[1] : null;
  }

  function storageKey(tab) {
    const userKey = (window.currentUser && window.currentUser.key) || 'jay';
    return 'bs_' + userKey + '_colwidths_' + tab;
  }

  function loadWidths(tab) {
    try {
      const raw = localStorage.getItem(storageKey(tab));
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function saveWidths(tab, obj) {
    try { localStorage.setItem(storageKey(tab), JSON.stringify(obj)); }
    catch (e) { /* ignore quota */ }
  }

  function thLabel(th) {
    return th.getAttribute('data-col-label') ||
           th.textContent.replace(/[▲▼]\s*$/, '').trim();
  }

  // ---------- per-table wiring ----------

  function enableOnTable(wrap) {
    const tab = tabOf(wrap);
    if (!tab) return;

    const table = wrap.querySelector('table');
    if (!table) return;
    if (table.dataset.colresizeWired === '1') return;
    table.dataset.colresizeWired = '1';

    table.style.tableLayout = 'fixed';

    const headers = Array.from(table.querySelectorAll('thead th'));
    const stored  = loadWidths(tab);

    // Make a colgroup so widths propagate to td cells in fixed layout
    let colgroup = table.querySelector('colgroup');
    if (!colgroup) {
      colgroup = document.createElement('colgroup');
      headers.forEach(() => colgroup.appendChild(document.createElement('col')));
      table.insertBefore(colgroup, table.firstChild);
    }
    const cols = Array.from(colgroup.children);

    headers.forEach((th, idx) => {
      const label = thLabel(th);
      const key = slug(label);
      if (!key) return;

      th.setAttribute('data-col-key', key);
      th.setAttribute('data-col-label', label);

      // Apply stored width
      if (stored[key]) {
        const w = Math.max(MIN_W, Math.min(MAX_W, stored[key]));
        th.style.width    = w + 'px';
        th.style.minWidth = w + 'px';
        th.style.maxWidth = w + 'px';
        if (cols[idx]) cols[idx].style.width = w + 'px';
      }

      // Ensure relative positioning so the handle anchors correctly
      const cs = window.getComputedStyle(th);
      if (cs.position === 'static') th.style.position = 'relative';

      if (!th.querySelector('.cr-handle')) {
        const handle = document.createElement('div');
        handle.className = 'cr-handle';
        handle.title = 'Drag to resize · Double-click to reset';
        handle.addEventListener('mousedown', startDrag);
        handle.addEventListener('dblclick',  resetCol);
        // Block clicks on the handle from bubbling so we don't trigger
        // sort (dblclick) when the user is fiddling with the resizer.
        handle.addEventListener('click', e => e.stopPropagation());
        th.appendChild(handle);
      }
    });

    // ---- drag state (per table) ----
    let dragTh = null, dragCol = null, dragIdx = -1;
    let dragStartX = 0, dragStartW = 0, dragNewW = 0, dragKey = '';
    let guideEl = null;

    function startDrag(e) {
      e.stopPropagation();
      e.preventDefault();
      const handle = e.currentTarget;
      dragTh = handle.parentElement;
      dragIdx = headers.indexOf(dragTh);
      dragCol = (dragIdx >= 0) ? cols[dragIdx] : null;
      dragKey = dragTh.getAttribute('data-col-key') || '';
      dragStartX = e.pageX;
      dragStartW = dragTh.offsetWidth;
      dragNewW   = dragStartW;

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      handle.classList.add('cr-handle-active');

      // Build the vertical guide line, anchored to the table-wrap
      // container so it scrolls with the table (and stays inside it).
      guideEl = document.createElement('div');
      guideEl.className = 'cr-guide';
      wrap.appendChild(guideEl);
      positionGuide(e.pageX);

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function positionGuide(pageX) {
      // Translate pageX to a position inside the wrap, accounting for
      // wrap scrolling. Compute the candidate new column width and
      // park the guide line at that x coordinate inside the wrap.
      const wrapRect = wrap.getBoundingClientRect();
      const clientX = pageX - window.scrollX;
      let xInWrap = clientX - wrapRect.left + wrap.scrollLeft;
      // Constrain so the column never narrower than MIN_W / wider than MAX_W
      const thRect = dragTh.getBoundingClientRect();
      const thLeftInWrap = thRect.left - wrapRect.left + wrap.scrollLeft;
      const minX = thLeftInWrap + MIN_W;
      const maxX = thLeftInWrap + MAX_W;
      if (xInWrap < minX) xInWrap = minX;
      if (xInWrap > maxX) xInWrap = maxX;
      dragNewW = Math.round(xInWrap - thLeftInWrap);
      if (guideEl) guideEl.style.left = (xInWrap - 1) + 'px';
    }

    function onMove(e) {
      if (!dragTh || !guideEl) return;
      e.preventDefault();
      positionGuide(e.pageX);
    }

    function onUp() {
      if (!dragTh) return;
      // Apply the final width to the column
      dragTh.style.width    = dragNewW + 'px';
      dragTh.style.minWidth = dragNewW + 'px';
      dragTh.style.maxWidth = dragNewW + 'px';
      if (dragCol) dragCol.style.width = dragNewW + 'px';

      // Persist
      if (dragKey) {
        const map = loadWidths(tab);
        map[dragKey] = dragNewW;
        saveWidths(tab, map);
      }

      // Cleanup
      if (guideEl && guideEl.parentNode) guideEl.parentNode.removeChild(guideEl);
      guideEl = null;
      document.querySelectorAll('.cr-handle-active')
              .forEach(h => h.classList.remove('cr-handle-active'));
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragTh = null; dragCol = null; dragKey = ''; dragIdx = -1;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    function resetCol(e) {
      e.stopPropagation();
      e.preventDefault();
      const th = e.currentTarget.parentElement;
      const key = th.getAttribute('data-col-key');
      if (!key) return;
      const map = loadWidths(tab);
      if (key in map) {
        delete map[key];
        saveWidths(tab, map);
      }
      const idx = headers.indexOf(th);
      th.style.width = '';
      th.style.minWidth = '';
      th.style.maxWidth = '';
      if (idx >= 0 && cols[idx]) cols[idx].style.width = '';
    }
  }

  // Reset all column widths for a tab back to defaults
  window.resetColumnWidths = function (tab) {
    if (!tab) return;
    try { localStorage.removeItem(storageKey(tab)); } catch (e) {}
    const wrap = tab === 'intake'
      ? document.getElementById('intake-table-wrap')
      : document.getElementById('leadtable-wrap-' + tab);
    if (!wrap) return;
    const table = wrap.querySelector('table');
    if (!table) return;
    table.querySelectorAll('thead th').forEach(th => {
      th.style.width = '';
      th.style.minWidth = '';
      th.style.maxWidth = '';
    });
    const colgroup = table.querySelector('colgroup');
    if (colgroup) Array.from(colgroup.children).forEach(c => { c.style.width = ''; });
    if (window.showSuccess) window.showSuccess('Column widths reset', 'Restored to defaults.');
  };

  // ---------- auto-wire ----------

  function scanAndWire(root) {
    const wraps = (root || document).querySelectorAll(
      '#intake-table-wrap, [id^="leadtable-wrap-"]'
    );
    wraps.forEach(enableOnTable);
  }

  function start() {
    scanAndWire(document);
    const obs = new MutationObserver(muts => {
      let needsScan = false;
      for (const m of muts) {
        if (m.type === 'childList' && m.addedNodes.length) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.tagName === 'TABLE' ||
                n.id === 'intake-table-wrap' ||
                (n.id && n.id.indexOf('leadtable-wrap-') === 0) ||
                (n.querySelector && n.querySelector('#intake-table-wrap, [id^="leadtable-wrap-"], table'))) {
              needsScan = true; break;
            }
          }
        }
        if (needsScan) break;
      }
      if (needsScan) scanAndWire(document);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // ---------- inject CSS ----------

  const css = `
    /* Always-visible thin handle on the right edge of every header.
       Faint gray by default, bright blue on hover/drag. The click
       area is wider than the visible line for easier grabbing. */
    th .cr-handle {
      position: absolute;
      top: 0;
      right: -3px;
      width: 7px;
      height: 100%;
      cursor: col-resize;
      user-select: none;
      z-index: 50;
      touch-action: none;
      background: transparent;
    }
    /* The thin visible line, centered inside the click target */
    th .cr-handle::before {
      content: '';
      position: absolute;
      top: 4px;
      bottom: 4px;
      left: 3px;
      width: 1px;
      background: var(--border-strong, #cdd5e1);
      transition: background 120ms ease, width 120ms ease, left 120ms ease, top 120ms ease, bottom 120ms ease;
    }
    th .cr-handle:hover::before,
    th .cr-handle-active::before {
      background: var(--primary, #1e3a5f);
      width: 2px;
      left: 2.5px;
      top: 0;
      bottom: 0;
    }
    /* Containers need positioned context for the guide line */
    .table-wrap { position: relative; }

    /* Guide line shown during drag — full visible height, snaps on release */
    .cr-guide {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--primary, #1e3a5f);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.4);
      pointer-events: none;
      z-index: 10000;
      opacity: 0.85;
    }

    /* Soften intake column-lock max-widths so resize can work there */
    #intake-table-wrap table thead th[data-col-key],
    #intake-table-wrap table tbody td {
      max-width: none !important;
    }
  `;
  const styleEl = document.createElement('style');
  styleEl.id = 'colresize-styles';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
})();
