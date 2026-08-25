// ===== STICKY NOTES — with backend persistence =====
// Notes saved to Google Sheets via saveMeta.
// localStorage used as fast local cache only.
// Notes NEVER auto-deleted — only on explicit confirm.

window._stickyKey = function() { return window.userPrefix() + 'sticky_notes'; };

window._getStickyNotes = function() {
  if (window.state.stickyNotes && window.state.stickyNotes.length) return window.state.stickyNotes;
  try { const s = localStorage.getItem(window._stickyKey()); return s ? JSON.parse(s) : []; } catch(e) { return []; }
};

window._saveStickyNotes = async function(notes, skipBackend) {
  window.state.stickyNotes = notes;
  try { localStorage.setItem(window._stickyKey(), JSON.stringify(notes)); } catch(e) {}
  if (!skipBackend) {
    try { await window.api({ action: 'saveMeta', stickyNotes: JSON.stringify(notes) }); }
    catch(e) { console.warn('Sticky notes backend save failed:', e.message); }
  }
};

window._mergeStickyNotesFromBackend = function(backendNotes) {
  if (!Array.isArray(backendNotes) || !backendNotes.length) return;
  window.state.stickyNotes = backendNotes;
  try { localStorage.setItem(window._stickyKey(), JSON.stringify(backendNotes)); } catch(e) {}
  document.querySelectorAll('.sticky-note').forEach(el => el.remove());
  backendNotes.forEach(n => window._renderStickyNote(n));
};

window.initStickyNotes = function() {
  const notes = window._getStickyNotes();
  notes.forEach(n => window._renderStickyNote(n));
  document.addEventListener('keydown', e => {
    if (e.shiftKey && e.key === 'N' && !e.target.matches('input,textarea,[contenteditable]')) window.addStickyNote();
  });
};

