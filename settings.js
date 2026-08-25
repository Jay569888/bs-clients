// ===== SETTINGS & CONFIGURATION =====
window.renderSettings = function() {
  const u = document.getElementById('scriptUrlEdit');
  if (u) u.value = window.SCRIPT_URL;
  const cu = document.getElementById('currentUrl');
  const userName = window.currentUser?.name || '';
  if (cu) cu.textContent = window.SCRIPT_URL ? `${userName}'s URL: ` + window.SCRIPT_URL.slice(0,50) + '...' : `No URL saved for ${userName} yet.`;
  window.renderAttorneyList();
  window.updateGmailStatusBar();
  window.renderEvidenceSettings();
  window.renderStatusSettings();
  if (typeof window.loadFontSize === 'function') window.loadFontSize();
  if (typeof window.renderThemeSettings === 'function') window.renderThemeSettings();
  if (typeof window.renderVerseSettings === 'function') window.renderVerseSettings();
  if (window.openrouterKey) { const ip=document.getElementById('openrouterKeyInput'); if(ip){ ip.value = window.openrouterKey; document.getElementById('openrouterKeyStatus').textContent = 'Key saved ✓'; } }
  // Pre-fill Quo URL (shared across users — stored in plain localStorage)
  const quoIp = document.getElementById('quoUrlInput');
  if (quoIp) {
    const stored = (localStorage.getItem('bs_quo_url') || '').trim();
    quoIp.value = stored;
    quoIp.placeholder = 'https://my.quo.com/';
    const st = document.getElementById('quoUrlStatus');
    if (st) st.textContent = stored ? 'Saved ✓' : '';
  }
  if (window.notifSoundUrl) { document.getElementById('notifSoundUrl').value = window.notifSoundUrl; }
};

window._saveQuoUrlFromInput = function() {
  const v = (document.getElementById('quoUrlInput')?.value || '').trim();
  if (window._setQuoUrl(v)) {
    const st = document.getElementById('quoUrlStatus');
    if (st) {
      st.textContent = 'Saved ✓';
      st.style.color = 'var(--success-text)';
    }
  }
};

window.renderAttorneyList = function() {
  document.getElementById('attorneyList').innerHTML = window.state.attorneys.map((a,i) => `<div class="attorney-item"><span>${a}</span><button class="btn btn-sm btn-danger" onclick="window.removeAttorney(${i})">Remove</button></div>`).join('');
};
window.addAttorney = async function() {
  const n = document.getElementById('newAttorneyName').value.trim();
  if (!n || window.state.attorneys.includes(n)) return;
  window.state.attorneys.push(n); document.getElementById('newAttorneyName').value = '';
  window.renderAttorneyList(); window.populateAttorneyDropdowns();
  try { await window.api({action:'saveMeta', attorneys: JSON.stringify(window.state.attorneys)}); } catch(e) {}
};
window.removeAttorney = async function(i) {
  window.state.attorneys.splice(i, 1); window.renderAttorneyList(); window.populateAttorneyDropdowns();
  try { await window.api({action:'saveMeta', attorneys: JSON.stringify(window.state.attorneys)}); } catch(e) {}
};

window.renderEvidenceSettings = function() {
  const opts = window.getEvidenceOpts();
  const codes = JSON.parse(localStorage.getItem(window.userPrefix()+'evidence_codes')||'{}');
  document.getElementById('evidenceSettingsList').innerHTML = opts.map((opt, i) => {
    const req = window.REQUIRED_EVIDENCE.find(r => r.opt === opt);
    const label = req ? req.label : opt;
    const defaultCode = req ? req.code : (codes[opt] || opt.slice(0,3).toUpperCase());
    return `<div class="attorney-item" style="gap:6px"><span style="flex:1">${label}</span><input value="${codes[opt]||defaultCode}" style="width:60px;font-size:11px;padding:2px 5px" maxlength="6" placeholder="Code" onchange="window.updateEvidenceCode('${opt}',this.value)"><button class="btn btn-sm btn-danger" onclick="window.removeEvidenceItem(${i})">✕</button></div>`;
  }).join('');
};
window.updateEvidenceCode = function(opt, code) {
  const codes = JSON.parse(localStorage.getItem(window.userPrefix()+'evidence_codes')||'{}');
  codes[opt] = code.trim().toUpperCase() || (window.REQUIRED_EVIDENCE.find(r=>r.opt===opt)?.code || opt.slice(0,3).toUpperCase());
  window.saveEvidenceCodes(codes);
};
window.addEvidenceItem = function() {
  const name = document.getElementById('newEvidenceName').value.trim();
  const code = document.getElementById('newEvidenceCode').value.trim().toUpperCase();
  if (!name) return;
  const opts = window.getEvidenceOpts();
  if (opts.includes(name)) { window.showSuccess('Exists', 'Already exists.'); return; }
  opts.push(name); window.saveEvidenceOpts(opts);
  if (code) { const c = JSON.parse(localStorage.getItem(window.userPrefix()+'evidence_codes')||'{}'); c[name] = code; window.saveEvidenceCodes(c); }
  document.getElementById('newEvidenceName').value = ''; document.getElementById('newEvidenceCode').value = '';
  window.renderEvidenceSettings();
};
window.removeEvidenceItem = function(i) { const opts = window.getEvidenceOpts(); opts.splice(i, 1); window.saveEvidenceOpts(opts); window.renderEvidenceSettings(); };

