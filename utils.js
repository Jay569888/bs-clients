// ===== UTILITIES & HELPERS =====
// CHANGES v2:
//   - normalizeDate / normalizeFFUP now FORCE-CLEAN any timezone garbage
//   - sanitizeLeadDates() — call before saving any lead to backend
//   - All dates output strictly as M/D/YY (date) or M/D (ffup)

// ── Force any value → M/D/YY ─────────────────────────────
window.normalizeDate = function(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  // Already correct
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(s)) return s;
  // ISO date only: 2026-05-14
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [yr, mo, dy] = s.split('-');
    return `${parseInt(mo)}/${parseInt(dy)}/${String(yr).slice(-2)}`;
  }
  // Try native Date parse (handles full JS Date toString, ISO datetime, etc.)
  const d = new Date(s);
  if (!isNaN(d)) {
    return `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
  }
  return s; // return as-is only if truly unparseable
};

// ── Force any value → M/D ────────────────────────────────
window.normalizeFFUP = function(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  // Already correct M/D
  if (/^\d{1,2}\/\d{1,2}$/.test(s)) return s;
  // M/D/YY or M/D/YYYY — strip year
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [mo, dy] = s.split('/');
    return `${parseInt(mo)}/${parseInt(dy)}`;
  }
  // ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [, mo, dy] = s.split('-');
    return `${parseInt(mo)}/${parseInt(dy)}`;
  }
  // Full JS Date string or any other parseable
  const d = new Date(s);
  if (!isNaN(d)) return `${d.getMonth()+1}/${d.getDate()}`;
  return s;
};

// ── Sanitize all date fields on a lead before saving ─────
// Call this before every api({ action:'updateLead' }) call
window.sanitizeLeadDates = function(lead) {
  if (!lead) return lead;
  if (lead.date)  lead.date  = window.normalizeDate(lead.date);
  if (lead.ffup)  lead.ffup  = window.normalizeFFUP(lead.ffup);
  if (lead._prevFFUP)       lead._prevFFUP       = window.normalizeFFUP(lead._prevFFUP);
  if (lead._prevIntakeFFUP) lead._prevIntakeFFUP = window.normalizeFFUP(lead._prevIntakeFFUP);
  if (lead.createdAt) {
    // Normalize createdAt to M/D/YY too if it's a garbage string
    if (!/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(String(lead.createdAt))) {
      const d = new Date(lead.createdAt);
      if (!isNaN(d)) lead.createdAt = `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
    }
  }
  return lead;
};

// ── todayMD / todayMDYY ───────────────────────────────────
window.todayMD = function() {
  const d = new Date();
  return `${d.getMonth()+1}/${d.getDate()}`;
};

window.todayMDYY = function() {
  const d = new Date();
  return `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
};

// ── Format helpers ────────────────────────────────────────
window.fmtDateTS = function(raw) {
  if (!raw) return '';
  if (/^\d{1,2}\/\d{1,2}\/\d{2}\s/.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d)) return raw;
  const mo=d.getMonth()+1, dy=d.getDate(), yr=String(d.getFullYear()).slice(-2);
  let h=d.getHours(), m=String(d.getMinutes()).padStart(2,'0');
  const ampm=h>=12?'PM':'AM'; h=h%12||12;
  return `${mo}/${dy}/${yr} ${h}:${m}${ampm}`;
};

window.fmtMDYY = function(raw) {
  if (!raw) return '';
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(String(raw))) return raw;
  const d = new Date(raw);
  if (isNaN(d)) return raw;
  return `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
};

window.fmtMD = function(raw) {
  if (!raw) return '';
  if (/^\d{1,2}\/\d{1,2}$/.test(String(raw))) return raw;
  const d = new Date(raw);
  if (isNaN(d)) return raw;
  return `${d.getMonth()+1}/${d.getDate()}`;
};

window.toISODate = function(raw) {
  if (!raw) return '';
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(raw)) {
      const [mo,dy,yr] = raw.split('/');
      return `20${yr}-${String(mo).padStart(2,'0')}-${String(dy).padStart(2,'0')}`;
    }
    if (/^\d{1,2}\/\d{1,2}$/.test(raw)) {
      const [mo,dy] = raw.split('/');
      const yr = new Date().getFullYear();
      return `${yr}-${String(mo).padStart(2,'0')}-${String(dy).padStart(2,'0')}`;
    }
    const d = new Date(raw);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  } catch(e) {}
  return '';
};

window.nowFmt = function() { return window.fmtDateTS(new Date().toISOString()); };

window.fmtTime12 = function(val) {
  if (!val) return '';
  const [h, m] = val.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
};

window.formatEmailDate = function(s) {
  if (!s) return '';
  try {
    // Handle M/D/YY H:MM AM/PM format - leave it alone, it's already clean
    const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})\s+(.+)/);
    if (m) return `${m[1]}/${m[2]} ${m[4]}`;
    const d = new Date(s.replace(' (scheduled)', ''));
    if (isNaN(d)) return s;
    const mo=String(d.getMonth()+1).padStart(2,'0'), dy=String(d.getDate()).padStart(2,'0');
    let h=d.getHours(), min=String(d.getMinutes()).padStart(2,'0'), ampm=h>=12?'PM':'AM';
    h=h%12||12;
    return `${mo}/${dy} ${h}:${min} ${ampm}`;
  } catch { return s; }
};

