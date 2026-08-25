// ===== GLOBAL CONFIG =====

// Default tabs — can be extended by user
window.DEFAULT_TABS = ['pc','star','o','dbb','clients','retainer','drop'];
window.DEFAULT_TAB_LABELS = {
  intake:'Intake', pc:'PC', star:'Star', o:'O', dbb:'DBB',
  clients:'Clients', retainer:'Retainer', drop:'Drop'
};

// Load custom tabs from localStorage (merges with defaults)
window._loadCustomTabs = function() {
  try {
    const saved = localStorage.getItem('bs_custom_tabs');
    if (saved) {
      const parsed = JSON.parse(saved);
      window.TABS      = parsed.tabs      || [...window.DEFAULT_TABS];
      window.TAB_LABELS = { ...window.DEFAULT_TAB_LABELS, ...(parsed.labels || {}) };
    } else {
      window.TABS       = [...window.DEFAULT_TABS];
      window.TAB_LABELS = { ...window.DEFAULT_TAB_LABELS };
    }
  } catch(e) {
    window.TABS       = [...window.DEFAULT_TABS];
    window.TAB_LABELS = { ...window.DEFAULT_TAB_LABELS };
  }
  window.ALL_TABS = ['intake', ...window.TABS];
};

window._saveCustomTabs = function() {
  // Save to localStorage
  localStorage.setItem('bs_custom_tabs', JSON.stringify({
    tabs:   window.TABS,
    labels: window.TAB_LABELS
  }));
  // Also sync to Google Sheet _meta so Apps Script knows about custom tabs
  try {
    window.api({
      action: 'saveMeta',
      customTabs: JSON.stringify({ tabs: window.TABS, labels: window.TAB_LABELS })
    });
  } catch(e) { console.warn('Could not sync custom tabs to sheet:', e); }
};

// Initialize on load
window._loadCustomTabs();

window.REQUIRED_EVIDENCE = [
  { opt: 'Photos',                label: 'Photos/Videos',                  code: 'PICS' },
  { opt: 'Proof of Notice',       label: 'Proof of Notice (Text/Email)',    code: 'PON'  },
  { opt: 'Mold Report',           label: 'Mold Report',                    code: 'MOLD' },
  { opt: "Doctor's Note",         label: "Doctor's Note from MD",          code: 'DN'   },
  { opt: 'Code Enforcement Report', label: 'Code Enforcement Report',      code: 'CE'   }
];