window._renderStickyNote = function(note) {
  if (document.getElementById('sticky-' + note.id)) return;
  const COLORS = {
    yellow: { bg:'#fef9c3', border:'#fde68a', header:'#fde68a', text:'#92400e' },
    blue:   { bg:'#dbeafe', border:'#93c5fd', header:'#93c5fd', text:'#1e40af' },
    green:  { bg:'#dcfce7', border:'#86efac', header:'#86efac', text:'#166534' },
    pink:   { bg:'#fce7f3', border:'#f9a8d4', header:'#f9a8d4', text:'#9d174d' },
    white:  { bg:'#ffffff', border:'#e5e7eb', header:'#f3f4f6', text:'#374151' },
  };
  const c = COLORS[note.colorTheme || 'yellow'];
  const el = document.createElement('div');
  el.id = 'sticky-' + note.id;
  el.className = 'sticky-note';
  el.style.cssText = `position:fixed;left:${Math.max(0,note.x||200)}px;top:${Math.max(0,note.y||200)}px;width:${note.w||240}px;min-height:160px;background:${c.bg};border:1px solid ${c.border};border-radius:6px;box-shadow:3px 5px 16px rgba(0,0,0,0.18);z-index:900;display:flex;flex-direction:column;font-family:inherit;user-select:none;resize:both;overflow:auto;`;
  el.innerHTML = `
    <div class="sticky-header" style="background:${c.header};padding:5px 8px;display:flex;align-items:center;justify-content:space-between;cursor:move;border-radius:5px 5px 0 0;font-size:11px;font-weight:600;color:${c.text};flex-shrink:0">
      <span>📌 Task Reminder</span>
      <div style="display:flex;gap:4px;align-items:center">
        <select onchange="window._changeStickyColor('${note.id}',this.value)" style="font-size:10px;padding:1px 2px;border:none;background:transparent;cursor:pointer;color:${c.text}" title="Change color">
          <option value="yellow" ${(note.colorTheme||'yellow')==='yellow'?'selected':''}>🟡</option>
          <option value="blue"   ${note.colorTheme==='blue'  ?'selected':''}>🔵</option>
          <option value="green"  ${note.colorTheme==='green' ?'selected':''}>🟢</option>
          <option value="pink"   ${note.colorTheme==='pink'  ?'selected':''}>🩷</option>
          <option value="white"  ${note.colorTheme==='white' ?'selected':''}>⬜</option>
        </select>
        <button onclick="window._toggleStickyNote('${note.id}')" style="background:none;border:none;cursor:pointer;color:${c.text};font-size:14px;padding:0 3px;line-height:1" title="Hide note">_</button>
        <button onclick="window._confirmDeleteStickyNote('${note.id}')" style="background:none;border:none;cursor:pointer;color:${c.text};font-size:14px;padding:0 3px;line-height:1" title="Delete note">🗑</button>
      </div>
    </div>
    <textarea id="sticky-text-${note.id}" placeholder="Write your task reminder here..." style="flex:1;padding:8px;border:none;background:transparent;resize:none;font-size:12px;font-family:inherit;color:#1a1a1a;outline:none;min-height:110px;line-height:1.6;" oninput="window._saveStickyText('${note.id}',this.value)"></textarea>
    <div style="padding:3px 8px 5px;font-size:9px;color:${c.text};opacity:0.55;display:flex;justify-content:space-between;flex-shrink:0">
      <span>${note.createdAt ? 'Created '+note.createdAt : ''}</span>
      <span>Shift+N = new note</span>
    </div>`;
  const ta = el.querySelector('textarea');
  if (ta) ta.value = note.text || '';
  document.body.appendChild(el);
  // Restore hidden state if note was collapsed
  if (note.hidden) {
    el.querySelector('textarea').style.display = 'none';
    el.style.minHeight = '0'; el.style.height = 'auto';
  }

  // Drag
  const header = el.querySelector('.sticky-header');
  let dragging=false, ox=0, oy=0;
  header.addEventListener('mousedown', e => {
    if (e.target.tagName==='SELECT'||e.target.tagName==='BUTTON') return;
    dragging=true; ox=e.clientX-el.offsetLeft; oy=e.clientY-el.offsetTop; el.style.zIndex=950; e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    el.style.left=Math.max(0,Math.min(window.innerWidth-el.offsetWidth,e.clientX-ox))+'px';
    el.style.top=Math.max(0,Math.min(window.innerHeight-el.offsetHeight,e.clientY-oy))+'px';
  });
  document.addEventListener('mouseup', async () => {
    if (!dragging) return;
    dragging=false; el.style.zIndex=900;
    const notes=window._getStickyNotes(); const n=notes.find(n=>n.id===note.id);
    if (n) { n.x=parseInt(el.style.left); n.y=parseInt(el.style.top); await window._saveStickyNotes(notes); }
  });
};

window.addStickyNote = async function() {
  const notes = window._getStickyNotes();
  const now = new Date();
  const newNote = {
    id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
    text: '',
    x: 80 + (notes.length % 8) * 28,
    y: 80 + (notes.length % 8) * 28,
    w: 240,
    colorTheme: 'yellow',
    createdAt: `${now.getMonth()+1}/${now.getDate()}/${String(now.getFullYear()).slice(-2)}`,
  };
  notes.push(newNote);
  await window._saveStickyNotes(notes);
  window._renderStickyNote(newNote);
  setTimeout(() => document.getElementById('sticky-text-'+newNote.id)?.focus(), 120);
};