window.renderStatusSettings = function() {
  const opts = window.getStatusOpts();
  const el = document.getElementById('statusSettingsList');
  if (!el) return;
  el.innerHTML = opts.map((s,i) => `<div class="attorney-item"><span>${s}</span><button class="btn btn-sm btn-danger" onclick="window.removeStatusOpt(${i})">✕</button></div>`).join('');
};
window.addStatusOpt = function() {
  const n = document.getElementById('newStatusOpt').value.trim(); if (!n) return;
  const opts = window.getStatusOpts(); if (!opts.includes(n)) opts.push(n);
  window.saveStatusOpts(opts); document.getElementById('newStatusOpt').value = ''; window.renderStatusSettings();
};
window.removeStatusOpt = function(i) { const opts = window.getStatusOpts(); opts.splice(i, 1); window.saveStatusOpts(opts); window.renderStatusSettings(); };

window.saveGeminiKey = function() {
  window.geminiKey = document.getElementById('geminiKeyInput')?.value.trim() || '';
  localStorage.setItem(window.userPrefix()+'gemini_key', window.geminiKey);
  const el = document.getElementById('geminiKeyStatus'); if(el) el.textContent = 'Saved ✓';
};

window.saveOpenRouterKey = function() {
  const v = (document.getElementById('openrouterKeyInput')?.value || '').trim();
  window.openrouterKey = v;
  // localStorage: instant offline access
  localStorage.setItem(window.userPrefix()+'openrouter_key', v);
  // Backend: sync across devices (queued, non-blocking)
  if (window._queueSave) {
    window._queueSave({ action:'saveMeta', openrouterKey: v });
  } else if (window.api) {
    window.api({ action:'saveMeta', openrouterKey: v }).catch(()=>{});
  }
  const st = document.getElementById('openrouterKeyStatus');
  if(st){
    if(v){ st.textContent='Saved ✓ (synced)'; st.style.color='var(--success-text)'; }
    else { st.textContent='Cleared'; st.style.color='var(--text-muted)'; }
  }
};

window.saveNotifSound = function() {
  const url = document.getElementById('notifSoundUrl').value.trim();
  if (url) { window.notifSoundUrl = url; localStorage.setItem(window.userPrefix()+'notif_sound', url); window.showSuccess('Sound Saved', 'Notification sound URL saved successfully!'); }
};
window.testNotifSound = function() { window.playNotifSound(); };
window.uploadNotifSound = function(input) {
  const file = input.files[0]; if (file) { const url = URL.createObjectURL(file); window.notifSoundUrl = url; localStorage.setItem(window.userPrefix()+'notif_sound', url); document.getElementById('notifSoundUrl').value = url; window.showSuccess('Sound Uploaded', 'Custom notification sound uploaded!'); window.playNotifSound(); }
};

window.connectGmailViaAppsScript = async function() {
  const el = document.getElementById('appsScriptGmailStatus'); el.textContent = 'Connecting...';
  try {
    const r = await window.api({action:'getGmailToken'});
    if (r.token) {
      window.gmailToken = r.token; localStorage.setItem(window.userPrefix()+'gmail_token', r.token);
      if (r.email) localStorage.setItem(window.userPrefix()+'gmail_email', r.email);
      window.updateGmailStatusBar(); el.textContent = '✅ Connected as ' + (r.email||'unknown');
      clearInterval(window._gmailRefreshTimer);
      window._gmailRefreshTimer = setInterval(async () => { try { const rr = await window.api({action:'getGmailToken'}); if (rr.token) { window.gmailToken = rr.token; localStorage.setItem(window.userPrefix()+'gmail_token', rr.token); window.updateGmailStatusBar(); } } catch(e) {} }, 45 * 60 * 1000);
    } else { el.textContent = '❌ Failed: ' + (r.error || 'Check Script Properties in Apps Script.'); }
  } catch(e) { el.textContent = '❌ Error: ' + e.message; }
};