// ===== TAB MANAGEMENT =====
window.openManageTabsModal = function() {
  document.querySelectorAll('.manage-tabs-overlay').forEach(x => x.remove());
  const ov = document.createElement('div');
  ov.className = 'manage-tabs-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';

  const renderRows = () => window.TABS.map((tab, i) => `
    <div style="display:flex;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)" data-tab-row="${tab}">
      <input value="${window.TAB_LABELS[tab] || tab}" data-tab-rename="${tab}"
        style="flex:1;font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--card)"
        onchange="window._renameTab('${tab}', this.value)">
      <span style="font-size:10px;color:var(--text-muted);min-width:40px">(${tab})</span>
      ${!['pc','star','o','dbb','clients','retainer','drop'].includes(tab) ? `
        <button onclick="window._deleteCustomTab('${tab}')" 
          style="background:var(--danger-bg);color:var(--danger-text);border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px">🗑 Delete</button>
      ` : `<span style="font-size:10px;color:var(--text-muted);padding:3px 8px">default</span>`}
    </div>`).join('');

  ov.innerHTML = `<div style="background:var(--card);border-radius:10px;padding:22px;max-width:440px;width:100%;box-shadow:0 12px 40px var(--shadow-lg);max-height:80vh;overflow-y:auto">
    <div style="font-size:14px;font-weight:700;color:var(--primary);margin-bottom:4px">⚙️ Manage Lead Tabs</div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px">Rename any tab or add new custom tabs. Default tabs cannot be deleted.</div>
    <div id="tab-rows-list">${renderRows()}</div>
    <div style="display:flex;gap:6px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <input id="new-tab-name" placeholder="New tab name (e.g. Hot Leads)" 
        style="flex:1;font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--card)">
      <button class="btn btn-primary btn-sm" onclick="window._addCustomTab()">+ Add Tab</button>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-outline btn-sm" onclick="document.querySelector('.manage-tabs-overlay').remove()">Close</button>
      <button class="btn btn-primary btn-sm" onclick="window._applyTabChanges()">✅ Apply & Reload</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
};

window._renameTab = function(tabKey, newLabel) {
  if (!newLabel.trim()) return;
  window.TAB_LABELS[tabKey] = newLabel.trim();
};

window._addCustomTab = function() {
  const nameInput = document.getElementById('new-tab-name');
  const name = (nameInput?.value || '').trim();
  if (!name) { alert('Enter a tab name.'); return; }
  // Generate a safe key from the name
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20) + '_' + Date.now().toString(36).slice(-4);
  if (window.TABS.includes(key)) { alert('Tab already exists.'); return; }
  window.TABS.push(key);
  window.TAB_LABELS[key] = name;
  if (!window.state.leads[key]) window.state.leads[key] = [];
  if (nameInput) nameInput.value = '';
  // Re-render rows
  const listEl = document.getElementById('tab-rows-list');
  if (listEl) listEl.innerHTML = window.TABS.map((tab, i) => `
    <div style="display:flex;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
      <input value="${window.TAB_LABELS[tab] || tab}" data-tab-rename="${tab}"
        style="flex:1;font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--card)"
        onchange="window._renameTab('${tab}', this.value)">
      <span style="font-size:10px;color:var(--text-muted);min-width:40px">(${tab})</span>
      ${!['pc','star','o','dbb','clients','retainer','drop'].includes(tab) ? `
        <button onclick="window._deleteCustomTab('${tab}')"
          style="background:var(--danger-bg);color:var(--danger-text);border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px">🗑 Delete</button>
      ` : `<span style="font-size:10px;color:var(--text-muted);padding:3px 8px">default</span>`}
    </div>`).join('');
};

window._deleteCustomTab = function(key) {
  if (['pc','star','o','dbb','clients','retainer','drop'].includes(key)) { alert('Cannot delete default tabs.'); return; }
  const count = (window.state.leads[key] || []).length;
  if (count > 0 && !confirm(`Tab "${window.TAB_LABELS[key]}" has ${count} leads. Delete anyway? Leads will be lost.`)) return;
  window.TABS = window.TABS.filter(t => t !== key);
  delete window.TAB_LABELS[key];
  delete window.state.leads[key];
  const listEl = document.getElementById('tab-rows-list');
  if (listEl) listEl.innerHTML = window.TABS.map(tab => `
    <div style="display:flex;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
      <input value="${window.TAB_LABELS[tab] || tab}" data-tab-rename="${tab}"
        style="flex:1;font-size:12px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--card)"
        onchange="window._renameTab('${tab}', this.value)">
      <span style="font-size:10px;color:var(--text-muted);min-width:40px">(${tab})</span>
      ${!['pc','star','o','dbb','clients','retainer','drop'].includes(tab) ? `
        <button onclick="window._deleteCustomTab('${tab}')"
          style="background:var(--danger-bg);color:var(--danger-text);border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px">🗑 Delete</button>
      ` : `<span style="font-size:10px;color:var(--text-muted);padding:3px 8px">default</span>`}
    </div>`).join('');
};

window._applyTabChanges = function() {
  // Collect any renamed labels from inputs
  document.querySelectorAll('[data-tab-rename]').forEach(input => {
    const key = input.dataset.tabRename;
    if (input.value.trim()) window.TAB_LABELS[key] = input.value.trim();
  });
  window._saveCustomTabs();
  document.querySelector('.manage-tabs-overlay')?.remove();
  window.showSuccess('Tabs Updated!', 'Reloading to apply changes...');
  setTimeout(() => location.reload(), 1000);
};