// Full English-only formatter — never produces locale-dependent (Chinese/Japanese/etc.) characters
// Format: "Mon May 18 2026, 7:00 PM"
window.formatEmailDateLong = function(s) {
  if (!s) return '';
  try {
    let d;
    // Try M/D/YY format with time
    const mdyt = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
    if (mdyt) {
      const mo = parseInt(mdyt[1]) - 1;
      const dy = parseInt(mdyt[2]);
      const yr = mdyt[3].length === 2 ? 2000 + parseInt(mdyt[3]) : parseInt(mdyt[3]);
      let h = mdyt[4] ? parseInt(mdyt[4]) : 0;
      const min = mdyt[5] ? parseInt(mdyt[5]) : 0;
      const ampm = (mdyt[6]||'').toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      d = new Date(yr, mo, dy, h, min);
    } else {
      d = new Date(String(s).replace(' (scheduled)',''));
    }
    if (isNaN(d.getTime())) return String(s);
    const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2,'0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${DAYS[d.getDay()]} ${MONS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}, ${h}:${m} ${ampm}`;
  } catch (e) { return String(s); }
};

window.parseIntakeDate = function(l) {
  if (!l || !l.date) return new Date(0);
  const p = String(l.date).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (p) {
    const yr = p[3].length === 2 ? `20${p[3]}` : p[3];
    return new Date(`${yr}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`);
  }
  const d = new Date(l.date);
  return isNaN(d) ? new Date(0) : d;
};

window.calcDuration = function(raw) {
  if (!raw) return '—';
  const parsed = window.parseIntakeDate({ date: raw });
  if (!parsed || isNaN(parsed)) return '—';
  const now  = new Date();
  const diff = now - parsed;
  const days = Math.floor(diff / 86400000);
  if (days < 0)   return '—';
  if (days < 30)  return days + 'd';
  if (days < 365) { const mo=Math.floor(days/30),rem=days%30; return mo+'mo '+(rem>0?rem+'d':''); }
  const y=Math.floor(days/365),rm=Math.floor((days%365)/30);
  return y+'yr '+(rm>0?rm+'mo':'');
};

window.getEvidenceOpts = function() {
  try { const s=localStorage.getItem(window.userPrefix()+'evidence_opts'); if(s)return JSON.parse(s); } catch(e) {}
  return window.REQUIRED_EVIDENCE.map(e => e.opt);
};
window.saveEvidenceOpts = function(arr) {
  localStorage.setItem(window.userPrefix()+'evidence_opts', JSON.stringify(arr));
  try { window.api({ action:'saveMeta', evidenceOpts:JSON.stringify(arr) }); } catch(e) {}
};
window.getEvidenceCode = function(opt) {
  try { const codes=JSON.parse(localStorage.getItem(window.userPrefix()+'evidence_codes')||'{}'); if(codes[opt])return codes[opt]; const req=window.REQUIRED_EVIDENCE.find(r=>r.opt===opt); if(req)return req.code; } catch(e) {}
  return opt.slice(0,3).toUpperCase();
};
window.saveEvidenceCodes = function(obj) {
  localStorage.setItem(window.userPrefix()+'evidence_codes', JSON.stringify(obj));
  try { window.api({ action:'saveMeta', evidenceCodes:JSON.stringify(obj) }); } catch(e) {}
};
window.getStatusOpts = function() {
  try { const s=localStorage.getItem(window.userPrefix()+'status_opts'); if(s)return JSON.parse(s); } catch(e) {}
  return ['Hot','Cold'];
};
window.saveStatusOpts = function(arr) {
  localStorage.setItem(window.userPrefix()+'status_opts', JSON.stringify(arr));
  try { window.api({ action:'saveMeta', statusOpts:JSON.stringify(arr) }); } catch(e) {}
};
window.getLastEmail = function(id) {
  const h = window.state.emailHistory[id];
  return h && h.length ? h[0] : null;
};
window.findLeadById = function(id) {
  for (const t of window.ALL_TABS) {
    const f = (window.state.leads[t]||[]).find(l=>l.id===id);
    if (f) return f;
  }
  return null;
};
window.findLeadTab = function(id) {
  for (const t of window.ALL_TABS) {
    if ((window.state.leads[t]||[]).find(l=>l.id===id)) return t;
  }
  return null;
};
window.updateGmailStatusBar = function() {
  const email=localStorage.getItem(window.userPrefix()+'gmail_email');
  const bar=document.getElementById('gmailTopStatus');
  if (bar){if(window.gmailToken&&email){bar.textContent='Gmail: '+email.split('@')[0];bar.className='gmail-status gmail-connected';}else{bar.textContent='Gmail: Off';bar.className='gmail-status gmail-disconnected';}}
  const s=document.getElementById('gmailConnectStatus');const e=document.getElementById('gmailConnectEmail');const box=document.getElementById('gmailConnectBox');
  if(s&&e&&box){if(window.gmailToken&&email){s.textContent='Connected';s.style.color='var(--success-text)';e.textContent=email;box.style.background='var(--success-bg)';box.style.borderColor='var(--success)';}else{s.textContent='Not connected';s.style.color='var(--danger-text)';e.textContent='Paste your Gmail access token below.';box.style.background='var(--danger-bg)';box.style.borderColor='var(--danger)';}}
};
window.playNotifSound = function() {
  if (window.notifSoundUrl){const audio=document.getElementById('notifAudio');if(audio){audio.src=window.notifSoundUrl;audio.play().catch(()=>{});}}
};
window.populateAttorneyDropdowns = function() {
  document.querySelectorAll('[id^="filter-atty-"]').forEach(s=>{s.innerHTML='<option value="">All Attorneys</option>'+window.state.attorneys.map(a=>`<option value="${a}">${a}</option>`).join('');});
};