window.saveGmailToken = async function() {
  const token = document.getElementById('gmailTokenInput').value.trim();
  if (!token) { window.showSuccess('Missing', 'Paste token first.'); return; }
  document.getElementById('gmailTokenSaveBtn').textContent = 'Verifying...';
  try {
    const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', { headers:{Authorization:'Bearer '+token} });
    const data = await res.json();
    if (!data.emailAddress) { window.showSuccess('Invalid', 'Invalid token.'); return; }
    window.gmailToken = token; localStorage.setItem(window.userPrefix()+'gmail_token', token); localStorage.setItem(window.userPrefix()+'gmail_email', data.emailAddress);
    window.updateGmailStatusBar(); window.playNotifSound(); window.showSuccess('Gmail Connected!', 'Sending as ' + data.emailAddress);
  } catch(e) { window.showSuccess('Error', e.message); }
  document.getElementById('gmailTokenSaveBtn').textContent = 'Save';
};
// ===== VERSE TICKER SETTINGS (from settings.js) =====
const DEFAULT_VERSES = [
  '"For I know the plans I have for you," declares the LORD. — Jeremiah 29:11',
  '"I can do all things through Christ who strengthens me." — Philippians 4:13',
  '"The LORD is my shepherd; I shall not want." — Psalm 23:1',
  '"Trust in the LORD with all your heart." — Proverbs 3:5',
  '"And we know that in all things God works for the good of those who love him." — Romans 8:28',
  '"Be strong and courageous. Do not be afraid." — Joshua 1:9',
  '"But those who hope in the LORD will renew their strength." — Isaiah 40:31',
];
window._getVerses = function() { const s=localStorage.getItem(window.userPrefix()+'ticker_verses'); try{return s?JSON.parse(s):DEFAULT_VERSES;}catch(e){return DEFAULT_VERSES;} };
window._getTickerSpeed = function() { return parseInt(localStorage.getItem(window.userPrefix()+'ticker_speed')||'30'); };
window.initVerseTicker = function() { const el=document.getElementById('verseTicker'); if(!el) return; const verses=window._getVerses(); if(!verses.length){el.parentElement.style.display='none';return;} el.parentElement.style.display='flex'; const idx=Math.floor(Date.now()/60000)%verses.length; el.textContent='✦  '+verses[idx]+'  ✦  '+verses[(idx+1)%verses.length]; el.style.animationDuration=window._getTickerSpeed()+'s'; el.onanimationiteration=()=>{const currentVerses=window._getVerses();if(!currentVerses.length)return;const n=Math.floor(Date.now()/60000)%currentVerses.length;el.textContent='✦  '+currentVerses[n]+'  ✦  '+currentVerses[(n+1)%currentVerses.length];}; };
window.renderVerseSettings = function() { const c=document.getElementById('verseSettingsList'); if(!c) return; const v=window._getVerses(); const sp=window._getTickerSpeed(); const si=document.getElementById('tickerSpeedInput'); if(si) si.value=sp; c.innerHTML=v.map((verse,i)=>`<div class="attorney-item" style="gap:6px;align-items:flex-start"><span style="flex:1;font-size:11px;font-style:italic">${verse}</span><button class="btn btn-sm btn-danger" onclick="window.removeVerse(${i})">✕</button></div>`).join('')||'<div style="color:var(--text-muted);font-size:11px;padding:8px">No verses yet.</div>'; };
window.addVerse = function() { const inp=document.getElementById('newVerseInput'); const t=inp.value.trim(); if(!t) return; const v=window._getVerses(); v.push(t); const json=JSON.stringify(v); localStorage.setItem(window.userPrefix()+'ticker_verses',json); window.api({action:'saveMeta',tickerVerses:json}).catch(()=>{}); inp.value=''; window.renderVerseSettings(); window.initVerseTicker(); window.showSuccess('Verse Added!','Ticker updated.'); };
window.removeVerse = function(i) { const v=window._getVerses(); v.splice(i,1); const json=JSON.stringify(v); localStorage.setItem(window.userPrefix()+'ticker_verses',json); window.api({action:'saveMeta',tickerVerses:json}).catch(()=>{}); window.renderVerseSettings(); window.initVerseTicker(); };
window.saveTickerSpeed = function() { const s=parseInt(document.getElementById('tickerSpeedInput').value)||30; const sp=Math.min(80,Math.max(10,s)); localStorage.setItem(window.userPrefix()+'ticker_speed',sp); window.api({action:'saveMeta',tickerSpeed:String(sp)}).catch(()=>{}); window.initVerseTicker(); window.showSuccess('Speed Saved!',`Ticker speed set.`); };
window.resetVerses = function() { localStorage.removeItem(window.userPrefix()+'ticker_verses'); window.api({action:'saveMeta',tickerVerses:''}).catch(()=>{}); window.renderVerseSettings(); window.initVerseTicker(); window.showSuccess('Reset!','Default verses restored.'); };