// Show confirmation overlay — never auto-delete
window._confirmDeleteStickyNote = function(id) {
  const el = document.getElementById('sticky-' + id);
  if (!el || el.querySelector('.sticky-confirm')) return;
  const notes = window._getStickyNotes();
  const note = notes.find(n => n.id === id);
  const preview = (note?.text || '(empty note)').slice(0, 55);
  const confirm = document.createElement('div');
  confirm.className = 'sticky-confirm';
  confirm.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.65);border-radius:5px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;z-index:10;padding:14px;';
  confirm.innerHTML = `
    <div style="color:#fff;font-size:13px;font-weight:700;text-align:center">Delete this note?</div>
    <div style="color:rgba(255,255,255,0.8);font-size:10px;text-align:center;max-width:190px;line-height:1.5;font-style:italic">"${preview}${(note?.text||'').length>55?'…':''}"</div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button onclick="window.deleteStickyNote('${id}')" style="background:#ef4444;color:#fff;border:none;border-radius:5px;padding:6px 16px;font-size:11px;font-weight:700;cursor:pointer">Yes, Delete</button>
      <button onclick="this.closest('.sticky-confirm').remove()" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.4);border-radius:5px;padding:6px 16px;font-size:11px;cursor:pointer">Cancel</button>
    </div>`;
  el.style.position = 'relative';
  el.appendChild(confirm);
};

window.deleteStickyNote = async function(id) {
  document.getElementById('sticky-' + id)?.remove();
  const notes = window._getStickyNotes().filter(n => n.id !== id);
  await window._saveStickyNotes(notes);
};

window._saveStickyText = async function(id, text) {
  const notes = window._getStickyNotes();
  const n = notes.find(n => n.id === id);
  if (n) { n.text = text; await window._saveStickyNotes(notes); }
};

window._changeStickyColor = async function(id, colorTheme) {
  const COLORS = {
    yellow:{bg:'#fef9c3',border:'#fde68a',header:'#fde68a'},
    blue:  {bg:'#dbeafe',border:'#93c5fd',header:'#93c5fd'},
    green: {bg:'#dcfce7',border:'#86efac',header:'#86efac'},
    pink:  {bg:'#fce7f3',border:'#f9a8d4',header:'#f9a8d4'},
    white: {bg:'#ffffff',border:'#e5e7eb',header:'#f3f4f6'},
  };
  const c = COLORS[colorTheme] || COLORS.yellow;
  const notes = window._getStickyNotes();
  const n = notes.find(n => n.id === id);
  if (n) { n.colorTheme = colorTheme; await window._saveStickyNotes(notes); }
  const el = document.getElementById('sticky-' + id);
  if (el) {
    el.style.background = c.bg; el.style.borderColor = c.border;
    const hdr = el.querySelector('.sticky-header'); if (hdr) hdr.style.background = c.header;
  }
};

// ── Hide/Show individual note ─────────────────────────────────────────
window._toggleStickyNote = async function(id) {
  const notes = window._getStickyNotes();
  const n = notes.find(n => n.id === id);
  if (!n) return;
  n.hidden = !n.hidden;
  await window._saveStickyNotes(notes);
  const el = document.getElementById('sticky-' + id);
  if (el) {
    if (n.hidden) {
      // Collapse to just the header bar
      el.querySelector('textarea').style.display = 'none';
      el.querySelector('.sticky-footer') && (el.querySelector('.sticky-footer').style.display = 'none');
      el.style.minHeight = '0';
      el.style.height = 'auto';
      el.querySelector('.sticky-header').title = 'Click _ to expand';
    } else {
      el.querySelector('textarea').style.display = '';
      el.querySelector('.sticky-footer') && (el.querySelector('.sticky-footer').style.display = '');
      el.style.minHeight = '160px';
      el.style.height = '';
      el.querySelector('.sticky-header').title = '';
    }
  }
};

// ── Hide ALL / Show ALL toggle (called from topbar 📌 button) ─────────
window._allNotesHidden = false;
window.toggleAllStickyNotes = function() {
  window._allNotesHidden = !window._allNotesHidden;
  document.querySelectorAll('.sticky-note').forEach(el => {
    el.style.display = window._allNotesHidden ? 'none' : 'flex';
  });
  // Update topbar button tooltip
  const btn = document.querySelector('[onclick="window.addStickyNote()"]') ||
              document.querySelector('[onclick*="sticky"]');
  // Show a quick toast
  window.showSuccess(
    window._allNotesHidden ? '📌 Notes Hidden' : '📌 Notes Visible',
    window._allNotesHidden ? 'Click 📌 to show notes again.' : 'Sticky notes are now visible.'
  );
};
