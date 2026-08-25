// ===== LEAD CRUD, RENDERING & TABLE LOGIC v4 =====
// FIXES:
//   - Chase checkbox: debounce + state guard prevents re-mark loop
//   - Follow-up column: shows ONLY clean M/D date, no ⚠ icon
//   - Intake: EOD and Actions columns swapped (EOD first, Actions last)
//   - Checkbox columns widened so "Upload" shows fully
//   - All lead saves go through sanitizeLeadDates + apiWithRetry
//   - Write-through localStorage cache for instant UI feedback

window.renderLeadsTab = function(tab) { window.renderLeadPage(tab); };

// ── EOD helpers ───────────────────────────────────────────
window._buildEodText = function(lead) {
  const parts = [];
  if (lead.call)     parts.push('Called');
  if (lead.vm)       parts.push('Left VM');
  if (lead.text)     parts.push('Texted');
  if (lead.emailChk) parts.push('Emailed');
  if (lead.upload)   parts.push('Uploaded');
  return parts.join(', ');
};

window._getEodCellHTML = function(lead) {
  const txt = window._buildEodText(lead);
  if (!txt) return '<span style="color:var(--text-muted);font-size:10px">—</span>';
  return `<span style="font-size:10px;color:var(--success-text);font-weight:500">${txt}</span>`;
};

// ── Row DOM patch ─────────────────────────────────────────
window._patchRowDOM = function(tab, lead) {
  const row = document.getElementById(`lead-row-${lead.id}`);
  if (!row) return;

  lead._dropAlert       = lead.rowAlert === 'drop';
  lead._reviewInitiated = lead.rowAlert === 'review';

  let rowBgColor = '';
  // Overdue rows are no longer tinted — keep background clean white.
  // The overdue state is already visible via the Follow-up column's red color.
  if      (lead._reviewInitiated)                        rowBgColor = '#00CF00';
  else if (lead._dropAlert)                              rowBgColor = '#ED6C69';
  else if (lead.starred)                                 rowBgColor = '#fff8d4';   // solid pale gold

  row.style.background = rowBgColor;
  row.classList.remove('row-review','row-drop','row-overdue');
  if      (lead._reviewInitiated)                        row.classList.add('row-review');
  else if (lead._dropAlert)                              row.classList.add('row-drop');
  else if (window._isOverdue && window._isOverdue(lead)) row.classList.add('row-overdue');
  // Clear per-cell backgrounds so the TR-level color shows uniformly across all cells
  // Exception: preserve the nameHighlight on the name cell (td index 2).
  [...row.children].forEach((td, i) => {
    if (i === 2 && lead.nameHighlight) td.style.backgroundColor = lead.nameHighlight;
    else td.style.backgroundColor = '';
  });

  const setText = (td, val) => { if (td && !td.querySelector('input')) td.textContent = val; };

  // ── INTAKE now uses the SAME 22-column layout as PC/O/DBB/Clients ──
  // (Duration | Date | Name | Phone | Email | Status | Attorney | Evidence | Missing
  //  | Level | Move-to | Remarks | Follow-up | Notes | Call | VM | Email✓ | Text | Upl | Drive | Eve)
  // The ONLY differences vs non-intake:
  //   * column [10] is a "Move to" dropdown instead of a "Send" button
  //   * Status select onchange uses updateIntakeLeadField
  // For patching: we share most of the non-intake logic below. Fall through.

  // ── NON-INTAKE & INTAKE shared patching ──
  // Column indexes (apply to BOTH intake and other tabs now):
  // [0]=Duration [1]=Date [2]=Name [3]=Phone [4]=Email [5]=Status [6]=Attorney
  // [7]=Evidence [8]=Missing [9]=Level [10]=Send/Move [11]=Remarks [12]=Follow-up [13]=Notes
  // [14]=Call [15]=VM [16]=EmailChk [17]=Text [18]=Upload [19]=Drive [20]=Eve

  setText(row.children[0], window._durationFromLead(lead) || '—');
  setText(row.children[1], window.normalizeDate(lead.date) || '—');
  if (row.children[2] && !row.children[2].querySelector('input')) {
    const star  = lead.starred        ? '<span style="color:gold;margin-right:3px;font-size:13px">★</span>' : '';
    const prio  = lead.prioTomorrow   ? '<span style="margin-right:3px;font-size:13px">❤️</span>' : '';
    const reply = lead._hasUnreadReply? '<span style="background:#ef4444;color:#fff;font-size:9px;padding:1px 5px;border-radius:8px;margin-left:3px;font-weight:700">NEW</span>' : '';
    row.children[2].innerHTML = `${star}${prio}${reply}${lead.name||''}`;
  }
  if (row.children[3] && !row.children[3].querySelector('input')) {
    const phoneVal = lead.phone || '';
    row.children[3].innerHTML = phoneVal
      ? `<span class="copy-cell" data-copy="${phoneVal.replace(/"/g,'&quot;')}" data-copy-kind="phone" title="Double-click to copy">📞 ${phoneVal}</span>`
      : '<span style="color:var(--text-muted)">—</span>';
  }
  // Email cell: also copy-on-dblclick (replaces inline-edit dblclick handler).
  // Inline editing of email is still available via right-click → Edit Lead.
  if (row.children[4] && !row.children[4].querySelector('input')) {
    const emailVal = lead.email || '';
    row.children[4].innerHTML = emailVal
      ? `<span class="copy-cell" data-copy="${emailVal.replace(/"/g,'&quot;')}" data-copy-kind="email" title="Double-click to copy">${emailVal}</span>`
      : '';
  }

  const statusSelect=row.children[5]?.querySelector('select');
  if(statusSelect){if(statusSelect.value!==(lead.temp||''))statusSelect.value=lead.temp||'';const t=(lead.temp||'').toLowerCase();statusSelect.style.background=t==='hot'?'var(--danger-bg)':t==='cold'?'var(--primary-light)':'var(--border)';statusSelect.style.color=t==='hot'?'var(--danger-text)':t==='cold'?'var(--primary)':'var(--text)';}
  const attySelect=row.children[6]?.querySelector('select');
  if(attySelect&&attySelect.value!==(lead.attorney||''))attySelect.value=lead.attorney||'';

  const ev=lead.evidence||{};
  const evChecked=window.REQUIRED_EVIDENCE.filter(r=>ev[r.opt]==='check');
  const evAnyMarked=window.REQUIRED_EVIDENCE.filter(r=>ev[r.opt]==='check'||ev[r.opt]==='x');
  const missingReq=window.REQUIRED_EVIDENCE.filter(r=>ev[r.opt]!=='check'&&ev[r.opt]!=='x');
  let evDisplay,evBg,evBorder,evColor,evWeight,misDisplay,misColor,misWeight;
  if(evAnyMarked.length===0){evDisplay='None';evBg='#e53935';evBorder='#b71c1c';evColor='#fff';evWeight='700';misDisplay=missingReq.map(r=>r.code).join(', ');misColor='var(--danger)';misWeight='400';}
  else if(evAnyMarked.length===window.REQUIRED_EVIDENCE.length){evDisplay='✅ Ready';evBg='var(--success)';evBorder='var(--success)';evColor='#fff';evWeight='700';misDisplay='✅';misColor='var(--success)';misWeight='600';}
  else{evDisplay=evChecked.map(r=>r.code).join(', ')||'—';evBg=evChecked.length>0?'var(--warning-bg)':'var(--border)';evBorder=evChecked.length>0?'var(--warning)':'var(--border)';evColor=evChecked.length>0?'var(--warning-text)':'var(--text)';evWeight=evChecked.length>0?'600':'400';misDisplay=missingReq.length===(window.REQUIRED_EVIDENCE||[]).length?'NO EVIDENCE YET':missingReq.map(r=>r.code).join(', ');misColor='var(--danger)';misWeight='400';}
  if(ev._missingOverride){misDisplay=ev._missingOverride;misColor='var(--text)';misWeight='400';}

  if(row.children[7]){const d=row.children[7].querySelector('div');if(d){d.style.background=evBg;d.style.borderColor=evBorder;d.style.color=evColor;d.style.fontWeight=evWeight;d.innerHTML=`${evDisplay}<br><span style="font-size:9px;opacity:.7">click ▾</span>`;}}
  const mis8=row.children[8];
  if(mis8){const override=ev._missingOverride;if(override){mis8.textContent=override;mis8.style.color='var(--text)';mis8.style.fontWeight='400';}else{mis8.textContent=misDisplay;mis8.style.color=misColor;mis8.style.fontWeight=misWeight;}}

  // [9]=Level dropdown — update selected value
  const levelSelect=row.children[9]?.querySelector('select');
  if(levelSelect&&levelSelect.value!==(lead.level||''))levelSelect.value=lead.level||'';

  // [10]=Send button — no state to patch

  // [11]=Remarks (last email)
  const le=window.getLastEmail(lead.id);
  if(row.children[11]){row.children[11].textContent=le?window.formatEmailDate(le.sentAt):'—';row.children[11].style.color=le?'var(--primary)':'var(--text-muted)';}

  // [12]=Follow-up — sync from last email date if not manually set
  if(row.children[12]){
    let ffupNI = '';
    if(lead.ffup){
      ffupNI = window.normalizeFFUP(lead.ffup);
    } else if(le && le.sentAt){
      ffupNI = window._ffupFromEmailDate(le.sentAt);
    }
    const todayMDNI2=window.todayMD();
    const ffupIsTodayNI=ffupNI===todayMDNI2;
    if(ffupIsTodayNI){row.children[12].innerHTML=`<span class="ffup-today">${ffupNI}</span>`;}
    else{row.children[12].textContent=ffupNI||'—';}
    const odNI=window._isOverdue&&window._isOverdue(lead);
    row.children[12].style.color=ffupIsTodayNI?'':(odNI&&ffupNI?'var(--danger-text)':ffupNI?'var(--primary)':'var(--text-muted)');
    row.children[12].style.fontWeight=(!ffupIsTodayNI&&odNI&&ffupNI)?'600':'';
  }

  // [13]=Notes
  setText(row.children[13], lead.notes || '+ Add note');
  if (row.children[13]) {
    row.children[13].classList.add('notes-cell');
    row.children[13].setAttribute('data-notes', lead.notes || '');
  }

  // [14-18]=Checkboxes
  ['call','vm','emailChk','text','upload'].forEach((field, i) => {
    const chk = row.children[14+i]?.querySelector('input[type=checkbox]');
    if (chk && chk.checked !== !!lead[field]) chk.checked = !!lead[field];
  });

  // [19]=Drive
  if(row.children[19]&&!row.children[19].querySelector('input')){
    row.children[19].innerHTML=lead.gdrive
      ?`<a href="${lead.gdrive}" target="_blank" style="color:var(--primary);text-decoration:none;font-weight:500">🔗 Open Drive</a>`
      :`<span style="color:var(--text-muted);cursor:pointer" onclick="window.editGdriveLink('${lead.id}','${tab}')">+ Add Link</span>`;
  }

  // [20]=Eve link
  if(row.children[20]&&!row.children[20].querySelector('input')){
    row.children[20].innerHTML=lead.eve
      ?`<a href="${lead.eve}" target="_blank" style="color:var(--primary);text-decoration:none;font-weight:500">🔗 Open</a>`
      :`<span style="color:var(--text-muted);cursor:pointer" onclick="window._editEveLink('${lead.id}','${tab}')">+ Add Link</span>`;
  }
};

// ── Duplicate check ───────────────────────────────────────
window.parseAndAddIntake = async function() {
  const raw=document.getElementById('intakePaste').value.trim();
  if(!raw){document.getElementById('parseError').textContent='Paste lead info first.';return;}
  document.getElementById('parseError').textContent='';
  const ex=key=>{const m=raw.match(new RegExp(key+'\\s*[:-]\\s*(.+)','i'));return m?m[1].trim():'';};
  const name=ex('name'),email=ex('email'),phone=ex('phone');
  const phoneClean=phone.replace(/\D/g,'');
  const dup=window.ALL_TABS.some(t=>(window.state.leads[t]||[]).some(l=>
    (name&&l.name&&l.name.toLowerCase()===name.toLowerCase())||
    (email&&l.email&&l.email.toLowerCase()===email.toLowerCase())||
    (phoneClean.length>=7&&l.phone&&l.phone.replace(/\D/g,'')===phoneClean)
  ));
  if(dup){document.getElementById('parseError').textContent='⚠️ Duplicate detected!';return;}
  const rawDate=ex('date');
  let dateVal='';
  if(rawDate){const d=new Date(rawDate);if(!isNaN(d))dateVal=window.normalizeDate(d.toISOString());}
  if(!dateVal){const n=new Date();dateVal=`${n.getMonth()+1}/${n.getDate()}/${String(n.getFullYear()).slice(-2)}`;}
  const lead={id:`${Date.now()}_${Math.random().toString(36).slice(2)}`,name,phone,email,attorney:ex('attorney')||ex('lead source')||ex('chaser')||ex('source'),date:dateVal,gdrive:'',assignedTo:'Jay',temp:'',notes:'',evidence:{},call:false,vm:false,emailChk:false,text:false,upload:false};
  window.sanitizeLeadDates(lead);
  window.state.leads.intake.unshift(lead);
  document.getElementById('intakePaste').value='';
  window.renderIntakeList();
  window.updateCounters();
  window.playNotifSound();
  try{await window.apiWithRetry({action:'addLead',tab:'intake',lead:JSON.stringify(lead)});}catch(e){}
  window.showSuccess('Lead Added!',`${name} has been added to Intake.`);
};

window._intakeSortStateKey=function(){return(window.currentUser?.key||'jay')+'_intakeSortState';};
window._intakeFilterKey=function(){return(window.currentUser?.key||'jay')+'_intakeFilter';};
window._loadIntakeSortState=function(){try{return JSON.parse(localStorage.getItem(window._intakeSortStateKey())||'{}');}catch(e){return{};}};
window._saveIntakeSortState=function(){try{localStorage.setItem(window._intakeSortStateKey(),JSON.stringify(window.intakeSortState));}catch(e){}};
window._loadIntakeFilter=function(){try{return JSON.parse(localStorage.getItem(window._intakeFilterKey())||'{}');}catch(e){return{};}};
window._saveIntakeFilter=function(){try{localStorage.setItem(window._intakeFilterKey(),JSON.stringify(window.intakeFilter));}catch(e){}};

window._getIntakeDisplayLeads = function() {
  let leads = window.state.leads.intake || [];
  const month = window.intakeFilter?.month;
  if (month) leads = leads.filter(l => { const d = window.parseIntakeDate(l); return !isNaN(d) && (d.getMonth() + 1) === parseInt(month); });
  if (window.intakeFilter?.prioOnly) leads = leads.filter(l => !!l.prioTomorrow);
  const q = (document.getElementById('intake-search')?.value || '').toLowerCase().trim();
  if (q) leads = leads.filter(l => (l.name || '').toLowerCase().includes(q) || (l.phone || '').toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q));

  const ss = window.intakeSortState || {};
  if (ss.column) {
    const order = ss.order === 'asc' ? 1 : -1;

    // Shared "today" anchor + rolling-year parser for ffup sorting
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const THIS_YEAR = today.getFullYear();
    const ffupDisplayed = (l) => {
      if (l.ffup) return window.normalizeFFUP(l.ffup);
      const le = (typeof window.getLastEmail === 'function') ? window.getLastEmail(l.id) : null;
      if (le && le.sentAt && typeof window._ffupFromEmailDate === 'function') {
        return window._ffupFromEmailDate(le.sentAt) || '';
      }
      return '';
    };
    const parseFFUP = (s) => {
      if (!s) return null;
      const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
      if (!m) return null;
      const mo = parseInt(m[1], 10) - 1;
      const dy = parseInt(m[2], 10);
      if (mo < 0 || mo > 11 || dy < 1 || dy > 31) return null;
      let yr;
      if (m[3]) {
        yr = parseInt(m[3], 10);
        if (yr < 100) yr += (yr < 50 ? 2000 : 1900);
      } else {
        const candidates = [
          new Date(THIS_YEAR - 1, mo, dy),
          new Date(THIS_YEAR,     mo, dy),
          new Date(THIS_YEAR + 1, mo, dy)
        ];
        let best = candidates[1], bestDist = Math.abs(candidates[1] - today);
        for (let i = 0; i < candidates.length; i++) {
          const d = Math.abs(candidates[i] - today);
          if (d < bestDist) { best = candidates[i]; bestDist = d; }
        }
        return best;
      }
      const d = new Date(yr, mo, dy);
      return isNaN(d) ? null : d;
    };

    leads = [...leads].sort((a, b) => {
      let vA, vB;
      switch (ss.column) {
        case 'date':
          vA = window.parseIntakeDate(a); vB = window.parseIntakeDate(b);
          return (vA - vB) * order;
        case 'name':
          vA = (a.name || '').toLowerCase(); vB = (b.name || '').toLowerCase();
          return vA.localeCompare(vB) * order;
        case 'phone':
          vA = (a.phone || '').toLowerCase(); vB = (b.phone || '').toLowerCase();
          return vA.localeCompare(vB) * order;
        case 'email':
          vA = (a.email || '').toLowerCase(); vB = (b.email || '').toLowerCase();
          return vA.localeCompare(vB) * order;
        case 'attorney':
          vA = (a.attorney || '').toLowerCase(); vB = (b.attorney || '').toLowerCase();
          return vA.localeCompare(vB) * order;
        case 'lastEmail': {
          const leA = window.getLastEmail(a.id);
          const leB = window.getLastEmail(b.id);
          vA = leA ? new Date(leA.sentAt).getTime() : 0;
          vB = leB ? new Date(leB.sentAt).getTime() : 0;
          return (vA - vB) * order;
        }
        case 'ffup': {
          // Use the displayed value (matches what user sees in the cell)
          // and the rolling-year parser. Empty values always sort to bottom.
          vA = parseFFUP(ffupDisplayed(a));
          vB = parseFFUP(ffupDisplayed(b));
          if (vA === null && vB === null) return 0;
          if (vA === null) return 1;
          if (vB === null) return -1;
          return (vA - vB) * order;
        }
        default: {
          if (ss.column === '_missingCount') {
            const evA = typeof a.evidence === 'string' ? JSON.parse(a.evidence || '{}') : (a.evidence || {});
            const evB = typeof b.evidence === 'string' ? JSON.parse(b.evidence || '{}') : (b.evidence || {});
            vA = (window.REQUIRED_EVIDENCE || []).filter(r => evA[r.opt] !== 'check' && evA[r.opt] !== 'x').length;
            vB = (window.REQUIRED_EVIDENCE || []).filter(r => evB[r.opt] !== 'check' && evB[r.opt] !== 'x').length;
            return (vA - vB) * order;
          }
          if (ss.column === 'level') {
            vA = (a.level || '').toLowerCase();
            vB = (b.level || '').toLowerCase();
            return vA.localeCompare(vB) * order;
          }
          return 0;
        }
      }
    });

    // When the user has explicitly sorted, respect that order — don't
    // float starred rows to the top. This is what Sheets does.
    return leads;
  }

  // No explicit sort → keep starred-first as before
  return [...leads.filter(l => l.starred), ...leads.filter(l => !l.starred)];
};

window.renderIntakeList=function(){
  const container=document.getElementById('intakeTableContainer');
  if(!container)return;
  const allLeads=window.state.leads.intake||[];
  const displayed=window._getIntakeDisplayLeads();
  const noFFUPCount=allLeads.filter(l=>!l.ffup).length;
  const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const existingWrap=document.getElementById('intake-table-wrap');
  if(!existingWrap){
    let alertHtml='';
    if(noFFUPCount>0)alertHtml=`<div style="background:var(--warning-bg);border:1px solid var(--warning);border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:12px;color:var(--warning-text)">⚠️ <strong>${noFFUPCount}</strong> lead${noFFUPCount>1?'s':''} need${noFFUPCount===1?'s':''} a follow-up date set</div>`;
    container.innerHTML=alertHtml+`<div class="intake-table-toolbar" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;align-items:center;flex-shrink:0">
      <div style="font-weight:600;font-size:13px;color:var(--primary)">Intake Queue</div>
      <div style="background:var(--primary);color:#fff;font-size:11px;font-weight:700;padding:2px 10px;border-radius:18px">Total: <span id="intakeListCount">${allLeads.length}</span></div>
      <input id="intake-search" placeholder="Search name / phone / email..." oninput="window.scheduleIntakeRender()" style="width:200px;font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid var(--border)">
      <div style="margin-left:auto;display:flex;gap:4px;flex-wrap:wrap;align-items:center">
        <select id="intake-month-select" onchange="window.setIntakeMonthFilter(this.value)" style="font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid var(--border);background:var(--card)">
          <option value="">All Months</option>${MONTHS.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-outline" id="intake-sort-prio" onclick="window.toggleIntakePrioFilter()">⭐ Priority Only</button>
        <button class="btn btn-sm btn-outline" onclick="window.clearTabCheckmarks('intake')">✕ Clear Checks</button>
        <button class="btn btn-sm btn-primary" onclick="window.openBulkEmailModal('intake')">📧 Bulk Email</button>
      </div>
    </div>
    <div class="table-wrap" id="intake-table-wrap" tabindex="0" style="flex:1;min-height:0">${window._renderIntakeTable(displayed)}</div>`;
    const wrap=document.getElementById('intake-table-wrap');
    wrap.addEventListener('keydown',e=>{const step=e.shiftKey?200:40;if(e.key==='ArrowDown'){e.preventDefault();wrap.scrollTop+=step;}if(e.key==='ArrowUp'){e.preventDefault();wrap.scrollTop-=step;}});
    wrap.addEventListener('contextmenu',e=>{const row=e.target.closest('tr[data-id]');if(!row)return;e.preventDefault();window._showIntakeCtxMenu(e.clientX,e.clientY,decodeURIComponent(row.dataset.id));});
    wrap.addEventListener('click',e=>{const el=e.target.closest('[data-action][data-id]');if(!el)return;const id=decodeURIComponent(el.dataset.id);const act=el.dataset.action;if(act==='email')window.openEmailFromIntake(id);else if(act==='notes')window.openIntakeNotesPopup(id);});
    wrap.addEventListener('change',e=>{const el=e.target.closest('[data-action][data-id]');if(!el)return;const id=decodeURIComponent(el.dataset.id);const act=el.dataset.action;if(act==='attorney')window.updateIntakeLeadField(id,'attorney',el.value);else if(act==='move'&&el.value)window.initMove('intake',id,el.value);});
    window._enableColumnResizing(wrap);
    if(window._applyHiddenCols) window._applyHiddenCols(wrap);
  }else{
    const countEl=document.getElementById('intakeListCount');
    if(countEl)countEl.textContent=allLeads.length;
    existingWrap.innerHTML=window._renderIntakeTable(displayed);
    window._syncIntakeBarState();
    if(window._applyHiddenCols) window._applyHiddenCols(existingWrap);
  }
};

window._leadRowActionsHtml=function(tab,id){const emailAction=tab==='intake'?`window.openEmailFromIntake('${id}')`:`window.openEmailModal('${tab}','${id}')`;const notesAction=tab==='intake'?`window.openIntakeNotesPopup('${id}')`:`window.openNotesPopup('${tab}','${id}')`;return`<span class="lead-row-actions"><button type="button" title="Open lead" onclick="event.stopPropagation();window.openLeadDrawer('${tab}','${id}')" ondblclick="event.stopPropagation()">✎</button><button type="button" title="Email lead" onclick="event.stopPropagation();${emailAction}" ondblclick="event.stopPropagation()">✉</button><button type="button" title="Notes" onclick="event.stopPropagation();${notesAction}" ondblclick="event.stopPropagation()">◱</button></span>`;};

window._renderIntakeTable=function(leads){
  if(!leads.length)return'<div class="empty-state">No leads.</div>';
  const ss=window.intakeSortState||{};
  const getSortIcon=col=>ss.column!==col?'':(ss.order==='asc'?' ▲':' ▼');
  const sortTh=(col,label)=>`<th title="Double-click to sort" ondblclick="window.intakeSortByColumn('${col}')">${label}${getSortIcon(col)}</th>`;
  const chkCols=['call','vm','emailChk','text','upload'];
  const chkHdrs=['Call','VM','Email','Text','Upload'];
  const chkWidths=['40px','36px','46px','40px','60px'];
  const rows=leads.map(l=>{try{
    const le=window.getLastEmail(l.id);const leStr=le?window.formatEmailDate(le.sentAt):'—';
    let ev={};try{ev=typeof l.evidence==='string'?JSON.parse(l.evidence||'{}'):(l.evidence||{});}catch(e){ev={};}
    const evChecked=window.REQUIRED_EVIDENCE.filter(r=>ev[r.opt]==='check');const evAnyMarked=window.REQUIRED_EVIDENCE.filter(r=>ev[r.opt]==='check'||ev[r.opt]==='x');const missingReq=window.REQUIRED_EVIDENCE.filter(r=>ev[r.opt]!=='check'&&ev[r.opt]!=='x');
    let evDisplay,misDisplay,evBg,evBorder,evColor,evWeight,misColor,misWeight;
    if(evAnyMarked.length===0){evDisplay='None';misDisplay=missingReq.map(r=>r.code).join(', ');evBg='#e53935';evBorder='#b71c1c';evColor='#fff';evWeight='700';misColor='var(--danger)';misWeight='400';}
    else if(evAnyMarked.length===window.REQUIRED_EVIDENCE.length){evDisplay='✅ Ready';misDisplay='✅';evBg='var(--success)';evBorder='var(--success)';evColor='#fff';evWeight='700';misColor='var(--success)';misWeight='600';}
    else{evDisplay=evChecked.map(r=>r.code).join(', ')||'—';misDisplay=missingReq.length===(window.REQUIRED_EVIDENCE||[]).length?'NO EVIDENCE YET':missingReq.map(r=>r.code).join(', ');evBg=evChecked.length>0?'var(--warning-bg)':'var(--border)';evBorder=evChecked.length>0?'var(--warning)':'var(--border)';evColor=evChecked.length>0?'var(--warning-text)':'var(--text)';evWeight=evChecked.length>0?'600':'400';misColor='var(--danger)';misWeight='400';}
    if(ev._missingOverride){misDisplay=ev._missingOverride;misColor='var(--text)';misWeight='400';}
    const gdriveDisplay=l.gdrive?`<a href="${l.gdrive}" target="_blank" style="color:var(--primary);text-decoration:none;font-weight:500">🔗 Open Drive</a>`:`<span style="color:var(--text-muted);cursor:pointer" onclick="window.editGdriveLink('${l.id}','intake')">+ Add Link</span>`;
    const eveDisplay=l.eve?`<a href="${l.eve}" target="_blank" style="color:var(--primary);text-decoration:none;font-weight:500">🔗 Open</a>`:`<span style="color:var(--text-muted);cursor:pointer" onclick="window._editEveLink('${l.id}','intake')">+ Add Link</span>`;
    const phoneHtml=(()=>{const p=l.phone||'';return p?`<span class="copy-cell" data-copy="${p.replace(/"/g,'&quot;')}" data-copy-kind="phone" title="Double-click to copy">📞 ${p}</span>`:'<span style="color:var(--text-muted)">—</span>';})();
    const od=window._isOverdue&&window._isOverdue(l);
    const starBadge=l.starred?'<span style="color:gold;margin-right:4px;font-size:13px">★</span>':'';
    const replyBadge=l._hasUnreadReply?'<span style="background:#ef4444;color:#fff;font-size:9px;padding:1px 5px;border-radius:8px;margin-left:3px;font-weight:700">NEW</span>':'';
    let rowBg='';
    // Solid colors only. Overdue rows stay white — the follow-up cell already
    // signals the overdue state, no need to tint the whole row.
    if(l.starred) rowBg='#fff8d4';   // solid pale gold for starred / prio today
    // Don't apply background to individual TDs — let the TR-level background show through.
    const cellBg='';
    const durationDisplay=window._durationFromLead?window._durationFromLead(l):'—';
    const ffupClean=l.ffup?window.normalizeFFUP(l.ffup):'';
    const todayMD=window.todayMD?window.todayMD():'';
    const ffupIsToday=ffupClean===todayMD;
    const ffupStyle=ffupIsToday?'':'font-size:10px;'+(od&&ffupClean?'color:var(--danger-text);font-weight:600':ffupClean?'color:var(--primary)':'color:var(--text-muted)');
    const ffupContent=ffupClean?(ffupIsToday?`<span class="ffup-today">${ffupClean}</span>`:ffupClean):'—';
    const levelSelectHtml=`<select style="font-size:10px;padding:2px 4px;border-radius:3px;border:1px solid var(--border);background:var(--card);max-width:110px" onchange="window._handleLevelChange('intake','${l.id}',this)"><option value="" ${!l.level?'selected':''}>— Select —</option>${(window.state.templates||[]).map(t=>`<option value="${t.name}" ${l.level===t.name?'selected':''}>${t.name}</option>`).join('')}<option value="Custom" ${l.level==='Custom'?'selected':''}>Custom</option><option value="__CUSTOM__" style="font-style:italic;color:var(--primary);font-weight:600">✏️ Custom…</option></select>`;
    return`<tr id="lead-row-${l.id}" tabindex="0" data-id="${encodeURIComponent(l.id)}" data-tab="intake" style="${rowBg?'background:'+rowBg:''}">
      <td style="font-size:10px;white-space:nowrap;text-align:center;color:var(--text-muted);${cellBg}">${durationDisplay}</td>
      <td class="editable" ondblclick="window.inlineEdit(this,'intake','${l.id}','date')" style="${cellBg}">${window.normalizeDate(l.date)||'—'}</td>
      <td ondblclick="window.openLeadDrawer('intake','${l.id}')" style="font-weight:600;color:var(--primary);cursor:pointer;${l.nameHighlight?'background:'+l.nameHighlight+';':cellBg}">${starBadge}${l.prioTomorrow?'❤️ ':''}${replyBadge}${l.name||''}${window._leadRowActionsHtml('intake',l.id)}</td>
      <td style="${cellBg}">${phoneHtml}</td>
      <td style="font-size:10px;${cellBg}">${l.email?`<span class="copy-cell" data-copy="${l.email.replace(/"/g,'&quot;')}" data-copy-kind="email" title="Double-click to copy">${l.email}</span>`:''}</td>
      <td style="${cellBg}"><select style="font-size:10px;padding:2px 4px;border-radius:3px;border:1px solid var(--border);background:${(l.temp||'').toLowerCase()==='hot'?'var(--danger-bg)':(l.temp||'').toLowerCase()==='cold'?'var(--primary-light)':'var(--border)'};color:${(l.temp||'').toLowerCase()==='hot'?'var(--danger-text)':(l.temp||'').toLowerCase()==='cold'?'var(--primary)':'var(--text)'};font-weight:600" onchange="window.updateIntakeLeadField('${l.id}','temp',this.value)"><option value="" ${!l.temp?'selected':''}>—</option>${window.getStatusOpts().map(s=>`<option value="${s}" ${l.temp===s?'selected':''}>${s}</option>`).join('')}</select></td>
      <td style="${cellBg}"><select data-action="attorney" data-id="${encodeURIComponent(l.id)}" style="font-size:10px;padding:2px 4px;border-radius:3px;border:1px solid var(--border);background:var(--card);max-width:100px"><option value="" ${!l.attorney?'selected':''}>—</option>${window.state.attorneys.map(a=>`<option value="${a}" ${l.attorney===a?'selected':''}>${a}</option>`).join('')}</select></td>
      <td onclick="window.toggleEvidenceMenu(this,'intake','${l.id}')" style="cursor:pointer;min-width:90px;position:relative;${cellBg}"><div style="background:${evBg};border-radius:5px;padding:3px 7px;font-size:10px;text-align:center;border:1px solid ${evBorder};color:${evColor};font-weight:${evWeight};user-select:none">${evDisplay}<br><span style="font-size:9px;opacity:.7">click ▾</span></div></td>
      <td style="font-size:10px;color:${misColor};font-weight:${misWeight};${cellBg}" ondblclick="window._editMissingEvidence(this,'intake','${l.id}')" title="Double-click to edit">${misDisplay}</td>
      <td style="${cellBg}">${levelSelectHtml}</td>
      <td style="text-align:center;${cellBg}"><button class="btn btn-sm btn-primary" style="font-size:10px;padding:2px 8px" onclick="window.openSendPreviewModal('intake','${l.id}')">▶ Send</button></td>
      <td style="font-size:10px;color:${le?'var(--primary)':'var(--text-muted)'};white-space:nowrap;${cellBg}">${leStr}</td>
      <td class="ffup-cell" ondblclick="window.makeFollowUpEditable('${l.id}','intake')" style="${ffupStyle};cursor:pointer;${cellBg}">${ffupContent}</td>
      <td class="notes-cell" data-notes="${(l.notes||'').replace(/"/g,'&quot;')}" ondblclick="window.openIntakeNotesPopup('${l.id}')" style="cursor:pointer;max-width:120px;font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${cellBg}">${l.notes||'+ Add note'}</td>
      ${chkCols.map((c,i)=>`<td class="chk-col" style="min-width:${chkWidths[i]};text-align:center;${cellBg}"><input type="checkbox" ${l[c]?'checked':''} onchange="window.toggleLeadCheckbox('intake','${l.id}','${c}',this.checked)"></td>`).join('')}
      <td style="font-size:10px;${cellBg}">${gdriveDisplay}</td>
      <td style="font-size:10px;${cellBg}">${eveDisplay}</td>
    </tr>`;
  }catch(err){console.error('Intake row error',l?.id,err);return'';}}).join('');
  return`<table><thead><tr>
    ${sortTh('assignedDate','Duration')}
    ${sortTh('date','Date')} ${sortTh('name','Name')}
    ${sortTh('phone','Phone')} ${sortTh('email','Email')}
    ${sortTh('temp','Status')} ${sortTh('attorney','Attorney')}
    <th>Evidence</th>${sortTh('_missingCount','Missing')}
    ${sortTh('level','Level')}<th>Send</th>
    ${sortTh('lastEmail','Remarks')} ${sortTh('ffup','Follow-up')} ${sortTh('notes','Notes')}
    ${chkCols.map((c,i)=>`<th class="chk-col" style="min-width:${chkWidths[i]};text-align:center;font-size:10px">${chkHdrs[i]}</th>`).join('')}
    <th>Drive</th><th>Eve</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
};

window._syncIntakeBarState=function(){const fil=window.intakeFilter||{};const sel=document.getElementById('intake-month-select');if(sel)sel.value=fil.month||'';};
// Filtering redraws the table. Coalesce fast typing so the browser can paint
// between updates and the search field remains responsive.
window.scheduleIntakeRender=function(){clearTimeout(window._intakeRenderTimer);if(window._intakeRenderFrame)cancelAnimationFrame(window._intakeRenderFrame);window._intakeRenderTimer=setTimeout(()=>{window._intakeRenderFrame=requestAnimationFrame(()=>{window._intakeRenderFrame=null;window.renderIntakeList();});},80);};
window.setIntakeMonthFilter=function(val){if(!window.intakeFilter)window.intakeFilter={};window.intakeFilter.month=val?parseInt(val):null;window._saveIntakeFilter();window.renderIntakeList();};
window.toggleIntakePrioFilter=function(){if(!window.intakeFilter)window.intakeFilter={};window.intakeFilter.prioOnly=!window.intakeFilter.prioOnly;window._saveIntakeFilter();window.renderIntakeList();};
window.updateIntakeLeadField=async function(id,field,val){const lead=window.state.leads.intake.find(l=>l.id===id);if(!lead)return;lead[field]=val;window.sanitizeLeadDates(lead);window._patchRowDOM('intake',lead);try{await window.apiWithRetry({action:'updateLead',tab:'intake',lead:JSON.stringify(lead)});}catch(e){}};
window.openIntakeNotesPopup=function(id){const lead=window.state.leads.intake.find(l=>l.id===id);if(!lead)return;window.notesLeadId=id;window.notesLeadTab='intake';document.getElementById('notesLeadName').textContent=lead.name;document.getElementById('notesContent').value=lead.notes||'';window.openModal('modalNotes');};
window._showIntakeCtxMenu=function(x,y,id){window._showCtxMenuForLead(x,y,id,'intake');};
window.deleteIntakeLead = async function(id) {
  if (!confirm('Remove this lead from Intake?')) return;

  const lead = (window.state.leads.intake || []).find(l => l.id === id);
  if (!lead) return;

  const originalLeads = [...(window.state.leads.intake || [])];
  window.setSyncStatus('syncing', 'Deleting...');

  try {
    const result = await window.apiWithRetry({
      action: 'deleteLead',
      tab: 'intake',
      id,
      lead: JSON.stringify(lead)
    }, 3);

    if (!result || !result.ok) {
      throw new Error(result?.error || 'Delete failed.');
    }

    const deletedCount = Number(result.deletedCount || 0);
    if (deletedCount < 1) {
      throw new Error('The server did not delete the lead.');
    }

    const targetEmail = String(lead.email || '').trim().toLowerCase();
    const targetPhone = String(lead.phone || '').replace(/\D/g, '');
    const targetName = String(lead.name || '').trim().toLowerCase().replace(/\s+/g, ' ');

    window.state.leads.intake = (window.state.leads.intake || []).filter(item => {
      if (item.id === id) return false;

      const itemEmail = String(item.email || '').trim().toLowerCase();
      const itemPhone = String(item.phone || '').replace(/\D/g, '');
      const itemName = String(item.name || '').trim().toLowerCase().replace(/\s+/g, ' ');

      const sameEmailAndPhone =
        targetEmail && targetPhone &&
        itemEmail === targetEmail && itemPhone === targetPhone;

      const samePhoneAndName =
        !targetEmail && targetPhone && targetName &&
        itemPhone === targetPhone && itemName === targetName;

      return !(sameEmailAndPhone || samePhoneAndName);
    });

    window._cacheDelete('intake', id);
    window.renderIntakeList();
    window.updateCounters();

    window.setSyncStatus(
      'ok',
      'Deleted ' + deletedCount + ' record' + (deletedCount === 1 ? '' : 's')
    );

    window.showSuccess(
      'Deleted',
      `"${lead.name}" was deleted. ${deletedCount} record${deletedCount === 1 ? '' : 's'} removed.`
    );
  } catch (e) {
    window.state.leads.intake = originalLeads;
    window.renderIntakeList();
    window.updateCounters();

    window.setSyncStatus('err', 'Delete failed: ' + (e.message || 'Unknown error'));
    window.showSuccess(
      'Delete Failed',
      `Could not delete ${lead.name}. ${e.message || 'Please try again.'}`
    );
  }
};

// ── Clear all checkmarks ──────────────────────────────────
window.clearTabCheckmarks=async function(tab){
  if(!confirm(`Clear all checkmarks in ${window.TAB_LABELS[tab]||tab}?`))return;
  window.showLoading('Clearing checkmarks...');
  const leads=window.state.leads[tab]||[];
  const fields=['call','vm','emailChk','text','upload'];
  for(const lead of leads){
    let changed=false;
    fields.forEach(f=>{if(lead[f]){lead[f]=false;changed=true;}});
    if(changed){window.sanitizeLeadDates(lead);window._patchRowDOM(tab,lead);try{await window.apiWithRetry({action:'updateLead',tab,lead:JSON.stringify(lead)});}catch(e){}}
  }
  window.hideLoading();
  if(tab==='intake')window.renderIntakeList();else window.renderLeadPage(tab);
  window._refreshTodaysFocusIfOpen();
  window.showSuccess('Cleared!',`All checkmarks in ${window.TAB_LABELS[tab]||tab} cleared.`);
};

window.togglePrioTomorrow=async function(tab,id){
  const lead=tab==='intake'?window.state.leads.intake.find(l=>l.id===id):window.findLeadById(id);
  if(!lead)return;
  lead.prioTomorrow=!lead.prioTomorrow;
  if(lead.prioTomorrow){if(!window.prioTomorrowLeads.find(p=>p.id===id))window.prioTomorrowLeads.push({id,name:lead.name,tab});}
  else{window.prioTomorrowLeads=window.prioTomorrowLeads.filter(p=>p.id!==id);}
  window._patchRowDOM(tab,lead);
  if(tab==='intake')window.renderIntakeList();else window.renderLeadsTab(tab);
  window.playNotifSound();
  window.showSuccess(lead.prioTomorrow?'❤️ Prio Tomorrow!':'Removed',`${lead.name} ${lead.prioTomorrow?'marked':'removed'}.`);
  window._protectField(lead.id,'prioTomorrow', 15 * 60 * 1000, lead.prioTomorrow);
  window._pendingSaves.add(lead.id);
  window.sanitizeLeadDates(lead);
  const payload={action:'updateLead',tab,lead:JSON.stringify(lead)};
  try{window._queueSave(payload);await window._flushNow();}catch(e){setTimeout(async()=>{try{window._queueSave(payload);await window._flushNow();}catch(e2){}},1500);}finally{window._pendingSaves.delete(lead.id);}
  window._refreshTodaysFocusIfOpen();
};

window.closeLeadDrawer=function(){const ov=document.querySelector('.lead-drawer-overlay');if(ov?._escKey)document.removeEventListener('keydown',ov._escKey);ov?.remove();};

window.openLeadDrawer=function(tab,id){
  const lead=window.findLeadById(id);if(!lead)return;
  window.closeLeadDrawer();
  const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const selected=v=>String(lead.temp||'')===v?'selected':'';
  const attorneyOptions=(window.state.attorneys||[]).map(a=>`<option value="${esc(a)}" ${(lead.attorney||lead.source)===a?'selected':''}>${esc(a)}</option>`).join('');
  const ov=document.createElement('div');ov.className='lead-drawer-overlay';
  ov.innerHTML=`<aside class="lead-drawer" role="dialog" aria-modal="true" aria-label="Edit lead">
    <div class="lead-drawer-header"><div><div class="lead-drawer-eyebrow">${esc(window.TAB_LABELS[tab]||tab)}</div><h2>${esc(lead.name||'Untitled lead')}</h2></div><button type="button" class="lead-drawer-close" onclick="window.closeLeadDrawer()" aria-label="Close">×</button></div>
    <div class="lead-drawer-body">
      <label>Full name<input id="drawer-name" value="${esc(lead.name)}"></label>
      <div class="lead-drawer-grid"><label>Phone<input id="drawer-phone" value="${esc(lead.phone)}"></label><label>Email<input id="drawer-email" type="email" value="${esc(lead.email)}"></label></div>
      <div class="lead-drawer-grid"><label>Status<select id="drawer-status"><option value="">—</option>${(window.getStatusOpts?.()||[]).map(s=>`<option value="${esc(s)}" ${selected(s)}>${esc(s)}</option>`).join('')}</select></label><label>Attorney<select id="drawer-attorney"><option value="">—</option>${attorneyOptions}</select></label></div>
      <div class="lead-drawer-grid"><label>Date<input id="drawer-date" value="${esc(window.normalizeDate(lead.date)||'')}" placeholder="M/D/YY"></label><label>Follow-up<input id="drawer-ffup" value="${esc(window.normalizeFFUP(lead.ffup)||'')}" placeholder="M/D"></label></div>
      <label>Notes<textarea id="drawer-notes" rows="5">${esc(lead.notes)}</textarea></label>
      <label>Google Drive link<input id="drawer-gdrive" value="${esc(lead.gdrive)}"></label>
    </div>
    <div class="lead-drawer-footer"><button type="button" class="btn btn-outline" onclick="window.closeLeadDrawer()">Cancel</button><button type="button" class="btn btn-primary" onclick="window.saveLeadDrawer('${tab}','${id}')">Save changes</button></div>
  </aside>`;
  document.body.appendChild(ov);ov.addEventListener('click',e=>{if(e.target===ov)window.closeLeadDrawer();});
  ov._escKey=e=>{if(e.key==='Escape')window.closeLeadDrawer();};document.addEventListener('keydown',ov._escKey);
  requestAnimationFrame(()=>ov.classList.add('is-open'));setTimeout(()=>document.getElementById('drawer-name')?.focus(),100);
};

window.saveLeadDrawer=async function(tab,id){
  const lead=window.findLeadById(id);if(!lead)return;
  const value=name=>document.getElementById(name)?.value?.trim()||'';
  const date=value('drawer-date');const normalizedDate=date?window.normalizeDate(date):'';
  if(date&&!/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(normalizedDate)){window.showSuccess('Invalid date','Use M/D/YY.');return;}
  const ffup=value('drawer-ffup');const normalizedFfup=ffup?window.normalizeFFUP(ffup):'';
  lead.name=value('drawer-name')||lead.name;lead.phone=value('drawer-phone');lead.email=value('drawer-email');lead.temp=value('drawer-status');lead.attorney=value('drawer-attorney');lead.source=lead.attorney;lead.date=normalizedDate;lead.ffup=normalizedFfup;lead.notes=value('drawer-notes');lead.gdrive=value('drawer-gdrive');
  window.sanitizeLeadDates(lead);window._patchRowDOM(tab,lead);window.updateCounters?.();window.closeLeadDrawer();
  try{await window.apiWithRetry({action:'updateLead',tab,lead:JSON.stringify(lead)});window.showSuccess('Lead updated','Changes saved.');}catch(e){window.showSuccess('Save queued','Your change is kept locally and will retry.');}
  window._refreshTodaysFocusIfOpen?.();
};

window.openEditLeadModal=function(tab,id){const lead=window.findLeadById(id);if(!lead)return;document.querySelectorAll('.edit-lead-overlay').forEach(x=>x.remove());const ov=document.createElement('div');ov.className='edit-lead-overlay';ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';const sv=v=>(v||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');ov.innerHTML=`<div style="background:var(--card);border-radius:10px;padding:22px;max-width:400px;width:100%;box-shadow:0 12px 40px var(--shadow-lg)"><div style="font-size:14px;font-weight:700;color:var(--primary);margin-bottom:16px">✏️ Edit Lead — ${window.TAB_LABELS[tab]||tab}</div><div style="display:flex;flex-direction:column;gap:11px"><div><label style="font-size:11px;font-weight:600;display:block;margin-bottom:3px">Full Name</label><input id="el_name" value="${sv(lead.name)}" style="width:100%"></div><div><label style="font-size:11px;font-weight:600;display:block;margin-bottom:3px">Phone</label><input id="el_phone" value="${sv(lead.phone)}" style="width:100%"></div><div><label style="font-size:11px;font-weight:600;display:block;margin-bottom:3px">Email</label><input id="el_email" value="${sv(lead.email)}" style="width:100%"></div><div><label style="font-size:11px;font-weight:600;display:block;margin-bottom:3px">Attorney</label><select id="el_attorney" style="width:100%"><option value="">—</option>${window.state.attorneys.map(a=>`<option value="${a}" ${(lead.attorney||lead.source)===a?'selected':''}>${a}</option>`).join('')}</select></div><div><label style="font-size:11px;font-weight:600;display:block;margin-bottom:3px">Date (M/D/YY)</label><input id="el_date" value="${window.normalizeDate(lead.date)||''}" style="width:100%" placeholder="e.g. 5/11/26"></div><div><label style="font-size:11px;font-weight:600;display:block;margin-bottom:3px">Google Drive Link</label><input id="el_gdrive" value="${sv(lead.gdrive)}" style="width:100%"></div></div><div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end"><button class="btn btn-outline btn-sm" onclick="document.querySelector('.edit-lead-overlay').remove()">Cancel</button><button class="btn btn-primary btn-sm" onclick="window.saveLeadEdit('${tab}','${id}')">💾 Save</button></div></div>`;document.body.appendChild(ov);ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});setTimeout(()=>document.getElementById('el_name')?.focus(),50);};
window.saveLeadEdit=async function(tab,id){const lead=window.findLeadById(id);if(!lead)return;lead.name=document.getElementById('el_name').value.trim()||lead.name;lead.phone=document.getElementById('el_phone').value.trim();lead.email=document.getElementById('el_email').value.trim();lead.attorney=document.getElementById('el_attorney').value;lead.source=lead.attorney;lead.gdrive=document.getElementById('el_gdrive').value.trim();const dv=document.getElementById('el_date').value.trim();if(dv){const normalized=window.normalizeDate(dv);if(!/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(normalized)){window.showSuccess('Invalid Date','Use M/D/YY');return;}lead.date=normalized;}else{lead.date='';}document.querySelector('.edit-lead-overlay')?.remove();window.sanitizeLeadDates(lead);window._patchRowDOM(tab,lead);window.playNotifSound();try{await window.apiWithRetry({action:'updateLead',tab,lead:JSON.stringify(lead)});}catch(e){}window.showSuccess('Lead Updated!','Changes saved.');window._refreshTodaysFocusIfOpen();};
window.editGdriveLink=function(id,tab){const lead=window.findLeadById(id);if(!lead)return;const newUrl=prompt(`Google Drive link for ${lead.name}:`,lead.gdrive||'');if(newUrl===null)return;lead.gdrive=newUrl.trim();window._patchRowDOM(tab,lead);try{window.apiWithRetry({action:'updateLead',tab,lead:JSON.stringify(lead)});}catch(e){}if(newUrl)window.showSuccess('Drive Link Saved',`Updated for ${lead.name}.`);};

window.renderLeadPage=function(tab){
  if(tab==='retainer'){window.renderRetainerPage();return;}
  const el=document.getElementById('page-'+tab);if(!el)return;
  const leads=window.state.leads[tab]||[];
  const overdue=leads.filter(l=>window._isOverdue&&window._isOverdue(l));
  const noFFUP=leads.filter(l=>!l.ffup);
  const existingWrap=document.getElementById('leadtable-wrap-'+tab);
  if(!existingWrap){
    let alertHtml='';
    if(overdue.length||noFFUP.length){const msgs=[];if(overdue.length)msgs.push(`<strong>${overdue.length}</strong> overdue`);if(noFFUP.length)msgs.push(`<strong>${noFFUP.length}</strong> no follow-up date`);alertHtml=`<div id="tab-alert-${tab}" style="background:var(--warning-bg);border:1px solid var(--warning);border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:var(--warning-text);flex-shrink:0">⚠️ ${msgs.join(' · ')} in this tab</div>`;}
    el.innerHTML=alertHtml+`<div class="page-header" style="flex-shrink:0">
      <div class="page-title">${window.TAB_LABELS[tab]||tab} Leads <span style="background:var(--primary);color:#fff;font-size:11px;padding:2px 10px;border-radius:18px;margin-left:8px;font-weight:700"><span id="leadcount-${tab}">${leads.length}</span></span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <input id="filter-search-${tab}" placeholder="Search..." oninput="window.scheduleFilterLeads('${tab}')" style="width:160px;font-size:11px;padding:3px 8px;border-radius:5px;border:1px solid var(--border)">
        <select id="filter-status-${tab}" onchange="window.filterLeads('${tab}')" style="font-size:11px;padding:3px 6px;border-radius:5px;border:1px solid var(--border);background:var(--card)"><option value="">All Status</option>${window.getStatusOpts().map(s=>`<option value="${s}">${s}</option>`).join('')}</select>
        <select id="filter-atty-${tab}" onchange="window.filterLeads('${tab}')" style="font-size:11px;padding:3px 6px;border-radius:5px;border:1px solid var(--border);background:var(--card)"><option value="">All Attorneys</option>${window.state.attorneys.map(a=>`<option value="${a}">${a}</option>`).join('')}</select>
        <button class="btn btn-sm ${(window.prioFilter?.[tab])?'btn-primary':'btn-outline'}" id="sort-prio-${tab}" onclick="window.togglePrioFilter('${tab}')">⭐ Priority</button>
        <button class="btn btn-sm btn-outline" onclick="window.clearTabCheckmarks('${tab}')">✕ Clear Checks</button>
        <button class="btn btn-sm btn-primary" onclick="window.openBulkEmailModal('${tab}')">📧 Bulk Email</button>
      </div>
    </div>
    <div class="table-wrap" id="leadtable-wrap-${tab}" tabindex="0" style="flex:1;min-height:0">${window.renderLeadTable(tab,window._getDisplayLeads(tab))}</div>`;
    const wrap=document.getElementById('leadtable-wrap-'+tab);
    if(wrap){wrap.addEventListener('keydown',e=>{const step=e.shiftKey?200:40;if(e.key==='ArrowDown'){e.preventDefault();wrap.scrollTop+=step;}if(e.key==='ArrowUp'){e.preventDefault();wrap.scrollTop-=step;}});wrap.addEventListener('contextmenu',e=>{const row=e.target.closest('tr[data-id]');if(!row)return;e.preventDefault();window.showCtxMenu(e.clientX,e.clientY,decodeURIComponent(row.dataset.id),tab);});}
    if(window._applyHiddenCols && wrap) window._applyHiddenCols(wrap);
  }else{
    const countEl=document.getElementById('leadcount-'+tab);if(countEl)countEl.textContent=leads.length;
    existingWrap.innerHTML=window.renderLeadTable(tab,window._getDisplayLeads(tab));
    window._syncFilterBarState(tab);
    let alertEl=document.getElementById('tab-alert-'+tab);
    if(overdue.length||noFFUP.length){const msgs=[];if(overdue.length)msgs.push(`<strong>${overdue.length}</strong> overdue`);if(noFFUP.length)msgs.push(`<strong>${noFFUP.length}</strong> no follow-up date`);if(!alertEl){alertEl=document.createElement('div');alertEl.id='tab-alert-'+tab;alertEl.style.cssText='background:var(--warning-bg);border:1px solid var(--warning);border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:var(--warning-text);flex-shrink:0';el.insertBefore(alertEl,el.firstChild);}alertEl.innerHTML=`⚠️ ${msgs.join(' · ')} in this tab`;alertEl.style.display='block';}else if(alertEl){alertEl.style.display='none';}
    if(window._applyHiddenCols) window._applyHiddenCols(existingWrap);
  }
};

// ===== Display leads for a regular tab =====
// - prio-only filter (when toggled)
// - explicit column sort (if active) — when active, no smart-bucketing,
//   user sees pure chronological/alphabetical order
// - smart "stack" reorder (Star → Prio Tomorrow → Overdue → Rest) only
//   applies when no explicit sort is active. Bucketing is mutually
//   exclusive so no rows ever go missing.
window._getDisplayLeads = function(tab) {
  let leads = window.state.leads[tab] || [];
  if (window.prioFilter?.[tab]) leads = leads.filter(l => !!l.prioTomorrow);
  const ss = window.sortState[tab] || { col: null, dir: 1 };
  let sorted = [...leads];

  // ---- ffup parsing: rolling-year, displayed-value aware ----
  // Use a single "today" anchor so all rows compare consistently.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const THIS_YEAR = today.getFullYear();

  // Get the value shown in the Follow-up cell for a lead. Mirrors the
  // renderer: lead.ffup wins; else derive from the lead's last email.
  const ffupDisplayed = (l) => {
    if (l.ffup) return window.normalizeFFUP(l.ffup);
    const le = (typeof window.getLastEmail === 'function') ? window.getLastEmail(l.id) : null;
    if (le && le.sentAt && typeof window._ffupFromEmailDate === 'function') {
      return window._ffupFromEmailDate(le.sentAt) || '';
    }
    return '';
  };

  // Parse M/D, M/D/YY, M/D/YYYY into a real Date. For year-less M/D,
  // pick the year that makes the date nearest to today (rolling year):
  // 6 months before → this year; >6 months in the past → next year;
  // >6 months in the future → last year.
  // Empty / unparseable → null (always sorts to bottom).
  const parseFFUP = (s) => {
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (!m) return null;
    const mo = parseInt(m[1], 10) - 1;
    const dy = parseInt(m[2], 10);
    if (mo < 0 || mo > 11 || dy < 1 || dy > 31) return null;
    let yr;
    if (m[3]) {
      yr = parseInt(m[3], 10);
      if (yr < 100) yr += (yr < 50 ? 2000 : 1900);
    } else {
      // No year → rolling-year heuristic
      const candidates = [
        new Date(THIS_YEAR - 1, mo, dy),
        new Date(THIS_YEAR,     mo, dy),
        new Date(THIS_YEAR + 1, mo, dy)
      ];
      // Pick the one closest to today
      let best = candidates[1], bestDist = Math.abs(candidates[1] - today);
      for (let i = 0; i < candidates.length; i++) {
        const d = Math.abs(candidates[i] - today);
        if (d < bestDist) { best = candidates[i]; bestDist = d; }
      }
      return best;
    }
    const d = new Date(yr, mo, dy);
    return isNaN(d) ? null : d;
  };

  if (ss.col) {
    sorted = sorted.sort((a, b) => {
      let vA, vB;
      if (ss.col === 'date' || ss.col === 'assignedDate') {
        const key = ss.col === 'assignedDate' ? 'assignedDate' : 'date';
        vA = window.parseIntakeDate({ date: a[key] });
        vB = window.parseIntakeDate({ date: b[key] });
      } else if (ss.col === 'ffup') {
        vA = parseFFUP(ffupDisplayed(a));
        vB = parseFFUP(ffupDisplayed(b));
      } else if (ss.col === '_missingCount') {
        // Sort by number of missing evidence items (0 = all present = best)
        const evA = typeof a.evidence === 'string' ? JSON.parse(a.evidence || '{}') : (a.evidence || {});
        const evB = typeof b.evidence === 'string' ? JSON.parse(b.evidence || '{}') : (b.evidence || {});
        vA = (window.REQUIRED_EVIDENCE || []).filter(r => evA[r.opt] !== 'check' && evA[r.opt] !== 'x').length;
        vB = (window.REQUIRED_EVIDENCE || []).filter(r => evB[r.opt] !== 'check' && evB[r.opt] !== 'x').length;
      } else if (['call', 'vm', 'emailChk', 'text', 'upload'].includes(ss.col)) {
        vA = a[ss.col] ? 1 : 0;
        vB = b[ss.col] ? 1 : 0;
      } else {
        vA = a[ss.col] || '';
        vB = b[ss.col] || '';
      }
      // Empty ffup values always sort to the bottom, regardless of direction.
      if (ss.col === 'ffup') {
        if (vA === null && vB === null) return 0;
        if (vA === null) return 1;
        if (vB === null) return -1;
      }
      let cmp = 0;
      if (vA instanceof Date && vB instanceof Date) cmp = vA.getTime() - vB.getTime();
      else if (typeof vA === 'boolean' || typeof vB === 'boolean') cmp = Number(vA) - Number(vB);
      else cmp = String(vA).localeCompare(String(vB), undefined, { sensitivity: 'base' });
      return cmp * ss.dir;
    });
    // When the user has explicitly sorted, respect that order — don't
    // re-bucket. This matches Google Sheets behavior. (Previously,
    // starred / prio / overdue rows still floated to the top even when
    // sorting by Follow-up, and some rows were silently dropped.)
    return sorted;
  }

  // No explicit sort → smart stack. Mutually exclusive buckets in
  // precedence order: starred > prioTomorrow > overdue > rest. This
  // guarantees every row appears exactly once (the old code dropped
  // rows that were both starred AND prioTomorrow).
  const isOd = (l) => !!(window._isOverdue && window._isOverdue(l));
  const starLeads    = sorted.filter(l =>  l.starred);
  const prioLeads    = sorted.filter(l => !l.starred &&  l.prioTomorrow);
  const overdueLeads = sorted.filter(l => !l.starred && !l.prioTomorrow &&  isOd(l));
  const restLeads    = sorted.filter(l => !l.starred && !l.prioTomorrow && !isOd(l));
  return [...starLeads, ...prioLeads, ...overdueLeads, ...restLeads];
};
window._syncFilterBarState=function(tab){const prio=!!(window.prioFilter?.[tab]);const pb=document.getElementById('sort-prio-'+tab);if(pb)pb.className='btn btn-sm '+(prio?'btn-primary':'btn-outline');};

window.renderLeadTable=function(tab,leads){
  if(!leads.length)return'<div class="empty-state">No leads in this tab.</div>';
  const ss=window.sortState[tab]||{col:null,dir:1};
  const chkCols=['call','vm','emailChk','text','upload'];
  const chkHdrs=['Call','VM','Email','Text','Upload'];
  const chkWidths=['40px','36px','46px','40px','60px'];
  const sortTh=(col,label,extraClass='')=>{const active=ss.col===col;const icon=active?(ss.dir===1?' ▲':' ▼'):'';return`<th class="${extraClass}" title="Double-click to sort" ondblclick="window.sortLeads('${tab}','${col}')">${label}${icon}</th>`;};
  // New column order:
  // Duration | Date(frozen) | Name(frozen) | Phone | Email | Status | Attorney
  // | Evidence | Missing | Level | Send | Remarks | Follow-up | Notes
  // | Call | VM | Email✓ | Text | Upl | Drive | Eve
  const rows=leads.map(l=>{try{
    const le=window.getLastEmail(l.id);const leStr=le?window.formatEmailDate(le.sentAt):'—';
    // Safely parse evidence — Google Sheets may send it as a JSON string
    let ev={};try{ev=typeof l.evidence==='string'?JSON.parse(l.evidence||'{}'):(l.evidence||{});}catch(e){ev={};}
    const evChecked=window.REQUIRED_EVIDENCE.filter(r=>ev[r.opt]==='check');const evAnyMarked=window.REQUIRED_EVIDENCE.filter(r=>ev[r.opt]==='check'||ev[r.opt]==='x');const missingReq=window.REQUIRED_EVIDENCE.filter(r=>ev[r.opt]!=='check'&&ev[r.opt]!=='x');
    let evDisplay,misDisplay,evBg,evBorder,evColor,evWeight,misColor,misWeight;
    if(evAnyMarked.length===0){evDisplay='None';misDisplay=missingReq.map(r=>r.code).join(', ');evBg='#e53935';evBorder='#b71c1c';evColor='#fff';evWeight='700';misColor='var(--danger)';misWeight='400';}
    else if(evAnyMarked.length===window.REQUIRED_EVIDENCE.length){evDisplay='✅ Ready';misDisplay='✅';evBg='var(--success)';evBorder='var(--success)';evColor='#fff';evWeight='700';misColor='var(--success)';misWeight='600';}
    else{evDisplay=evChecked.map(r=>r.code).join(', ')||'—';misDisplay=missingReq.length===(window.REQUIRED_EVIDENCE||[]).length?'NO EVIDENCE YET':missingReq.map(r=>r.code).join(', ');evBg=evChecked.length>0?'var(--warning-bg)':'var(--border)';evBorder=evChecked.length>0?'var(--warning)':'var(--border)';evColor=evChecked.length>0?'var(--warning-text)':'var(--text)';evWeight=evChecked.length>0?'600':'400';misColor='var(--danger)';misWeight='400';}
    if(ev._missingOverride){misDisplay=ev._missingOverride;misColor='var(--text)';misWeight='400';}
    const gdriveDisplay=l.gdrive?`<a href="${l.gdrive}" target="_blank" style="color:var(--primary);text-decoration:none;font-weight:500">🔗 Open Drive</a>`:`<span style="color:var(--text-muted);cursor:pointer" onclick="window.editGdriveLink('${l.id}','${tab}')">+ Add Link</span>`;
    const eveDisplay=l.eve?`<a href="${l.eve}" target="_blank" style="color:var(--primary);text-decoration:none;font-weight:500">🔗 Open</a>`:`<span style="color:var(--text-muted);cursor:pointer" onclick="window._editEveLink('${l.id}','${tab}')">+ Add Link</span>`;
    const phoneHtml=(()=>{const p=l.phone||'';return p?`<span class="copy-cell" data-copy="${p.replace(/"/g,'&quot;')}" data-copy-kind="phone" title="Double-click to copy">📞 ${p}</span>`:'<span style="color:var(--text-muted)">—</span>';})();
    const isDropAlert=l.rowAlert==='drop';const isReview=l.rowAlert==='review';
    const od=window._isOverdue&&window._isOverdue(l);
    const starBadge=l.starred?'<span style="color:gold;margin-right:4px;font-size:13px">★</span>':'';
    const replyBadge=l._hasUnreadReply?'<span style="background:#ef4444;color:#fff;font-size:9px;padding:1px 5px;border-radius:8px;margin-left:3px;font-weight:700">NEW</span>':'';
    let rowBg='';
    // Solid colors only. Overdue rows stay white — the follow-up cell already
    // shows the overdue state with its red color/weight, no need to tint the
    // whole row (which can make text hard to read with frozen-column overlap).
    if(l.starred)rowBg='#fff8d4';                          // solid pale gold
    if(isReview)rowBg='#00CF00';                           // green for ready for review
    if(isDropAlert)rowBg='#ED6C69';                        // red for drop alert
    const cellBg='';   // background lives on the TR only — uniform across all cells
    const rowClass=isReview?'row-review':isDropAlert?'row-drop':od?'row-overdue':'';
    const durationDisplay=window._durationFromLead(l);
    const _leForFfup = window.getLastEmail(l.id);
    // Follow-up: use lead.ffup if set manually; otherwise derive from last email sent date (Remarks)
    let ffupCleanNI = '';
    if(l.ffup){
      ffupCleanNI = window.normalizeFFUP(l.ffup);
    } else if(_leForFfup && _leForFfup.sentAt){
      // Extract M/D from the Remarks date (e.g. "05/14 12:19 PM" → "5/14")
      ffupCleanNI = window._ffupFromEmailDate(_leForFfup.sentAt);
    }
    const todayMDNI=window.todayMD();
    const ffupIsToday=ffupCleanNI===todayMDNI;
    const ffupOdNI=window._isOverdue&&window._isOverdue(l);
    const ffupStyleNI=ffupIsToday?'':'font-size:10px;'+(ffupOdNI&&ffupCleanNI?'color:var(--danger-text);font-weight:600':ffupCleanNI?'color:var(--primary)':'color:var(--text-muted)');
    const ffupCellContentNI=ffupCleanNI?(ffupIsToday?`<span class="ffup-today">${ffupCleanNI}</span>`:ffupCleanNI):'—';
    const levelSelectHtml=`<select style="font-size:10px;padding:2px 4px;border-radius:3px;border:1px solid var(--border);background:var(--card);max-width:110px" onchange="window._handleLevelChange('${tab}','${l.id}',this)" onmouseenter="window._showTmplPreview(event,this.value,'${l.id}')" onmouseleave="window._hideTmplPreview()"><option value="" ${!l.level?'selected':''}>— Select —</option>${(window.state.templates||[]).map(t=>`<option value="${t.name}" ${l.level===t.name?'selected':''}>${t.name}</option>`).join('')}<option value="Custom" ${l.level==='Custom'?'selected':''}>Custom</option><option value="__CUSTOM__" style="font-style:italic;color:var(--primary);font-weight:600">✏️ Custom…</option></select>`;
    return`<tr id="lead-row-${l.id}" tabindex="0" data-id="${l.id}" data-tab="${tab}" class="${rowClass}" style="background:${rowBg}">
      <td title="Auto-calculated from Date column" style="font-size:10px;white-space:nowrap;text-align:center;color:var(--text-muted);${cellBg}">${durationDisplay}</td>
      <td class="editable" ondblclick="window.inlineEdit(this,'${tab}','${l.id}','date')" style="${cellBg}">${window.normalizeDate(l.date)||'—'}</td>
      <td class="editable" ondblclick="window.openLeadDrawer('${tab}','${l.id}')" style="font-weight:600;color:var(--primary);cursor:pointer;${l.nameHighlight?'background:'+l.nameHighlight+';':cellBg}">${starBadge}${l.prioTomorrow?'❤️ ':''}${replyBadge}${l.name||''}${window._leadRowActionsHtml(tab,l.id)}</td>
      <td style="${cellBg}">${phoneHtml}</td>
      <td style="font-size:10px;${cellBg}">${l.email?`<span class="copy-cell" data-copy="${l.email.replace(/"/g,'&quot;')}" data-copy-kind="email" title="Double-click to copy">${l.email}</span>`:''}</td>
      <td style="${cellBg}"><select style="font-size:10px;padding:2px 4px;border-radius:3px;border:1px solid var(--border);background:${(l.temp||'').toLowerCase()==='hot'?'var(--danger-bg)':(l.temp||'').toLowerCase()==='cold'?'var(--primary-light)':'var(--border)'};color:${(l.temp||'').toLowerCase()==='hot'?'var(--danger-text)':(l.temp||'').toLowerCase()==='cold'?'var(--primary)':'var(--text)'};font-weight:600" onchange="window.updateLeadField('${tab}','${l.id}','temp',this.value)"><option value="" ${!l.temp?'selected':''}>—</option>${window.getStatusOpts().map(s=>`<option value="${s}" ${l.temp===s?'selected':''}>${s}</option>`).join('')}</select></td>
      <td style="${cellBg}"><select style="font-size:10px;padding:2px 4px;border-radius:3px;border:1px solid var(--border);background:var(--card);max-width:100px" onchange="window.updateLeadField('${tab}','${l.id}','attorney',this.value)"><option value="" ${!l.attorney?'selected':''}>—</option>${window.state.attorneys.map(a=>`<option value="${a}" ${l.attorney===a?'selected':''}>${a}</option>`).join('')}</select></td>
      <td onclick="window.toggleEvidenceMenu(this,'${tab}','${l.id}')" style="cursor:pointer;min-width:90px;position:relative;${cellBg}"><div style="background:${evBg};border-radius:5px;padding:3px 7px;font-size:10px;text-align:center;border:1px solid ${evBorder};color:${evColor};font-weight:${evWeight};user-select:none">${evDisplay}<br><span style="font-size:9px;opacity:.7">click ▾</span></div></td>
      <td style="font-size:10px;color:${misColor};font-weight:${misWeight};${cellBg}" ondblclick="window._editMissingEvidence(this,'${tab}','${l.id}')" title="Double-click to edit">${misDisplay}</td>
      <td style="${cellBg}">${levelSelectHtml}</td>
      <td style="text-align:center;${cellBg}"><button class="btn btn-sm btn-primary" style="font-size:10px;padding:2px 8px" onclick="window.openSendPreviewModal('${tab}','${l.id}')">▶ Send</button></td>
      <td style="font-size:10px;color:${le?'var(--primary)':'var(--text-muted)'};white-space:nowrap;${cellBg}">${leStr}</td>
      <td class="ffup-cell" ondblclick="window.makeFollowUpEditable('${l.id}','${tab}')" style="${ffupStyleNI};cursor:pointer;${cellBg}">${ffupCellContentNI}</td>
      <td class="notes-cell" data-notes="${(l.notes||'').replace(/"/g,'&quot;')}" ondblclick="window.openNotesPopup('${tab}','${l.id}')" style="cursor:pointer;max-width:120px;font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${cellBg}">${l.notes||'+ Add note'}</td>
      ${chkCols.map((c,i)=>`<td class="chk-col" style="min-width:${chkWidths[i]};text-align:center;${cellBg}"><input type="checkbox" ${l[c]?'checked':''} onchange="window.toggleLeadCheckbox('${tab}','${l.id}','${c}',this.checked)"></td>`).join('')}
      <td style="font-size:10px;${cellBg}">${gdriveDisplay}</td>
      <td style="font-size:10px;${cellBg}">${eveDisplay}</td>
    </tr>`;
  }catch(err){console.error('Row render error lead',l?.id,err);return'';}}).join('');
  return`<table><thead><tr>
    ${sortTh('assignedDate','Duration')}
    ${sortTh('date','Date')} ${sortTh('name','Name')}
    ${sortTh('phone','Phone')} ${sortTh('email','Email')}
    ${sortTh('temp','Status')} ${sortTh('attorney','Attorney')}
    <th>Evidence</th>${sortTh('_missingCount','Missing')}
    ${sortTh('level','Level')}<th>Send</th>
    ${sortTh('lastEmail','Remarks')} ${sortTh('ffup','Follow-up')} ${sortTh('notes','Notes')}
    ${chkCols.map((c,i)=>`<th class="chk-col" title="Double-click to sort" style="min-width:${chkWidths[i]};text-align:center;font-size:10px" ondblclick="window.sortLeads('${tab}','${c}')">${chkHdrs[i]}</th>`).join('')}
    <th>Drive</th><th>Eve</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
};

window.inlineEdit=function(td,tab,id,field){
  const lead=window.findLeadById(id);if(!lead)return;
  const cur=td.textContent.trim();
  const inp=document.createElement('input');
  inp.className='inline-edit';
  if(field==='assignedDate'){inp.value=lead.assignedDate||'';inp.placeholder='M/D/YY';inp.style.width='90px';}
  else if(field==='date'){inp.value=cur==='—'?'':cur;inp.placeholder='M/D/YY';inp.style.width='100px';}
  else if(field==='ffup'){inp.value=cur==='—'?'':cur;inp.placeholder='M/D';inp.style.width='70px';}
  else{inp.value=cur==='—'?'':cur;}
  td.innerHTML='';td.appendChild(inp);inp.focus();inp.select();
  const save=async()=>{
    let val=inp.value.trim();
    if((field==='date'||field==='assignedDate')&&val){
      val=window.normalizeDate(val);
      if(!/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(val)){
        if(field==='assignedDate'){td.textContent=window._computeDuration(lead.assignedDate)||'—';}
        else{td.textContent=cur;}
        window.showSuccess('Invalid Date','Use M/D/YY');return;
      }
    }else if(field==='ffup'&&val){
      val=window.normalizeFFUP(val);
      if(!/^\d{1,2}\/\d{1,2}$/.test(val)){td.textContent=cur;window.showSuccess('Invalid Date','Use M/D');return;}
    }
    if(field==='assignedDate'){lead.assignedDate=val;td.textContent=window._computeDuration(val)||'—';}
    else{td.textContent=val||'—';}
    lead[field]=val;
    window.sanitizeLeadDates(lead);
    try{await window.apiWithRetry({action:'updateLead',tab,lead:JSON.stringify(lead)});window._refreshTodaysFocusIfOpen();}catch(e){}
  };
  inp.onblur=save;
  inp.onkeydown=e=>{
    if(e.key==='Enter')inp.blur();
    if(e.key==='Escape'){
      if(field==='assignedDate'){td.textContent=window._computeDuration(lead.assignedDate)||'—';}
      else{td.textContent=cur;}
    }
  };
};

window.updateEmailBadge=function(){};

// ── Duration helper: computes human-readable age from a stored M/D/YY date ──
window._computeDuration=function(dateStr){
  if(!dateStr)return'';
  const parts=String(dateStr).split('/');
  if(parts.length<3)return'';
  const y=parseInt(parts[2]);const m=parseInt(parts[0])-1;const d=parseInt(parts[1]);
  const fullYear=y<100?(y<50?2000+y:1900+y):y;
  const then=new Date(fullYear,m,d);
  if(isNaN(then.getTime()))return'';
  const now=new Date();
  // Use only date part for accurate day counting
  const nowDate=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const thenDate=new Date(fullYear,m,d);
  let totalDays=Math.floor((nowDate-thenDate)/(1000*60*60*24));
  if(totalDays<0)totalDays=0;
  const yrs=Math.floor(totalDays/365);
  const mo=Math.floor((totalDays%365)/30);
  const dy=totalDays%30;
  if(yrs>0&&mo>0)return`${yrs}yr ${mo}mo`;
  if(yrs>0)return`${yrs}yr`;
  if(mo>0&&dy>0)return`${mo}mo ${dy}d`;
  if(mo>0)return`${mo}mo`;
  if(totalDays===1)return`1 day`;
  return`${totalDays} days`;
};

// ── Duration from lead: in PC/O/DBB/Clients the "Date" column IS the assigned date ──
window._durationFromLead=function(lead){
  // Priority: assignedDate (set on move) → date
  const src = lead.assignedDate || lead.date;
  if(!src) return '—';
  // _computeDuration needs M/D/YY — normalizeDate converts any format
  const normalized = window.normalizeDate ? window.normalizeDate(src) : src;
  const result = window._computeDuration(normalized);
  return result || '—';
};

// ── Extract M/D follow-up date from a sentAt email date string ──
// Input examples: "05/14 12:19 PM", "5/14/26 10:41 AM", "2026-05-18T10:41:00Z"
// Output: "5/14" (M/D format matching normalizeFFUP output)
window._ffupFromEmailDate = function(sentAt){
  if(!sentAt) return '';
  const s = String(sentAt).trim();
  // Format "MM/DD HH:MM AM" or "M/DD HH:MM AM" — from formatEmailDate()
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\s/);
  if(m1) return `${parseInt(m1[1])}/${parseInt(m1[2])}`;
  // Format "M/D/YY H:MM AM" — from fmtDateTS()
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/\d{2}/);
  if(m2) return `${parseInt(m2[1])}/${parseInt(m2[2])}`;
  // ISO or any other parseable
  const d = new Date(s);
  if(!isNaN(d)) return `${d.getMonth()+1}/${d.getDate()}`;
  return '';
};


window._editEveLink=function(id,tab){const lead=window.findLeadById(id);if(!lead)return;const newUrl=prompt(`Eve link for ${lead.name}:`,lead.eve||'');if(newUrl===null)return;lead.eve=newUrl.trim();window._patchRowDOM(tab,lead);try{window.apiWithRetry({action:'updateLead',tab,lead:JSON.stringify(lead)});}catch(e){}if(newUrl)window.showSuccess('Eve Link Saved',`Updated for ${lead.name}.`);};

// ── Send Preview Modal ──
window.openSendPreviewModal=function(tab,leadId){
  const lead=window.findLeadById(leadId);if(!lead)return;
  const tmplName=lead.level||'';
  const tpl=(window.state.templates||[]).find(t=>t.name===tmplName);
  document.querySelectorAll('.send-preview-overlay').forEach(x=>x.remove());
  const ov=document.createElement('div');
  ov.className='send-preview-overlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:4000;display:flex;align-items:center;justify-content:center;padding:16px';
  const repl=tpl&&window._buildReplacer?window._buildReplacer(lead):(s=>s);
  const previewSubject=tpl?repl(tpl.subject||''):'';
  const previewBody=tpl?repl(tpl.body||''):'';
  const noTpl=!tpl;
  ov.innerHTML=`<div style="background:var(--card);border-radius:10px;padding:22px;max-width:620px;width:100%;box-shadow:0 12px 40px var(--shadow-lg);display:flex;flex-direction:column;max-height:88vh">
    <div style="font-size:14px;font-weight:700;color:var(--primary);margin-bottom:12px">📧 Send Preview — ${lead.name}</div>
    ${noTpl?`<div style="color:var(--danger-text);font-size:12px;margin-bottom:12px">⚠️ No template selected in the <strong>Level</strong> column for this lead. Please select one first.</div>`:''}
    <div style="margin-bottom:8px">
      <label style="font-size:11px;font-weight:600;display:block;margin-bottom:3px">Subject</label>
      <input id="spm-subject" value="${(previewSubject||'').replace(/"/g,'&quot;')}" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:5px;font-size:12px;background:var(--card);color:var(--text)" ${noTpl?'disabled':''}>
    </div>
    <div style="margin-bottom:12px;flex:1;min-height:0;display:flex;flex-direction:column">
      <label style="font-size:11px;font-weight:600;display:block;margin-bottom:3px">Body (read-only preview)</label>
      <div id="spm-preview" style="flex:1;min-height:120px;max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:5px;padding:10px;font-size:12px;background:var(--bg);color:var(--text)">${previewBody||'<span style="color:var(--text-muted)">— no template selected —</span>'}</div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
      <button class="btn btn-outline btn-sm" onclick="document.querySelector('.send-preview-overlay').remove()">Cancel</button>
      <button class="btn btn-outline btn-sm" id="spm-copy-btn" onclick="window._copySendPreviewText()" ${noTpl?'disabled':''}>📋 Copy</button>
      <button class="btn btn-outline btn-sm" onclick="window._openCustomSend('${tab}','${leadId}')" ${noTpl?'disabled':''}>✏️ Custom Send</button>
      <button class="btn btn-primary btn-sm" onclick="window._quickSendFromPreview('${tab}','${leadId}')" ${noTpl?'disabled':''}>✉️ Send</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
};

// ── Copy Send Preview plain text ─────────────────────────────
window._copySendPreviewText = function() {
  const preview = document.getElementById('spm-preview');
  const subject = document.getElementById('spm-subject');
  if (!preview) return;

  // Convert the rendered HTML to clean plain text by parsing it
  // in a temporary element and using innerText (browser-rendered
  // newlines), then trimming stray blank lines.
  const tmp = document.createElement('div');
  tmp.innerHTML = preview.innerHTML;
  // Replace <br> and block-level tags with newlines before innerText
  // strips them, so spacing is preserved correctly.
  tmp.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  tmp.querySelectorAll('p, div, li').forEach(el => {
    el.insertAdjacentText('afterend', '\n');
  });
  let bodyText = (tmp.innerText || tmp.textContent || '')
    .replace(/\n{3,}/g, '\n\n')  // collapse 3+ blank lines to 2
    .trim();

  const fullText = bodyText;

  navigator.clipboard.writeText(fullText).then(() => {
    const btn = document.getElementById('spm-copy-btn');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✅ Copied!';
      btn.disabled = true;
      setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 2000);
    }
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = fullText;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    const btn = document.getElementById('spm-copy-btn');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✅ Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }
  });
};

// ────────────────────────────────────────────────────────────
// Shared N-Day Notice handler — used by every send path so the
// red row alert is correctly applied OR cancelled regardless of
// which send button the user clicked.
// ────────────────────────────────────────────────────────────
// ── Template → EOD text mapping ──────────────────────────────
// Returns the EOD entry text for a given template name + lead name.
// Returns null if the template isn't in the known list (will fall
// back to a generic "Emailed {name}" entry).
window._eodTextFromTemplate = function(templateName, leadName) {
  const n  = (templateName || '').trim();
  const nl = n.toLowerCase();
  const name = (leadName || '').trim();

  // 5-Day / 7-Day / N-Day Notice
  const dayNoticeMatch = n.match(/(\d{1,3})\s*[-_ ]?\s*day(?:s)?\s*[-_ ]?\s*notice/i);
  if (dayNoticeMatch) return `${dayNoticeMatch[1]}-day notice sent to ${name}`;

  // For Review
  if (/for[\s\-_]?review/i.test(nl)) return `Initiated case review of ${name}`;

  // Dropped variants
  if (/^dropped\s*$|^dropped\s*[-–]\s*unresponsive|^declined\s+by\s+ilya|^declined\s+by\s+alice/i.test(nl))
    return `Dropped case of ${name}`;

  // Client awaiting signature
  if (/client.*awaiting\s*signature/i.test(nl))
    return `Followed-up ${name} regarding the retainer`;

  // Client signed retainer
  if (/client.*signed\s*retainer/i.test(nl))
    return `Informed ${name} that the case has been accepted`;

  // Develop weekly reminder
  if (/develop.*weekly\s*reminder/i.test(nl))
    return `Reminded ${name} to develop the case`;

  // Develop inform
  if (/develop.*inform/i.test(nl))
    return `Informed ${name} to develop the case`;

  // Drop request by PC
  if (/drop.*request.*pc|drop.*by.*pc/i.test(nl))
    return `Dropped ${name} per request`;

  // Alice (associate attorney)
  if (/^alice$/i.test(nl))
    return `Informed ${name} that an associate attorney is reviewing the case`;

  // Fallback: generic
  return null;
};

window._applyNDayNoticeAfterSend = function(lead, tab, templateName, subject) {
  const sources = [String(templateName||''), String(subject||'')];
  let nDays = 0;
  for (const src of sources) {
    const m = src.match(/(\d{1,3})\s*[-_ ]?\s*day(?:s)?\s*[-_ ]?\s*notice/i);
    if (m) { nDays = parseInt(m[1], 10); break; }
  }

  // ── Record today's template + log consolidated EOD ──
  // Stores last template name so buildConsolidatedEodText can combine it
  // with any checkbox actions already done today for the same lead.
  const _today = window.todayMDYY ? window.todayMDYY() : '';
  lead._lastTemplateToday = templateName || '';
  lead._lastTemplateDate  = _today;
  // emailChk should reflect "an email went out today"
  lead.emailChk = true;

  if (window.upsertTodaysEodEntry) {
    const consolidatedText = window.buildConsolidatedEodText(lead);
    if (consolidatedText) {
      window.upsertTodaysEodEntry({ leadId: lead.id, leadName: lead.name, tab, newText: consolidatedText });
    }
  }

  // CANCELLATION — non-N-day email sent, lead currently has drop alert → clear it
  if (!nDays) {
    if (lead._dropAlert || lead.rowAlert === 'drop' || lead._dropDate) {
      lead.rowAlert = '';
      lead._dropAlert = false;
      lead._dropDate = '';
      lead.notes = (lead.notes || '')
        .replace(/Drop on\s+\d{1,2}\/\d{1,2}\/\d{2,4}/gi, '')
        .replace(/\d+[\s\-]?day[\s\-]?notice sent/gi, '')
        .split('|').map(s => s.trim()).filter(Boolean).join(' | ');
      if (window._protectField) {
        window._protectField(lead.id, 'rowAlert', 30*60*1000, '');
        window._protectField(lead.id, '_dropDate', 30*60*1000, '');
        window._protectField(lead.id, 'notes', 30*60*1000, lead.notes);
      }
    }
    return;
  }
  if (nDays < 1 || nDays > 365) return;

  // N-Day Notice — turn row red, set drop date
  const dropDate = new Date();
  dropDate.setHours(0,0,0,0);
  dropDate.setDate(dropDate.getDate() + nDays);
  const yy = String(dropDate.getFullYear()).slice(-2);
  const dropStr = `${dropDate.getMonth()+1}/${dropDate.getDate()}/${yy}`;
  lead._dropDate = dropDate.toISOString().slice(0,10);
  lead.rowAlert = 'drop';
  lead._dropAlert = true;
  const cleanedNotes = (lead.notes || '')
    .replace(/Drop on\s+\d{1,2}\/\d{1,2}\/\d{2,4}/gi, '')
    .replace(/Initiated review\s*-\s*[^|]*/gi, '')
    .replace(/\d+[\s\-]?day[\s\-]?notice sent/gi, '')
    .split('|').map(s => s.trim()).filter(Boolean).join(' | ');
  lead.notes = cleanedNotes ? `${cleanedNotes} | Drop on ${dropStr}` : `Drop on ${dropStr}`;
  if (window._protectField) {
    window._protectField(lead.id, 'rowAlert', 30*60*1000, 'drop');
    window._protectField(lead.id, 'notes', 30*60*1000, lead.notes);
    window._protectField(lead.id, '_dropDate', 30*60*1000, lead._dropDate);
  }
  console.log(`📅 ${nDays}-Day Notice → Drop on ${dropStr}`);
};

window._quickSendFromPreview=async function(tab,leadId){
  const lead=window.findLeadById(leadId);if(!lead)return;
  const tpl=(window.state.templates||[]).find(t=>t.name===lead.level);
  if(!tpl){window.showSuccess('No Template','Select a template in the Level column first.');return;}
  if(!lead.email){window.showSuccess('No Email','No email on file.');return;}
  const repl=window._buildReplacer(lead);
  const subject=repl(tpl.subject||'');
  const body=repl(tpl.body||'');
  document.querySelector('.send-preview-overlay')?.remove();
  window.showSuccess('Sending…',`Sending "${tpl.name}" to ${lead.name}`);
  const result=await window.sendGmailDirect(lead.email,subject,body);
  if(!result.sent){window.showSuccess('Send Failed',result.noToken?'Gmail not connected.':(result.error||'Unknown'));return;}
  const entry={id:Date.now(),subject,body,sentAt:window.nowFmt(),status:'Sent',sentBy:window.currentUser?.name||'Jay',sequence:false,templateName:tpl.name};
  if(!window.state.emailHistory[lead.id])window.state.emailHistory[lead.id]=[];
  window.state.emailHistory[lead.id].unshift(entry);
  lead.emailChk=true;
  // ── Apply or cancel N-Day Notice drop alert based on template name ──
  window._applyNDayNoticeAfterSend(lead, tab, tpl.name, subject);
  window.sanitizeLeadDates(lead);
  window._patchRowDOM(tab,lead);
  window._cacheWrite&&window._cacheWrite(tab,lead);
  try{await window.apiWithRetry({action:'updateLead',tab,lead:JSON.stringify(lead)});await window.apiWithRetry({action:'logEmail',leadId:lead.id,entry:JSON.stringify(entry)});}catch(e){}
  window.playNotifSound();
  window.showSuccess('✅ Sent!',`"${tpl.name}" sent to ${lead.name}.`);
};

window._openCustomSend=function(tab,leadId){
  const lead=window.findLeadById(leadId);if(!lead)return;
  const tpl=(window.state.templates||[]).find(t=>t.name===lead.level);
  if(!tpl){window.showSuccess('No Template','Select a template in the Level column first.');return;}
  document.querySelector('.send-preview-overlay')?.remove();
  const repl=window._buildReplacer(lead);
  const previewSubject=repl(tpl.subject||'');
  const previewBody=repl(tpl.body||'');
  const ov=document.createElement('div');
  ov.className='send-preview-overlay';
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:4000;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML=`<div style="background:var(--card);border-radius:10px;padding:22px;max-width:660px;width:100%;box-shadow:0 12px 40px var(--shadow-lg);display:flex;flex-direction:column;max-height:92vh">
    <div style="font-size:14px;font-weight:700;color:var(--primary);margin-bottom:12px">✏️ Custom Send — ${lead.name}</div>
    <div style="margin-bottom:8px">
      <label style="font-size:11px;font-weight:600;display:block;margin-bottom:3px">Subject</label>
      <input id="csm-subject" value="${previewSubject.replace(/"/g,'&quot;')}" style="width:100%;padding:5px 8px;border:1px solid var(--border);border-radius:5px;font-size:12px;background:var(--card);color:var(--text)">
    </div>
    <div style="margin-bottom:12px;flex:1;min-height:0;display:flex;flex-direction:column">
      <label style="font-size:11px;font-weight:600;display:block;margin-bottom:3px">Body (editable)</label>
      <div id="csm-body" contenteditable="true" style="flex:1;min-height:200px;max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:5px;padding:10px;font-size:12px;background:var(--card);color:var(--text);outline:none">${previewBody}</div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
      <button class="btn btn-outline btn-sm" onclick="document.querySelector('.send-preview-overlay').remove()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="window._sendCustomEmail('${tab}','${leadId}')">✉️ Send</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
};

window._sendCustomEmail=async function(tab,leadId){
  const lead=window.findLeadById(leadId);if(!lead)return;
  if(!lead.email){window.showSuccess('No Email','No email on file.');return;}
  const subject=(document.getElementById('csm-subject')?.value||'').trim();
  const body=(document.getElementById('csm-body')?.innerHTML||'').trim();
  if(!subject||!body){window.showSuccess('Required','Subject and body cannot be empty.');return;}
  document.querySelector('.send-preview-overlay')?.remove();
  window.showSuccess('Sending…',`Sending to ${lead.name}`);
  const result=await window.sendGmailDirect(lead.email,subject,body);
  if(!result.sent){window.showSuccess('Send Failed',result.noToken?'Gmail not connected.':(result.error||'Unknown'));return;}
  const entry={id:Date.now(),subject,body,sentAt:window.nowFmt(),status:'Sent',sentBy:window.currentUser?.name||'Jay',sequence:false};
  if(!window.state.emailHistory[lead.id])window.state.emailHistory[lead.id]=[];
  window.state.emailHistory[lead.id].unshift(entry);
  lead.emailChk=true;
  // ── Apply or cancel N-Day Notice based on subject (custom send has no template name) ──
  window._applyNDayNoticeAfterSend(lead, tab, '', subject);
  window.sanitizeLeadDates(lead);
  window._patchRowDOM(tab,lead);
  window._cacheWrite&&window._cacheWrite(tab,lead);
  try{await window.apiWithRetry({action:'updateLead',tab,lead:JSON.stringify(lead)});await window.apiWithRetry({action:'logEmail',leadId:lead.id,entry:JSON.stringify(entry)});}catch(e){}
  window.playNotifSound();
  window.showSuccess('✅ Sent!',`Custom email sent to ${lead.name}.`);
};
window.updateLeadField=async function(tab,id,field,val){const l=window.findLeadById(id);if(!l)return;l[field]=val;window.sanitizeLeadDates(l);window._patchRowDOM(tab,l);try{await window.apiWithRetry({action:'updateLead',tab,lead:JSON.stringify(l)});}catch(e){}window._refreshTodaysFocusIfOpen();};

// ───────────────────────────────────────────────────────────
// LEVEL CHANGE HANDLER
// Routes "✏️ Custom…" selection to the rich-text composer instead of
// saving "__CUSTOM__" as the level. Restores the prior level value
// in the dropdown so it doesn't get visually stuck on Custom.
// ───────────────────────────────────────────────────────────
window._handleLevelChange = function(tab, leadId, selectEl) {
  const val = selectEl.value;
  if (val === '__CUSTOM__') {
    // Revert dropdown to whatever it was before (don't save Custom as level)
    const lead = tab === 'intake'
      ? (window.state.leads.intake||[]).find(l => l.id === leadId)
      : window.findLeadById(leadId);
    selectEl.value = (lead && lead.level) || '';
    // Open the rich-text custom composer
    window.openCustomComposer(tab, leadId);
    return;
  }
  // Normal template selection — save as level
  if (tab === 'intake') {
    window.updateIntakeLeadField(leadId, 'level', val);
  } else {
    window.updateLeadField(tab, leadId, 'level', val);
  }
};

// ───────────────────────────────────────────────────────────
// CUSTOM COMPOSER — rich text editor for one-off emails
// • Full toolbar: Bold / Italic / Underline / Link / Undo / Redo / Bullet / Numbered
// • Enter inserts a new paragraph (native contenteditable behavior)
// • Gmail signature auto-appended on send (handled by sendGmailDirect)
// ───────────────────────────────────────────────────────────
window.openCustomComposer = function(tab, leadId) {
  const lead = tab === 'intake'
    ? (window.state.leads.intake||[]).find(l => l.id === leadId)
    : window.findLeadById(leadId);
  if (!lead) return;
  if (!lead.email) { window.showSuccess('No Email', 'This lead has no email on file.'); return; }

  document.querySelectorAll('.custom-compose-overlay, .send-preview-overlay').forEach(x => x.remove());

  const ov = document.createElement('div');
  ov.className = 'custom-compose-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:4500;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = `
    <div style="background:var(--card);border-radius:10px;padding:20px;max-width:720px;width:100%;box-shadow:0 12px 40px var(--shadow-lg);display:flex;flex-direction:column;max-height:92vh">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--primary)">✏️ Custom Email</div>
          <div style="font-size:11px;color:var(--text-muted)">To: ${lead.name} &lt;${lead.email}&gt;</div>
        </div>
        <div style="font-size:10px;color:var(--text-muted)" id="cc-sig-status">Loading signature…</div>
      </div>

      <div style="margin-bottom:8px">
        <label style="font-size:11px;font-weight:600;display:block;margin-bottom:3px">Subject</label>
        <input id="cc-subject" placeholder="Enter subject line…" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:5px;font-size:12px;background:var(--bg);color:var(--text)">
      </div>

      <div style="margin-bottom:6px">
        <label style="font-size:11px;font-weight:600;display:block;margin-bottom:3px">Body</label>
        <div id="cc-toolbar" style="display:flex;flex-wrap:wrap;gap:3px;padding:5px;border:1px solid var(--border);border-bottom:none;border-radius:5px 5px 0 0;background:var(--bg)">
          <button type="button" class="cc-tb" data-cmd="bold"          title="Bold (Ctrl+B)"      style="font-weight:700">B</button>
          <button type="button" class="cc-tb" data-cmd="italic"        title="Italic (Ctrl+I)"    style="font-style:italic">I</button>
          <button type="button" class="cc-tb" data-cmd="underline"     title="Underline (Ctrl+U)" style="text-decoration:underline">U</button>
          <span class="cc-sep"></span>
          <button type="button" class="cc-tb" data-cmd="insertUnorderedList" title="Bulleted list">• List</button>
          <button type="button" class="cc-tb" data-cmd="insertOrderedList"   title="Numbered list">1. List</button>
          <span class="cc-sep"></span>
          <button type="button" class="cc-tb" data-cmd="createLink"    title="Insert link (Ctrl+K)">🔗 Link</button>
          <button type="button" class="cc-tb" data-cmd="unlink"        title="Remove link">⛓️‍💥</button>
          <span class="cc-sep"></span>
          <button type="button" class="cc-tb" data-cmd="undo"          title="Undo (Ctrl+Z)">↶</button>
          <button type="button" class="cc-tb" data-cmd="redo"          title="Redo (Ctrl+Shift+Z)">↷</button>
          <span class="cc-sep"></span>
          <button type="button" class="cc-tb" data-cmd="removeFormat"  title="Clear formatting">✕ Format</button>
        </div>
        <div id="cc-body" contenteditable="true" style="flex:1;min-height:240px;max-height:380px;overflow-y:auto;border:1px solid var(--border);border-radius:0 0 5px 5px;padding:12px;font-size:13px;background:var(--card);color:var(--text);outline:none;line-height:1.5;font-family:inherit"></div>
        <div id="cc-sig-preview" style="margin-top:6px;padding:8px;background:var(--bg);border:1px dashed var(--border);border-radius:5px;font-size:11px;color:var(--text-muted);display:none">
          <strong style="color:var(--text)">Signature (auto-attached):</strong>
          <div id="cc-sig-content" style="margin-top:4px"></div>
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button class="btn btn-outline btn-sm" onclick="document.querySelector('.custom-compose-overlay').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="window._sendCustomComposed('${tab}','${leadId}')">✉️ Send</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

  // Inject minimal toolbar styling once
  if (!document.getElementById('cc-toolbar-styles')) {
    const st = document.createElement('style');
    st.id = 'cc-toolbar-styles';
    st.textContent = `
      .cc-tb { background:var(--card); color:var(--text); border:1px solid var(--border); border-radius:4px; padding:3px 8px; font-size:11px; cursor:pointer; min-width:26px; transition:background .12s,border-color .12s }
      .cc-tb:hover { background:var(--primary-light); border-color:var(--primary) }
      .cc-tb:active { transform:scale(0.96) }
      .cc-sep { width:1px; background:var(--border); margin:2px 4px; }
      #cc-body p { margin:0 0 10px 0 }
      #cc-body ul, #cc-body ol { margin:6px 0 10px 22px }
      #cc-body a { color:var(--primary); text-decoration:underline }
    `;
    document.head.appendChild(st);
  }

  // Wire toolbar
  ov.querySelectorAll('.cc-tb').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const cmd = btn.dataset.cmd;
      // Keep focus on the editor so commands apply to the right element
      document.getElementById('cc-body').focus();
      if (cmd === 'createLink') {
        const url = prompt('Enter URL:', 'https://');
        if (!url) return;
        document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
    });
  });

  // Keyboard shortcuts inside the editor
  const editor = document.getElementById('cc-body');
  editor.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'k') {
      e.preventDefault();
      const url = prompt('Enter URL:', 'https://');
      if (url) document.execCommand('createLink', false, url);
    }
  });

  // Load signature preview asynchronously
  (async () => {
    try {
      const sig = await window._fetchGmailSignature();
      const statusEl = document.getElementById('cc-sig-status');
      const previewEl = document.getElementById('cc-sig-preview');
      const contentEl = document.getElementById('cc-sig-content');
      if (sig && sig.trim()) {
        if (statusEl) statusEl.textContent = '✓ Gmail signature will be auto-attached';
        if (statusEl) statusEl.style.color = 'var(--success-text)';
        if (previewEl) previewEl.style.display = 'block';
        if (contentEl) contentEl.innerHTML = sig;
      } else {
        if (statusEl) statusEl.textContent = 'No Gmail signature found';
        if (statusEl) statusEl.style.color = 'var(--text-muted)';
      }
    } catch(e) {
      const statusEl = document.getElementById('cc-sig-status');
      if (statusEl) statusEl.textContent = 'Signature unavailable';
    }
  })();

  setTimeout(() => document.getElementById('cc-subject').focus(), 80);
};

window._sendCustomComposed = async function(tab, leadId) {
  const lead = tab === 'intake'
    ? (window.state.leads.intake||[]).find(l => l.id === leadId)
    : window.findLeadById(leadId);
  if (!lead) return;
  const subject = (document.getElementById('cc-subject')?.value || '').trim();
  const body    = (document.getElementById('cc-body')?.innerHTML || '').trim();
  if (!subject) { window.showSuccess('Required', 'Subject line is required.'); return; }
  if (!body || body === '<br>') { window.showSuccess('Required', 'Body cannot be empty.'); return; }

  document.querySelector('.custom-compose-overlay')?.remove();
  window.showSuccess('Sending…', `Sending to ${lead.name}`);

  // sendGmailDirect auto-normalizes the body AND appends the Gmail signature
  const result = await window.sendGmailDirect(lead.email, subject, body);
  if (!result.sent) {
    window.showSuccess('Send Failed', result.noToken ? 'Gmail not connected.' : (result.error || 'Unknown error'));
    return;
  }

  // Log to email history
  const entry = {
    id: Date.now(),
    subject,
    body,
    sentAt: window.nowFmt(),
    status: 'Sent',
    sentBy: window.currentUser?.name || 'Jay',
    sequence: false,
    templateName: 'Custom'
  };
  if (!window.state.emailHistory[lead.id]) window.state.emailHistory[lead.id] = [];
  window.state.emailHistory[lead.id].unshift(entry);

  lead.emailChk = true;
  lead._prevFFUP = lead.ffup || '';
  lead.ffup = window.todayMD();
  if (window.sanitizeLeadDates) window.sanitizeLeadDates(lead);
  window._patchRowDOM(tab, lead);
  if (window._cacheWrite) window._cacheWrite(tab, lead);
  if (window._queueSave) {
    window._queueSave({ action:'updateLead', tab, lead: JSON.stringify(lead) });
    window._queueSave({ action:'logEmail', leadId: lead.id, entry: JSON.stringify(entry) });
  } else {
    try { await window.apiWithRetry({ action:'updateLead', tab, lead: JSON.stringify(lead) }); } catch(e){}
    try { await window.apiWithRetry({ action:'logEmail', leadId: lead.id, entry: JSON.stringify(entry) }); } catch(e){}
  }
  if (window.playNotifSound) window.playNotifSound();
  window.showSuccess('✅ Sent!', `Custom email sent to ${lead.name}.`);
};
// ── Build a consolidated EOD entry for a lead based on today's actions ──
// Combines checkbox actions (Call, VM, Text, Upload) with the mapped phrase
// for the last template sent today (if any). When a template was sent, the
// "Emailed" checkbox is folded into the template phrase rather than listed
// separately — so "Called + Signed Retainer template" becomes:
//   "Called, Informed [name] that the case has been accepted"
// instead of:
//   "Called, Emailed, Informed [name] that the case has been accepted"
window.buildConsolidatedEodText = function(lead) {
  if (!lead) return '';
  const name = lead.name || '';
  // Get today's template (if any). _lastTemplateToday is set by send paths.
  const tpl = lead._lastTemplateToday || '';
  const todayMDYY = window.todayMDYY ? window.todayMDYY() : '';
  // Only honor the template if it was set today
  const tplValid = tpl && (!lead._lastTemplateDate || lead._lastTemplateDate === todayMDYY);
  const tplPhrase = tplValid ? window._eodTextFromTemplate(tpl, name) : null;

  const parts = [];
  if (lead.call)   parts.push('Called');
  if (lead.vm)     parts.push('Left VM');
  if (lead.text)   parts.push('Texted');
  // Only add "Emailed" if no template phrase replaces it
  if (lead.emailChk && !tplPhrase) parts.push('Emailed');
  if (lead.upload) parts.push('Uploaded evidence');

  if (tplPhrase) {
    // Combine: checkbox actions first, then the template phrase.
    // The phrase already includes the lead's name (e.g. "Informed Frank that...").
    if (parts.length) return parts.join(', ') + ', ' + tplPhrase;
    return tplPhrase;
  }

  // No mapped template — fall back to the original checkbox-only format
  if (!parts.length) {
    // No actions at all but a template WAS sent today that wasn't in the map → generic
    if (tplValid) return `Emailed ${name}`;
    return '';
  }
  return parts.join(', ') + ' - ' + name;
};
// Looks up today's REGULAR activity entry for a lead (Call/VM/Email/Text/
// Upload). Channel-created entries are tagged isChannelCreated and
// intentionally ignored here so they can coexist with regular activity
// for the same lead on the same day — the user explicitly wants both
// to appear in EOD Activity History.
window.findTodaysEodEntry=function(leadId){if(!Array.isArray(window.state.eod))return null;const today=window.todayMDYY();for(let i=0;i<window.state.eod.length;i++){const e=window.state.eod[i];if(e.isChannelCreated)continue;if(e.leadId===leadId&&e.time&&e.time.split(' ')[0]===today)return{entry:e,index:i};}return null;};
window.upsertTodaysEodEntry=function({leadId,leadName,tab,newText}){
  if(!Array.isArray(window.state.eod))window.state.eod=[];
  const found=window.findTodaysEodEntry(leadId);
  if(!newText){
    if(found)window.state.eod.splice(found.index,1);
  }else if(found){
    found.entry.text=newText;found.entry.leadName=leadName;found.entry.tab=tab;
  }else{
    window.state.eod.unshift({leadId,leadName,tab,text:newText,time:window.nowFmt()});
    // Prune entries older than 90 days — keeps the buffer bounded
    // without ever dropping current-day activity, no matter how many
    // bulk/scheduled emails go out in one day.
    if (typeof window._pruneOldEodEntries === 'function') window._pruneOldEodEntries();
  }
  try{window.api({action:'saveMeta',eod:JSON.stringify(window.state.eod)});}catch(e){}
  if(document.getElementById('page-eod')?.classList.contains('active'))window.renderEOD();
};

// Drop EOD entries whose date is older than 90 days. Called after each
// insertion to keep the buffer bounded without imposing a count cap that
// could chop off today's activity when many emails are sent.
window._pruneOldEodEntries = function() {
  if (!Array.isArray(window.state.eod) || !window.state.eod.length) return;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  cutoff.setHours(0, 0, 0, 0);
  const entryDate = (s) => {
    if (!s) return null;
    const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})/);
    if (!m) return null;
    return new Date(2000 + parseInt(m[3],10), parseInt(m[1],10)-1, parseInt(m[2],10));
  };
  window.state.eod = window.state.eod.filter(e => {
    const d = entryDate(e && e.time);
    return !d || d >= cutoff;
  });
};

// ── Chase checkbox — debounced, state-guarded to prevent re-mark loop ──
window._chaseDebounce = {};

window.toggleLeadCheckbox=async function(tab,id,field,val){
  const lead=window.findLeadById(id);if(!lead)return;
  const prevFFUP=lead.ffup||'';
  lead[field]=val;
  const anyChecked=lead.call||lead.vm||lead.emailChk||lead.text||lead.upload;
  if(val){lead.ffup=window.todayMD();}else if(!anyChecked){lead.ffup=lead._prevFFUP||prevFFUP||'';}
  if(val)lead._prevFFUP=prevFFUP;
  const eodText=window.buildConsolidatedEodText(lead);
  window.upsertTodaysEodEntry({leadId:id,leadName:lead.name,tab,newText:eodText});
  window.sanitizeLeadDates(lead);
  window._patchRowDOM(tab,lead);
  window._cacheWrite(tab,lead);
  window._refreshTodaysFocusIfOpen();
  window.apiWithRetry({action:'updateLead',tab,lead:JSON.stringify(lead)}).catch(()=>{});
};

window.toggleEvidenceMenu=function(td,tab,id){
  document.querySelectorAll('.evidence-menu').forEach(m=>m.remove());
  const lead=window.findLeadById(id);
  if(!lead)return;
  const menu=document.createElement('div');
  menu.className='evidence-menu';
  const rect=td.getBoundingClientRect();
  const spaceBelow=window.innerHeight-rect.bottom;
  const menuH=Math.min((window.REQUIRED_EVIDENCE||[]).length*40+8,320);
  const top=spaceBelow>menuH?rect.bottom+2:rect.top-menuH-2;
  menu.style.cssText=`position:fixed;top:${top}px;left:${rect.left}px;z-index:9999;min-width:250px;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 24px var(--shadow-lg);padding:4px 0`;

  // Re-render only the buttons inside one row whenever the lead's evidence changes
  const refreshRow = (req, row) => {
    const ev = lead.evidence || {};
    const isCheck = ev[req.opt] === 'check';
    const isX     = ev[req.opt] === 'x';
    const btnCheck = row.querySelector('.ev-btn-check');
    const btnX     = row.querySelector('.ev-btn-x');
    if(btnCheck){
      btnCheck.style.background = isCheck ? 'var(--success)' : 'var(--border)';
      btnCheck.style.color      = isCheck ? '#fff'            : 'var(--text)';
      btnCheck.style.borderColor= isCheck ? 'var(--success)' : 'var(--border)';
    }
    if(btnX){
      btnX.style.background = isX ? 'var(--danger)' : 'var(--border)';
      btnX.style.color      = isX ? '#fff'           : 'var(--text)';
      btnX.style.borderColor= isX ? 'var(--danger)' : 'var(--border)';
    }
  };

  (window.REQUIRED_EVIDENCE||[]).forEach(req=>{
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 12px;font-size:11px;white-space:nowrap';
    const btnCheck=document.createElement('button');
    btnCheck.className='ev-btn-check';
    btnCheck.textContent='✓';
    btnCheck.style.cssText='border:1px solid;border-radius:4px;padding:2px 9px;cursor:pointer;font-size:12px;font-weight:700;flex-shrink:0;transition:background 0.12s,color 0.12s,border-color 0.12s';
    btnCheck.onclick = e => {
      e.stopPropagation();
      window.setEvidence(tab, id, req.opt, 'check', menu);
      refreshRow(req, row); // instant visual update — runs immediately, no network wait
    };
    const btnX=document.createElement('button');
    btnX.className='ev-btn-x';
    btnX.textContent='✗';
    btnX.style.cssText='border:1px solid;border-radius:4px;padding:2px 9px;cursor:pointer;font-size:12px;font-weight:700;flex-shrink:0;transition:background 0.12s,color 0.12s,border-color 0.12s';
    btnX.onclick = e => {
      e.stopPropagation();
      window.setEvidence(tab, id, req.opt, 'x', menu);
      refreshRow(req, row);
    };
    const label=document.createElement('span');
    label.style.cssText='flex:1;color:var(--text)';
    label.innerHTML=`${req.label} <span style="color:var(--text-muted);font-size:10px">(${req.code})</span>`;
    row.appendChild(label);
    row.appendChild(btnCheck);
    row.appendChild(btnX);
    menu.appendChild(row);
    refreshRow(req, row); // initial style
  });
  document.body.appendChild(menu);
  // ESC closes the evidence menu (in addition to click-outside)
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      menu.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
  setTimeout(()=>{
    document.addEventListener('click',function handler(e){
      if(!menu.contains(e.target)&&!td.contains(e.target)){
        menu.remove();
        document.removeEventListener('click',handler);
        document.removeEventListener('keydown', escHandler);
      }
    });
  },0);
};
window.setEvidence = function(tab, id, opt, val, menu) {
  const lead = window.findLeadById(id);
  if (!lead) return;
  if (!lead.evidence) lead.evidence = {};
  // Toggle: if same value already set, clear it; otherwise set it
  lead.evidence[opt] = lead.evidence[opt] === val ? '' : val;
  // 1. Instant UI update — patch the row in the table
  window._patchRowDOM(tab, lead);
  // 2. Instant cache update
  window._cacheWrite(tab, lead);
  // 3. Protect this field from polling for 5 minutes
  if (window._protectField) {
    window._protectField(lead.id, 'evidence', 5 * 60 * 1000, JSON.stringify(lead.evidence));
  }
  // 4. Background save via the same queue used by other writes (non-blocking, batched)
  if (window._queueSave) {
    window._queueSave({ action: 'updateLead', tab, lead: JSON.stringify(lead) });
  } else {
    // Fallback if queue not loaded yet
    window.apiWithRetry({ action: 'updateLead', tab, lead: JSON.stringify(lead) }).catch(() => {});
  }
};

window._showCtxMenuForLead=function(x,y,id,tab){const lead=tab==='intake'?window.state.leads.intake.find(l=>l.id===id):window.findLeadById(id);if(!lead)return;const isPrio=!!lead.prioTomorrow;const menu=document.getElementById('ctxMenu');const allDest=tab==='intake'?window.TABS:window.ALL_TABS.filter(t=>t!==tab);const makeItem=(icon,label,fn,danger)=>{const d=document.createElement('div');d.className='ctx-item'+(danger?' danger':'');d.innerHTML=`<span style="margin-right:6px">${icon}</span>${label}`;d.addEventListener('click',()=>{menu.style.display='none';menu.innerHTML='';fn();});return d;};const makeSep=()=>{const s=document.createElement('div');s.style.cssText='height:1px;background:var(--border);margin:4px 0';return s;};const makeMoveItem=()=>{const wrapper=document.createElement('div');wrapper.style.position='relative';wrapper.innerHTML=`<div class="ctx-item" style="display:flex;justify-content:space-between;align-items:center"><span><span style="margin-right:6px">📂</span>Move to</span><span style="font-size:10px;color:var(--text-muted)">▶</span></div>`;const submenu=document.createElement('div');submenu.style.cssText=`position:fixed;background:var(--card);border:1px solid var(--border);border-radius:7px;box-shadow:0 4px 16px var(--shadow-lg);z-index:5001;min-width:130px;padding:4px 0;display:none`;allDest.forEach(dest=>{const item=document.createElement('div');item.className='ctx-item';item.textContent=window.TAB_LABELS[dest]||dest;item.addEventListener('click',()=>{menu.style.display='none';submenu.style.display='none';window.initMove(tab,id,dest);});submenu.appendChild(item);});document.body.appendChild(submenu);wrapper.addEventListener('mouseenter',()=>{const r=wrapper.getBoundingClientRect();submenu.style.top=r.top+'px';submenu.style.left=(r.right+2)+'px';submenu.style.display='block';});wrapper.addEventListener('mouseleave',e=>{if(!submenu.contains(e.relatedTarget))submenu.style.display='none';});submenu.addEventListener('mouseleave',e=>{if(!wrapper.contains(e.relatedTarget))submenu.style.display='none';});document.addEventListener('click',()=>submenu.remove(),{once:true});return wrapper;};
menu.innerHTML='';
menu.appendChild(makeMoveItem());
menu.appendChild(makeSep());
menu.appendChild(makeItem('✉️','Send Email',()=>tab==='intake'?window.openEmailFromIntake(id):window.openEmailModal(tab,id)));
menu.appendChild(makeItem('💬','SMS Generator',()=>window.openSMSGenerator(tab,id)));
menu.appendChild(makeItem('📅','Schedule Email',()=>window.openScheduleEmailModal(tab,id)));
menu.appendChild(makeItem('📜','Show Email History',()=>window.openEmailHistoryModal(tab,id)));
menu.appendChild(makeSep());
if(tab!=='intake'){menu.appendChild(makeItem('🟢','For Review',()=>window.sendQuickTemplate(tab,id,'for review','review')));menu.appendChild(makeItem('🔴','5-Day Notice',()=>window.sendQuickTemplate(tab,id,'5-day','drop')));menu.appendChild(makeSep());}
menu.appendChild(makeItem('⭐',lead.starred?'Remove Prio Today':'Prio Today',()=>window.toggleStarLead(tab,id)));
menu.appendChild(makeItem('❤️',isPrio?'Remove Prio Tomorrow':'Prio Tomorrow',()=>window.togglePrioTomorrow(tab,id)));
menu.appendChild(makeItem(lead.slackChannelCreated?'❌':'🔗',lead.slackChannelCreated?'Remove Slack Channel':'Slack Channel Created',()=>window.toggleSlackChannelCreated(tab,id)));
menu.appendChild(makeSep());
menu.appendChild(makeItem('🎨','Highlight Name',()=>window._showNameHighlightPicker(x,y,tab,id)));
menu.appendChild(makeItem('✏️','Edit Lead',()=>window.openEditLeadModal(tab,id)));
menu.appendChild(makeSep());
menu.appendChild(makeItem('🗑','Delete',()=>tab==='intake'?window.deleteIntakeLead(id):window.deleteLeadFromTab(tab,id),true));
menu.style.left=x+'px';menu.style.top=y+'px';menu.style.display='block';
requestAnimationFrame(()=>{const r=menu.getBoundingClientRect();if(r.right>window.innerWidth)menu.style.left=(x-r.width)+'px';if(r.bottom>window.innerHeight)menu.style.top=(y-r.height)+'px';});
document.addEventListener('click',()=>menu.style.display='none',{once:true});};

window.openBulkEmailModal=function(tab){const leads=(window.state.leads[tab]||[]).filter(l=>l.email);if(!leads.length){window.showSuccess('No Emails','No leads with email addresses.');return;}document.querySelectorAll('.bulk-email-overlay').forEach(x=>x.remove());const ov=document.createElement('div');ov.className='bulk-email-overlay';ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px';ov.innerHTML=`<div style="background:var(--card);border-radius:10px;padding:22px;max-width:520px;width:100%;box-shadow:0 12px 40px var(--shadow-lg);display:flex;flex-direction:column;max-height:85vh"><div style="font-size:14px;font-weight:700;color:var(--primary);margin-bottom:4px">📧 Bulk Email — ${window.TAB_LABELS[tab]||tab}</div><div style="display:flex;gap:6px;margin-bottom:8px;align-items:center"><button class="btn btn-sm btn-outline" onclick="window._bulkSelectAll(true)">Select All</button><button class="btn btn-sm btn-outline" onclick="window._bulkSelectAll(false)">Deselect All</button><span id="bulk-count-badge" style="margin-left:auto;font-size:11px;color:var(--primary);font-weight:600">0 selected</span></div><div style="flex:1;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:4px 8px;margin-bottom:12px;min-height:150px">${leads.map((l,i)=>`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px"><input type="checkbox" id="bulk-lead-${i}" value="${l.id}" checked><label for="bulk-lead-${i}" style="flex:1;font-weight:500">${l.name}</label><span style="color:var(--text-muted);font-size:11px">${l.email}</span></div>`).join('')}</div><div class="form-group" style="margin-bottom:12px"><label style="font-size:11px;font-weight:600">Select Template</label><select id="bulk-tmpl-select" style="width:100%"><option value="">-- Select a template --</option>${window.state.templates.map((t,i)=>`<option value="${i}">${t.name}</option>`).join('')}</select></div><div id="bulk-progress" style="display:none;font-size:11px;color:var(--text-muted);margin-bottom:10px"></div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-outline btn-sm" onclick="document.querySelector('.bulk-email-overlay').remove()">Cancel</button><button class="btn btn-primary btn-sm" id="bulk-send-btn" onclick="window._sendBulkEmail('${tab}')">Send Selected</button></div></div>`;document.body.appendChild(ov);ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});setTimeout(()=>{document.querySelectorAll('.bulk-email-overlay input[type="checkbox"]').forEach(cb=>cb.addEventListener('change',window._updateBulkCount));window._updateBulkCount();},0);};
window._bulkSelectAll=function(state){document.querySelectorAll('.bulk-email-overlay input[type="checkbox"]').forEach(cb=>cb.checked=state);window._updateBulkCount();};
window._updateBulkCount=function(){const count=document.querySelectorAll('.bulk-email-overlay input[type="checkbox"]:checked').length;const badge=document.getElementById('bulk-count-badge');if(badge)badge.textContent=`${count} selected`;};
window._sendBulkEmail=async function(tab){const idx=document.getElementById('bulk-tmpl-select').value;if(idx===''){window.showSuccess('Select Template','Please select a template first.');return;}const t=window.state.templates[parseInt(idx)];if(!t)return;const selectedIds=new Set();document.querySelectorAll('.bulk-email-overlay input[type="checkbox"]:checked').forEach(cb=>selectedIds.add(cb.value));if(selectedIds.size===0){window.showSuccess('No Recipients','Select at least one lead.');return;}const leads=(window.state.leads[tab]||[]).filter(l=>selectedIds.has(l.id)&&l.email);const btn=document.getElementById('bulk-send-btn');const progress=document.getElementById('bulk-progress');btn.disabled=true;btn.textContent='Sending...';progress.style.display='block';let sent=0,failed=0;for(let i=0;i<leads.length;i++){const lead=leads[i];const replace=window._buildReplacer(lead);const subject=replace(t.subject);const body=replace(t.body);progress.textContent=`Sending ${i+1} of ${leads.length}: ${lead.name}...`;const r=await window.sendGmailDirect(lead.email,subject,body);if(r.sent){sent++;const entry={id:Date.now(),subject,sentAt:window.nowFmt(),status:'Sent',sentBy:window.currentUser?.name||'Jay',sequence:false};if(!window.state.emailHistory[lead.id])window.state.emailHistory[lead.id]=[];window.state.emailHistory[lead.id].unshift(entry);try{await window.apiWithRetry({action:'logEmail',leadId:lead.id,entry:JSON.stringify(entry)});}catch(e){}
  // Auto-check the Email checkbox for this lead
  lead.emailChk = true;
  try { await window.apiWithRetry({ action: 'updateLead', tab, lead: JSON.stringify(lead) }); } catch(e) {}
  // Log an EOD entry for this send (real-time activity for bulk emails)
  try {
    if (window.upsertTodaysEodEntry) {
      window.upsertTodaysEodEntry({
        leadId: lead.id,
        leadName: lead.name,
        tab,
        newText: `Email reminder sent to ${lead.name}`
      });
    }
  } catch(e){}
  }else{failed++;}await new Promise(res=>setTimeout(res,1000));}document.querySelector('.bulk-email-overlay')?.remove();window.playNotifSound();window.showSuccess('Bulk Email Done!',`✅ Sent: ${sent} | ❌ Failed: ${failed}`);};

window.intakeSortByColumn=function(col){if(!window.intakeSortState)window.intakeSortState={};if(window.intakeSortState.column===col){if(window.intakeSortState.order==='asc'){window.intakeSortState.order='desc';}else{window.intakeSortState.column=null;window.intakeSortState.order=null;}}else{window.intakeSortState.column=col;window.intakeSortState.order='asc';}window._saveIntakeSortState();window.renderIntakeList();};
window._enableColumnResizing=function(tableWrap){const table=tableWrap.querySelector('table');if(!table)return;let currentTh=null,startX=0,startWidth=0;const resizers=table.querySelectorAll('.resizer');resizers.forEach(resizer=>{resizer.addEventListener('mousedown',(e)=>{e.stopPropagation();currentTh=resizer.parentElement;startX=e.pageX;startWidth=currentTh.offsetWidth;document.addEventListener('mousemove',hMM);document.addEventListener('mouseup',hMU);e.preventDefault();});});function hMM(e){if(!currentTh)return;const nw=Math.max(50,startWidth+(e.pageX-startX));currentTh.style.width=nw+'px';currentTh.style.minWidth=nw+'px';}function hMU(){currentTh=null;document.removeEventListener('mousemove',hMM);document.removeEventListener('mouseup',hMU);}};

window.toggleStarLead=async function(tab,id){
  const lead=tab==='intake'?(window.state.leads.intake||[]).find(l=>l.id===id):window.findLeadById(id);
  if(!lead)return;
  // Explicit boolean — avoid any truthy/falsy weirdness from sheet round-trips
  lead.starred = !lead.starred;
  lead.starred = lead.starred ? true : false;
  window.sanitizeLeadDates(lead);
  window._patchRowDOM(tab,lead);
  if(tab==='intake')window.renderIntakeList();else window.renderLeadsTab(tab);
  window.playNotifSound();
  window.showSuccess(lead.starred?'⭐ Prio Today!':'Removed',`${lead.name} ${lead.starred?'marked':'removed'}.`);
  // Protect the local value for 15 minutes — survives multiple polling cycles
  // even if the sheet returns stale data back. Polls auto-stop overriding after this expires.
  window._protectField(lead.id,'starred', 15 * 60 * 1000, lead.starred);
  window._pendingSaves.add(lead.id);
  const p={action:'updateLead',tab,lead:JSON.stringify(lead)};
  try{
    window._queueSave(p);
    await window._flushNow();
  }catch(e){
    // Retry on failure
    setTimeout(async()=>{try{window._queueSave(p);await window._flushNow();}catch(e2){}},1500);
  }finally{
    window._pendingSaves.delete(lead.id);
  }
  window._refreshTodaysFocusIfOpen();
};

// ── Slack Channel Created — toggle flag + log to EOD section 2 ──
// Right-click a lead → "Slack Channel Created" / "Remove Slack Channel".
// Flagged leads show up under "2. Priority Tasks Completed" in the EOD
// report, scoped to today (so yesterday's flags don't leak through).
// Also adds/removes an entry in the EOD Activity History (state.eod) so
// the toggle is visible in real-time on the EOD page.
window.toggleSlackChannelCreated = async function(tab, id) {
  const lead = tab === 'intake'
    ? (window.state.leads.intake || []).find(l => l.id === id)
    : window.findLeadById(id);
  if (!lead) return;

  const nowFlag = !lead.slackChannelCreated;
  lead.slackChannelCreated = nowFlag;
  if (nowFlag) {
    // Stamp it with current time so we can scope to today in EOD
    lead.slackChannelCreatedAt = (typeof window.nowFmt === 'function')
      ? window.nowFmt()
      : new Date().toLocaleString();
  } else {
    lead.slackChannelCreatedAt = '';
  }

  // ── Mirror the toggle into the EOD Activity History list (state.eod)
  //    so the EOD page shows it in real-time without waiting for a
  //    "Generate EOD" click. We use a dedicated upsert/remove path
  //    instead of upsertTodaysEodEntry() so this entry coexists with
  //    any normal Call/Email/Text entry that may already exist for the
  //    same lead today.
  if (!Array.isArray(window.state.eod)) window.state.eod = [];
  const today = window.todayMDYY();
  // Find today's channel-created entry for this lead, if any
  const existingIdx = window.state.eod.findIndex(e =>
    e && e.leadId === id && e.isChannelCreated === true
    && e.time && e.time.split(' ')[0] === today
  );
  if (nowFlag) {
    const newEntry = {
      leadId: id,
      leadName: lead.name || 'Unknown',
      tab,
      text: `🔗 Slack channel created — ${lead.name || 'Unknown'}`,
      time: window.nowFmt(),
      isChannelCreated: true   // marker so EOD §1 can filter it out
    };
    if (existingIdx >= 0) {
      window.state.eod[existingIdx] = newEntry;
    } else {
      window.state.eod.unshift(newEntry);
      if (typeof window._pruneOldEodEntries === 'function') window._pruneOldEodEntries();
    }
  } else if (existingIdx >= 0) {
    // Untoggle → remove today's channel-created entry for this lead
    window.state.eod.splice(existingIdx, 1);
  }
  // Persist + refresh the EOD page. Render unconditionally — it's cheap,
  // and ensures the entry is in the DOM the moment the user navigates
  // to the EOD page (no waiting for showPage() to re-render).
  try { window.api({ action: 'saveMeta', eod: JSON.stringify(window.state.eod) }); } catch (e) {}
  if (typeof window.renderEOD === 'function') {
    try { window.renderEOD(); } catch (e) {}
  }

  window.sanitizeLeadDates(lead);
  window._patchRowDOM(tab, lead);
  if (tab === 'intake') window.renderIntakeList(); else window.renderLeadsTab(tab);
  window.playNotifSound();
  window.showSuccess(
    nowFlag ? '🔗 Slack Channel Created' : 'Removed',
    `${lead.name} ${nowFlag ? 'logged — appears in EOD Activity & §2.' : 'unmarked.'}`
  );

  // Protect the local toggle from being overwritten by polls for 15 min
  window._protectField(lead.id, 'slackChannelCreated',  15 * 60 * 1000, lead.slackChannelCreated);
  window._protectField(lead.id, 'slackChannelCreatedAt', 15 * 60 * 1000, lead.slackChannelCreatedAt);

  // Live-refresh the EOD preview if the modal is open
  if (typeof window.updateEODPreview === 'function'
      && document.getElementById('modalGenerateEOD')?.classList.contains('active')) {
    window.updateEODPreview();
  }

  window._pendingSaves.add(lead.id);
  const p = { action: 'updateLead', tab, lead: JSON.stringify(lead) };
  try {
    window._queueSave(p);
    await window._flushNow();
  } catch (e) {
    setTimeout(async () => { try { window._queueSave(p); await window._flushNow(); } catch(e2) {} }, 1500);
  } finally {
    window._pendingSaves.delete(lead.id);
  }
};

// Gmail inbox handlers are defined by gmail.js, which loads before this file.
// Do not replace them with placeholders here: doing so disables inbox polling.
window._protectField=function(leadId,field,durationMs,value){
  if(!window._localOverrides)window._localOverrides={};
  if(!window._localOverrides[leadId])window._localOverrides[leadId]={};
  window._localOverrides[leadId][field]=Date.now()+(durationMs||(window.POLL_INTERVAL_MS||30000)+5000);
  // Persist to localStorage so a full page reload still honors the protection
  try{
    const key = (window.userPrefix?window.userPrefix():'')+'localOverrides';
    localStorage.setItem(key, JSON.stringify(window._localOverrides));
    // Save the actual value too if provided
    if(value !== undefined){
      const vKey = (window.userPrefix?window.userPrefix():'')+'overrideValues';
      let vals = {};
      try{ vals = JSON.parse(localStorage.getItem(vKey)||'{}'); }catch(e){}
      if(!vals[leadId]) vals[leadId] = {};
      vals[leadId][field] = value;
      localStorage.setItem(vKey, JSON.stringify(vals));
    }
  }catch(e){}
};
// Load persisted overrides on init
window._loadPersistedOverrides=function(){
  try{
    const key = (window.userPrefix?window.userPrefix():'')+'localOverrides';
    const raw = localStorage.getItem(key);
    if(!raw) return;
    const data = JSON.parse(raw);
    if(!data || typeof data !== 'object') return;
    const now = Date.now();
    // Prune expired entries
    Object.keys(data).forEach(leadId=>{
      Object.keys(data[leadId]||{}).forEach(field=>{
        if((data[leadId][field]||0) < now) delete data[leadId][field];
      });
      if(!Object.keys(data[leadId]).length) delete data[leadId];
    });
    window._localOverrides = data;
    localStorage.setItem(key, JSON.stringify(data));
  }catch(e){}
};
window._loadPersistedOverrides();
window._editMissingEvidence=function(td,tab,id){
  if(td.querySelector('input'))return;
  const lead=window.findLeadById(id);if(!lead)return;
  const currentText=td.textContent.trim();
  const input=document.createElement('input');
  input.value=(currentText==='✅'||currentText==='—')?'':currentText;
  input.style.cssText='width:100%;border:1px solid var(--primary);border-radius:3px;padding:2px 4px;font-size:10px;outline:none;background:var(--card);color:var(--text)';
  td.textContent='';td.appendChild(input);input.focus();input.select();
  let committed=false;
  const commit = async (newVal) => {
    if(!lead.evidence)lead.evidence={};
    lead.evidence._missingOverride=newVal;
    td.textContent=newVal||'—';
    try{ await window.apiWithRetry({action:'updateLead',tab,lead:JSON.stringify(lead)}); }catch(e){}
    window.showSuccess && window.showSuccess('Saved', 'Missing evidence updated. This text will be used in all templates.');
  };
  const save = async () => {
    if(committed)return;
    const val=input.value.trim();
    // Confirm before overwriting — this value becomes the source-of-truth
    // for {{missing}} / missing-evidence tokens in every template.
    const ok = window.confirm(
      `Save manual missing-evidence entry?\n\n"${val || '(blank)'}"\n\nThis will be used in all templates that reference missing evidence.`
    );
    if (!ok) {
      // Cancelled — restore original
      committed = true;
      td.textContent = currentText;
      return;
    }
    committed=true;
    await commit(val);
  };
  const cancel=()=>{if(committed)return;committed=true;td.textContent=currentText;};
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();save();}
    if(e.key==='Escape'){e.preventDefault();cancel();}
  });
  input.addEventListener('blur',()=>{if(!committed)save();});
};
window.sendQuickTemplate=async function(tab,id,templateKeyword,rowAlertType){const lead=window.findLeadById(id);if(!lead)return;if(!lead.email){window.showSuccess('No Email','No email on file.');return;}const tpl=window.state.templates.find(t=>{const name=t.name.toLowerCase();const kw=templateKeyword.toLowerCase();if(name.includes(kw))return true;if(kw.includes('5')&&/5[\s\-]?day/i.test(name))return true;if(kw.includes('7')&&/7[\s\-]?day/i.test(name))return true;if(kw.includes('review')&&/review/i.test(name))return true;return false;});if(!tpl){window.showSuccess('Template Not Found',`No template matching "${templateKeyword}".`);return;}const replace=window._buildReplacer(lead);const subject=replace(tpl.subject||'');const body=replace(tpl.body||'');window.showSuccess('Sending...',`Sending "${tpl.name}" to ${lead.name}`);const result=await window.sendGmailDirect(lead.email,subject,body);if(!result.sent){window.showSuccess('Send Failed',result.noToken?'Gmail not connected.':(result.error||'Unknown'));return;}const entry={id:Date.now(),subject,body,sentAt:window.nowFmt(),status:'Sent',sentBy:window.currentUser?.name||'Jay',sequence:false,templateName:tpl.name};if(!window.state.emailHistory[lead.id])window.state.emailHistory[lead.id]=[];window.state.emailHistory[lead.id].unshift(entry);lead.emailChk=true;lead._prevFFUP=lead.ffup||'';lead.ffup=window.todayMD();lead.rowAlert=rowAlertType;lead._dropAlert=rowAlertType==='drop';lead._reviewInitiated=rowAlertType==='review';const _todayMDYY=()=>{const n=new Date();return`${n.getMonth()+1}/${n.getDate()}/${String(n.getFullYear()).slice(-2)}`;};let notePrefix;if(rowAlertType==='drop'){const dd=new Date();dd.setDate(dd.getDate()+5);notePrefix=`Drop on ${dd.getMonth()+1}/${dd.getDate()}/${String(dd.getFullYear()).slice(-2)}`;lead._dropDate=dd.toISOString().slice(0,10);}else{notePrefix=`Initiated review - ${_todayMDYY()}`;}let cleanedNotes=(lead.notes||'').replace(/Initiated review\s*-\s*[^|]*/g,'').replace(/Drop on\s+[^|]*/g,'').replace(/\d+[\s\-]?day notice sent/gi,'').split('|').map(s=>s.trim()).filter(Boolean).join(' | ');lead.notes=cleanedNotes?cleanedNotes.trim()+' | '+notePrefix:notePrefix;lead._lastTemplateToday=tpl.name;lead._lastTemplateDate=(window.todayMDYY?window.todayMDYY():'');const eodText=window.buildConsolidatedEodText(lead);if(eodText)window.upsertTodaysEodEntry({leadId:lead.id,leadName:lead.name,tab,newText:eodText});window.sanitizeLeadDates(lead);window._patchRowDOM(tab,lead);window._cacheWrite(tab,lead);window._refreshTodaysFocusIfOpen();try{await window.apiWithRetry({action:'updateLead',tab,lead:JSON.stringify(lead)});await window.apiWithRetry({action:'logEmail',leadId:lead.id,entry:JSON.stringify(entry)});}catch(e){}window.playNotifSound();window.showSuccess('✅ Sent!',`"${tpl.name}" sent to ${lead.name}.`);};
window._checkLeadAlerts=function(){Object.keys(window.state.leads).forEach(tab=>{if(tab==='intake')return;(window.state.leads[tab]||[]).forEach(async lead=>{lead._dropAlert=lead.rowAlert==='drop';lead._reviewInitiated=lead.rowAlert==='review';});});};
window.formatMD=function(date){if(!date||!(date instanceof Date))return'';return`${date.getMonth()+1}/${date.getDate()}`;};

// ===== TEMPLATE PREVIEW POPUP =====
(function(){
  let _tmplPopup = null;
  function _getOrCreatePopup(){
    if(!_tmplPopup){
      _tmplPopup = document.createElement('div');
      _tmplPopup.className = 'tmpl-preview-popup';
      document.body.appendChild(_tmplPopup);
    }
    return _tmplPopup;
  }

  window._showTmplPreview = function(e, tmplName, leadId){
    if(!tmplName) return;
    const tpl = (window.state.templates||[]).find(t=>t.name===tmplName);
    if(!tpl) return;
    const popup = _getOrCreatePopup();

    // Store last selected template name so we can show "Last Selected" badge
    const prevLast = localStorage.getItem('crm_last_tmpl_preview')||'';
    try{ localStorage.setItem('crm_last_tmpl_preview', tmplName); }catch(ex){}
    const isLast = prevLast === tmplName;
    const lastTag = isLast ? '<span class="tp-last-tag">Last Selected</span>' : '';

    // Try to get the lead for replacements + email history
    const lead = leadId ? window.findLeadById(leadId) : null;

    // Check if there's a sent email history for this lead
    const emailHistory = lead ? (window.state.emailHistory?.[lead.id] || []) : [];
    const lastEmail = emailHistory.length ? emailHistory[0] : null;

    let headerHtml = '';
    let subjectHtml = '';
    let bodyHtml = '';

    if(lastEmail){
      // ── Show the ACTUAL last sent email (real values already in subject/body) ──
      headerHtml = `
        <div class="tp-last-email-badge">📧 Last Email Sent — ${window.formatEmailDate ? window.formatEmailDate(lastEmail.sentAt) : lastEmail.sentAt}</div>
        <div class="tp-name">${lastEmail.templateName || tpl.name}</div>`;
      subjectHtml = `<div class="tp-subject">Subject: ${lastEmail.subject || '—'}</div>`;
      // lastEmail.body may or may not exist depending on whether it was stored
      // If body was stored, use it. Otherwise apply replacer to the template body.
      let bodyContent = lastEmail.body || '';
      if(!bodyContent && lead && window._buildReplacer){
        const replace = window._buildReplacer(lead);
        bodyContent = replace(tpl.body||'');
      }
      // Strip HTML tags for plain text preview
      const plainBody = bodyContent.replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,400);
      bodyHtml = `<div class="tp-body">${plainBody}${plainBody.length===400?'…':''}</div>`;
    } else if(lead && window._buildReplacer){
      // ── No email history — show template with ACTUAL lead values substituted ──
      const replace = window._buildReplacer(lead);
      const renderedSubject = replace(tpl.subject||'');
      const renderedBody = replace(tpl.body||'');
      const plainBody = renderedBody.replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,400);
      headerHtml = `<div class="tp-name">${tpl.name}</div>`;
      subjectHtml = `<div class="tp-subject">Subject: ${renderedSubject}</div>`;
      bodyHtml = `<div class="tp-body">${plainBody}${plainBody.length===400?'…':''}</div>`;
    } else {
      // ── Fallback — no lead context, show raw template ──
      const plainBody = (tpl.body||'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,400);
      headerHtml = `<div class="tp-name">${tpl.name}</div>`;
      subjectHtml = `<div class="tp-subject">Subject: ${tpl.subject||'—'}</div>`;
      bodyHtml = `<div class="tp-body">${plainBody}${plainBody.length===400?'…':''}</div>`;
    }

    popup.innerHTML = `${lastTag}${headerHtml}${subjectHtml}${bodyHtml}`;

    // Position popup at actual mouse coordinates (not the element's bounding box)
    // Use e.clientX/Y if event has them, otherwise fall back to element rect
    const mx = (typeof e.clientX === 'number') ? e.clientX : 0;
    const my = (typeof e.clientY === 'number') ? e.clientY : 0;
    const POPUP_W = 340, POPUP_H = 240, OFFSET = 14;
    let left = mx + OFFSET;
    let top  = my + OFFSET;
    // Flip to left of cursor if would go off right edge
    if (left + POPUP_W > window.innerWidth)  left = Math.max(8, mx - POPUP_W - OFFSET);
    // Flip up if would go off bottom edge
    if (top  + POPUP_H > window.innerHeight) top  = Math.max(8, my - POPUP_H - OFFSET);
    popup.style.left = left + 'px';
    popup.style.top  = top + 'px';
    popup.classList.add('visible');
  };

  window._hideTmplPreview = function(){
    if(_tmplPopup) _tmplPopup.classList.remove('visible');
  };

  // Hook template name cells in the Templates page + track mouse for live positioning
  document.addEventListener('mouseover', function(e){
    const tmplName = e.target.closest('.template-name, .template-item');
    if(tmplName){
      const item = tmplName.closest('.template-item');
      if(item){
        const nameEl = item.querySelector('.template-name');
        const name = (nameEl ? nameEl.textContent : '').trim();
        window._showTmplPreview(e, name, null);
      }
    }
  });
  document.addEventListener('mousemove', function(e){
    if(!_tmplPopup || !_tmplPopup.classList.contains('visible')) return;
    const overTmpl = e.target.closest('.template-name, .template-item') || (e.target.tagName==='SELECT' && e.target.value);
    if(!overTmpl) return;
    const POPUP_W = 340, POPUP_H = 240, OFFSET = 14;
    let left = e.clientX + OFFSET;
    let top  = e.clientY + OFFSET;
    if (left + POPUP_W > window.innerWidth)  left = Math.max(8, e.clientX - POPUP_W - OFFSET);
    if (top  + POPUP_H > window.innerHeight) top  = Math.max(8, e.clientY - POPUP_H - OFFSET);
    _tmplPopup.style.left = left + 'px';
    _tmplPopup.style.top  = top + 'px';
  });
  document.addEventListener('mouseout', function(e){
    if(e.target.closest('.template-name, .template-item')) window._hideTmplPreview();
  });
})();

// ===== EMAIL HOVER TOOLTIP (Intake — "Email" button in Actions) =====
(function(){
  let _emailTip = null;
  function _getOrCreateTip(){
    if(!_emailTip){
      _emailTip = document.createElement('div');
      _emailTip.className = 'email-hover-tooltip';
      document.body.appendChild(_emailTip);
    }
    return _emailTip;
  }
  document.addEventListener('mouseover', function(e){
    const btn = e.target.closest('[data-action="email"][data-id]');
    if(!btn) return;
    const id = decodeURIComponent(btn.dataset.id);
    const le = window.getLastEmail(id);
    const tip = _getOrCreateTip();
    if(le){
      tip.innerHTML = `<div class="tip-date">Last sent: ${window.formatEmailDate(le.sentAt)}</div><div class="tip-subject">${le.subject||'(no subject)'}</div>`;
    } else {
      tip.innerHTML = `<div class="tip-none">No email sent yet</div>`;
    }
    const rect = btn.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 6;
    if(left + 290 > window.innerWidth) left = window.innerWidth - 298;
    if(top + 70 > window.innerHeight) top = rect.top - 68;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.classList.add('visible');
  });
  document.addEventListener('mouseout', function(e){
    if(e.target.closest('[data-action="email"][data-id]')){
      if(_emailTip) _emailTip.classList.remove('visible');
    }
  });
})();

// ===== GOOGLE SHEETS KEYBOARD NAVIGATION =====
(function(){
  let _selTd = null;

  function _allTds(wrap){
    return Array.from(wrap.querySelectorAll('tbody tr:not([style*="display:none"]) td:not([style*="display:none"])'));
  }
  function _getGrid(wrap){
    const rows = Array.from(wrap.querySelectorAll('tbody tr:not([style*="display:none"])'));
    return rows.map(r => Array.from(r.querySelectorAll('td:not([style*="display:none"])')));
  }
  function _selectTd(td, wrap){
    if(_selTd) _selTd.classList.remove('gs-selected');
    _selTd = td;
    if(td){
      td.classList.add('gs-selected');
      td.scrollIntoView({block:'nearest',inline:'nearest'});
    }
  }
  function _findPos(grid, td){
    for(let r=0;r<grid.length;r++)
      for(let c=0;c<grid[r].length;c++)
        if(grid[r][c]===td) return {r,c};
    return null;
  }

  document.addEventListener('click', function(e){
    const td = e.target.closest('td');
    if(!td) return;
    const wrap = td.closest('.table-wrap');
    if(!wrap) return;
    _selectTd(td, wrap);
    wrap._gs_wrap = true;
  });

  document.addEventListener('keydown', function(e){
    if(!_selTd) return;
    const wrap = _selTd.closest('.table-wrap');
    if(!wrap) return;
    // Don't intercept when user is typing in an input/select/textarea or contenteditable
    if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT'||e.target.tagName==='TEXTAREA') return;
    if(e.target.isContentEditable || e.target.closest('[contenteditable="true"]')) return;
    // Don't intercept when a modal/overlay is open above the table
    if(document.querySelector('.send-preview-overlay, .bulk-email-overlay, .sms-gen-overlay, .modal-overlay.active')) return;

    const grid = _getGrid(wrap);
    const pos = _findPos(grid, _selTd);
    if(!pos) return;
    let {r,c} = pos;

    switch(e.key){
      case 'ArrowDown':
        e.preventDefault();
        if(r+1 < grid.length && grid[r+1][c]) _selectTd(grid[r+1][c], wrap);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if(r-1 >= 0 && grid[r-1][c]) _selectTd(grid[r-1][c], wrap);
        break;
      case 'ArrowRight':
        e.preventDefault();
        // Stop at end of row — do NOT wrap to next row
        if(grid[r][c+1]) _selectTd(grid[r][c+1], wrap);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        // Stop at start of row — do NOT wrap to previous row
        if(grid[r][c-1]) _selectTd(grid[r][c-1], wrap);
        break;
      case 'Tab':
        e.preventDefault();
        if(e.shiftKey){
          if(grid[r][c-1]) _selectTd(grid[r][c-1], wrap);
          else if(r-1 >= 0 && grid[r-1].length) _selectTd(grid[r-1][grid[r-1].length-1], wrap);
        } else {
          if(grid[r][c+1]) _selectTd(grid[r][c+1], wrap);
          else if(r+1 < grid.length) _selectTd(grid[r+1][0], wrap);
        }
        break;
      case 'Enter':
        // If the selected cell contains a checkbox, Enter toggles it
        // (Google Sheets parity). Otherwise, fall through to triggering
        // dblclick so inline editing still works on text cells.
        e.preventDefault();
        {
          const cb = _selTd.querySelector('input[type="checkbox"]');
          if (cb && !cb.disabled) {
            cb.click(); // fires the existing onchange → toggleLeadCheckbox
          } else {
            _selTd.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
          }
        }
        break;
      case ' ':
      case 'Spacebar': // legacy IE/Edge
        // Space toggles a checkbox if the selected cell contains one.
        // Otherwise we eat the keystroke so the page doesn't scroll while
        // the user is navigating with arrows.
        {
          const cb = _selTd.querySelector('input[type="checkbox"]');
          if (cb && !cb.disabled) {
            e.preventDefault();
            cb.click();
          } else {
            // Cell has no checkbox — let space scroll/behave normally
          }
        }
        break;
      case 'Home':
        e.preventDefault();
        if(e.ctrlKey||e.metaKey){ if(grid[0]&&grid[0][0]) _selectTd(grid[0][0], wrap); }
        else { if(grid[r][0]) _selectTd(grid[r][0], wrap); }
        break;
      case 'End':
        e.preventDefault();
        if(e.ctrlKey||e.metaKey){ const lr=grid[grid.length-1]; if(lr&&lr.length) _selectTd(lr[lr.length-1], wrap); }
        else { const row=grid[r]; if(row&&row.length) _selectTd(row[row.length-1], wrap); }
        break;
      case 'PageDown':
        e.preventDefault();
        { const nr=Math.min(r+10, grid.length-1); if(grid[nr]&&grid[nr][c]) _selectTd(grid[nr][c], wrap); }
        break;
      case 'PageUp':
        e.preventDefault();
        { const nr=Math.max(r-10, 0); if(grid[nr]&&grid[nr][c]) _selectTd(grid[nr][c], wrap); }
        break;
      case 'Escape':
        _selectTd(null, wrap);
        _selTd=null;
        break;
    }
  });


// ── Name Highlight (per-lead) ─────────────────────────────────────────────
// Stored in lead.nameHighlight (a CSS color string or '' for none).
// Applied to the NAME cell's background; persists to Google Sheet.

window._showNameHighlightPicker = function(x, y, tab, id) {
  // Close the main ctx menu first
  const ctx = document.getElementById('ctxMenu');
  if (ctx) { ctx.style.display = 'none'; ctx.innerHTML = ''; }

  const COLORS = [
    { label:'None',   value:'',        swatch:'#ffffff', border:'#ccc' },
    { label:'Red',    value:'#f28b82', swatch:'#f28b82' },
    { label:'Orange', value:'#fbbc04', swatch:'#fbbc04' },
    { label:'Yellow', value:'#fff475', swatch:'#fff475' },
    { label:'Green',  value:'#ccff90', swatch:'#ccff90' },
    { label:'Teal',   value:'#a8f0e8', swatch:'#a8f0e8' },
    { label:'Blue',   value:'#aecbfa', swatch:'#aecbfa' },
    { label:'Purple', value:'#d7aefb', swatch:'#d7aefb' },
    { label:'Pink',   value:'#fdcfe8', swatch:'#fdcfe8' },
    { label:'Gray',   value:'#e6e6e6', swatch:'#e6e6e6' },
    { label:'Dark Red',value:'#e06666',swatch:'#e06666' },
    { label:'Dark Green',value:'#6aa84f',swatch:'#6aa84f' },
    { label:'Dark Blue',value:'#6fa8dc',swatch:'#6fa8dc' },
  ];

  const lead = (tab === 'intake')
    ? (window.state.leads.intake || []).find(l => l.id === id)
    : window.findLeadById(id);
  if (!lead) return;
  const current = lead.nameHighlight || '';

  const picker = document.createElement('div');
  picker.id = 'nameHighlightPicker';
  picker.style.cssText = `position:fixed;z-index:6000;background:var(--card);border:1px solid var(--border);
    border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:10px 12px;min-width:180px`;

  const title = document.createElement('div');
  title.textContent = '🎨 Highlight Name';
  title.style.cssText = 'font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:8px;letter-spacing:.4px';
  picker.appendChild(title);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:5px';

  COLORS.forEach(c => {
    const swatch = document.createElement('div');
    swatch.title = c.label;
    swatch.style.cssText = `width:22px;height:22px;border-radius:4px;cursor:pointer;
      background:${c.swatch};border:2px solid ${c.value === current ? '#1e3a5f' : (c.border || 'transparent')};
      box-shadow:0 1px 3px rgba(0,0,0,.15);transition:transform .1s`;
    if (!c.value) {
      // "None" swatch: white with a diagonal red line
      swatch.innerHTML = `<svg width="22" height="22" viewBox="0 0 22 22"><rect width="22" height="22" rx="3" fill="#fff" stroke="#ccc" stroke-width="1.5"/><line x1="4" y1="18" x2="18" y2="4" stroke="#e53e3e" stroke-width="2"/></svg>`;
      swatch.style.background = 'transparent';
      swatch.style.padding = '0';
    }
    swatch.addEventListener('mouseenter', () => swatch.style.transform = 'scale(1.18)');
    swatch.addEventListener('mouseleave', () => swatch.style.transform = 'scale(1)');
    swatch.addEventListener('click', () => {
      picker.remove();
      window._applyNameHighlight(tab, id, c.value);
    });
    grid.appendChild(swatch);
  });

  picker.appendChild(grid);
  document.body.appendChild(picker);

  // Position near click, flip if off-screen
  const pw = 200, ph = 90;
  let px = Math.min(x, window.innerWidth - pw - 8);
  let py = Math.min(y, window.innerHeight - ph - 8);
  picker.style.left = px + 'px';
  picker.style.top  = py + 'px';

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function closePicker(e) {
      if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', closePicker); }
    });
  }, 0);
};

window._applyNameHighlight = async function(tab, id, color) {
  const lead = (tab === 'intake')
    ? (window.state.leads.intake || []).find(l => l.id === id)
    : window.findLeadById(id);
  if (!lead) return;

  lead.nameHighlight = color;

  // Update the name cell DOM immediately (3rd <td>, index 2) without full re-render
  const row = document.getElementById('lead-row-' + id);
  if (row) {
    const nameTd = row.querySelectorAll('td')[2];
    if (nameTd) {
      nameTd.style.background = color || '';
    }
  }

  // Persist to sheet
  try {
    await window.apiWithRetry({ action: 'updateLead', tab, lead: JSON.stringify(lead) });
  } catch(e) {}
};

  // Column hide feature: right-click on header to hide column
  document.addEventListener('contextmenu', function(e){
    const th = e.target.closest('th');
    if(!th) return;
    const wrap = th.closest('.table-wrap');
    if(!wrap) return;
    e.preventDefault();
    const ths = Array.from(th.closest('tr').querySelectorAll('th'));
    const colIdx = ths.indexOf(th);
    if(colIdx < 0) return;
    const menu = document.getElementById('ctxMenu') || document.createElement('div');
    menu.id='ctxMenu';
    menu.className='ctx-menu';
    menu.style.display='block';
    menu.style.left=e.clientX+'px';
    menu.style.top=e.clientY+'px';
    menu.innerHTML=`
      <div class="ctx-item" onclick="window._hideColumn(this,'${wrap.id||''}',${colIdx})">👁 Hide this column</div>
      <div class="ctx-item" onclick="window._showAllColumns('${wrap.id||''}');document.getElementById('ctxMenu').style.display='none'">↩ Show all columns</div>
      <div class="ctx-item" onclick="document.getElementById('ctxMenu').style.display='none'">Cancel</div>`;
    if(!menu.parentNode) document.body.appendChild(menu);
    document.addEventListener('click', ()=>{ menu.style.display='none'; }, {once:true});
  });

  // ===== Persistent hidden-columns state per table =====
  // Stored as { wrapId: [colIdx, colIdx, ...] } under user-prefixed localStorage key
  window._hiddenColsKey = function(){
    return (window.userPrefix ? window.userPrefix() : '')+'hiddenCols';
  };
  window._loadHiddenCols = function(){
    try {
      const raw = localStorage.getItem(window._hiddenColsKey());
      return raw ? JSON.parse(raw) : {};
    } catch(e){ return {}; }
  };
  window._saveHiddenCols = function(state){
    try { localStorage.setItem(window._hiddenColsKey(), JSON.stringify(state)); } catch(e){}
  };
  window._tableWrapKey = function(wrap){
    // Stable per-tab key — wrap.id varies (intake-table-wrap vs leadtable-wrap-pc),
    // so we use the data-tab on any row to extract the tab name as the key.
    if(!wrap) return null;
    if(wrap.id === 'intake-table-wrap') return 'intake';
    const firstRow = wrap.querySelector('tr[data-tab]');
    if(firstRow) return firstRow.dataset.tab;
    // Fall back to wrap.id (e.g. "leadtable-wrap-pc" → "pc")
    const m = (wrap.id||'').match(/leadtable-wrap-(.+)/);
    return m ? m[1] : (wrap.id || null);
  };

  window._hideColumn = function(menuItem, wrapId, colIdx){
    const wrap = document.getElementById(wrapId) || document.querySelector('.table-wrap');
    if(!wrap) return;
    const table = wrap.querySelector('table');
    if(!table) return;
    table.querySelectorAll('tr').forEach(row=>{
      const cells = row.querySelectorAll('th,td');
      if(cells[colIdx]) cells[colIdx].style.display='none';
    });
    // Persist
    const tabKey = window._tableWrapKey(wrap);
    if(tabKey){
      const state = window._loadHiddenCols();
      if(!state[tabKey]) state[tabKey] = [];
      if(!state[tabKey].includes(colIdx)) state[tabKey].push(colIdx);
      window._saveHiddenCols(state);
    }
    document.getElementById('ctxMenu').style.display='none';
  };

  window._showAllColumns = function(wrapId){
    const wrap = document.getElementById(wrapId) || document.querySelector('.table-wrap');
    if(!wrap) return;
    wrap.querySelectorAll('th,td').forEach(cell=>{ cell.style.display=''; });
    // Clear persisted state for this tab
    const tabKey = window._tableWrapKey(wrap);
    if(tabKey){
      const state = window._loadHiddenCols();
      delete state[tabKey];
      window._saveHiddenCols(state);
    }
  };

  // Re-apply persisted hidden columns on any table render
  window._applyHiddenCols = function(wrap){
    if(!wrap) return;
    const tabKey = window._tableWrapKey(wrap);
    if(!tabKey) return;
    const state = window._loadHiddenCols();
    const hidden = state[tabKey];
    if(!Array.isArray(hidden) || !hidden.length) return;
    const table = wrap.querySelector('table');
    if(!table) return;
    table.querySelectorAll('tr').forEach(row=>{
      const cells = row.querySelectorAll('th,td');
      hidden.forEach(idx=>{
        if(cells[idx]) cells[idx].style.display='none';
      });
    });
  };
})();

// ===== FOLLOW-UP COLUMN: auto-populate from Remarks (date field) when it matches today =====
// When a lead's ffup matches today's date, it shows highlighted.
// makeFollowUpEditable already handles dblclick editing — we just add today-sync logic.
window._syncFollowUpFromRemarks = function(lead){
  // If ffup not set but the Remarks (last email date) is today, default ffup to today
  if(!lead.ffup){
    const le = window.getLastEmail(lead.id);
    if(le){
      const sentDate = window.fmtMD(le.sentAt);
      if(sentDate === window.todayMD()){
        lead.ffup = sentDate;
      }
    }
  }
};

// ===== MANUAL FREEZE COLUMNS & ROWS (Google Sheets style) =====
(function(){

  // Storage: per-table freeze state
  // _freezeState[wrapId] = { cols: N, rows: N }
  window._freezeState = window._freezeState || {};

  function _applyFreeze(wrap){
    const wrapId = wrap.id || '';
    const state = window._freezeState[wrapId] || {cols:0, rows:0};
    const table = wrap.querySelector('table');
    if(!table) return;

    const allRows = Array.from(table.querySelectorAll('tr'));

    allRows.forEach((row, rowIdx) => {
      const cells = Array.from(row.querySelectorAll('th,td'));
      cells.forEach((cell, colIdx) => {
        // Reset first
        cell.style.position = '';
        cell.style.left = '';
        cell.style.top = '';
        cell.style.zIndex = '';
        cell.style.boxShadow = '';
        cell.classList.remove('gs-frozen-col','gs-frozen-row','gs-frozen-corner');

        const isFrozenRow = rowIdx < state.rows; // thead counts as row 0 always
        const isFrozenCol = colIdx < state.cols;

        if(isFrozenCol || isFrozenRow){
          cell.style.position = 'sticky';
          cell.classList.add(isFrozenCol ? 'gs-frozen-col' : '');
          if(isFrozenRow) cell.classList.add('gs-frozen-row');
          if(isFrozenCol && isFrozenRow) cell.classList.add('gs-frozen-corner');
        }
      });
    });

    // Calculate and set left positions for frozen columns
    if(state.cols > 0){
      allRows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('th,td'));
        let leftAccum = 0;
        for(let c = 0; c < Math.min(state.cols, cells.length); c++){
          cells[c].style.left = leftAccum + 'px';
          // zIndex layering (highest stays on top of everything else when scrolling):
          //   frozen header corner: 1500 (top-left, must beat all)
          //   frozen header cells:  1300 (above frozen body + regular header)
          //   frozen body cells:    999  (above regular body)
          const isHeader = row.parentElement?.tagName === 'THEAD';
          if(isHeader){
            // Vertical sticky too — keep frozen header visible when scrolling rows down
            cells[c].style.top = '0px';
            cells[c].style.zIndex = '1300';
          } else {
            cells[c].style.zIndex = '999';
          }
          if(c === state.cols - 1){
            cells[c].style.boxShadow = '2px 0 4px -1px rgba(0,0,0,0.15)';
          }
          leftAccum += cells[c].offsetWidth || 80;
        }
      });
    }

    // Calculate top positions for frozen rows
    if(state.rows > 0){
      const allRowEls = Array.from(table.querySelectorAll('tr'));
      let topAccum = 0;
      for(let r = 0; r < Math.min(state.rows, allRowEls.length); r++){
        const cells = Array.from(allRowEls[r].querySelectorAll('th,td'));
        cells.forEach(cell => {
          if(cell.classList.contains('gs-frozen-row')){
            cell.style.top = topAccum + 'px';
            cell.style.zIndex = cell.classList.contains('gs-frozen-col') ? '320' : '280';
          }
        });
        topAccum += allRowEls[r].offsetHeight || 28;
      }
    }

    // Update the freeze line indicators
    _updateFreezeIndicator(wrap, state);
  }

  function _updateFreezeIndicator(wrap, state){
    // Remove old indicators
    wrap.querySelectorAll('.gs-freeze-line-col,.gs-freeze-line-row').forEach(el=>el.remove());
    // We just rely on the box-shadow on the last frozen column/row cell for visual cue
  }

  function _setFreeze(wrap, cols, rows){
    const wrapId = wrap.id || Math.random().toString(36).slice(2);
    if(!wrap.id) wrap.id = wrapId;
    window._freezeState[wrapId] = {cols: cols||0, rows: rows||0};
    // Save to localStorage per table
    try{ localStorage.setItem('crm_freeze_'+wrapId, JSON.stringify(window._freezeState[wrapId])); }catch(e){}
    _applyFreeze(wrap);
  }

  function _loadFreezeState(wrap){
    if(!wrap.id) return;
    try{
      const saved = localStorage.getItem('crm_freeze_'+wrap.id);
      if(saved){
        window._freezeState[wrap.id] = JSON.parse(saved);
      } else {
        // Default: freeze Duration, Date, Name (first 3 columns) for every lead table.
        // This matches Google Sheets behavior where key identifying columns stay visible
        // when scrolling horizontally. User can override via right-click → freeze.
        window._freezeState[wrap.id] = { cols: 3, rows: 1 };
        try { localStorage.setItem('crm_freeze_'+wrap.id, JSON.stringify(window._freezeState[wrap.id])); } catch(e){}
      }
      _applyFreeze(wrap);
    }catch(e){}
  }

  window._applyFreezeToWrap = function(wrap){
    _loadFreezeState(wrap);
  };

  // Hook into the existing right-click context menu on headers
  const origContextHandler = document.oncontextmenu;
  document.addEventListener('contextmenu', function(e){
    const th = e.target.closest('th');
    if(!th) return;
    const wrap = th.closest('.table-wrap');
    if(!wrap) return;
    // Already being handled — augment the menu that gets built
    // We intercept AFTER the existing handler by using a timeout
    setTimeout(()=>{
      const menu = document.getElementById('ctxMenu');
      if(!menu || menu.style.display==='none') return;
      const ths = Array.from(th.closest('tr').querySelectorAll('th'));
      const colIdx = ths.indexOf(th) + 1; // freeze UP TO AND INCLUDING this column
      const wrapId = wrap.id || '';
      const currentState = window._freezeState[wrapId] || {cols:0, rows:0};

      // Insert freeze items before the last item (Cancel)
      const sep = document.createElement('div');
      sep.style.cssText='height:1px;background:var(--border);margin:4px 0';

      const freezeColItem = document.createElement('div');
      freezeColItem.className = 'ctx-item';
      const isFrozenHere = currentState.cols === colIdx;
      freezeColItem.innerHTML = isFrozenHere
        ? `❄️ Unfreeze columns`
        : `❄️ Freeze up to "<strong>${th.textContent.trim()}</strong>"`;
      freezeColItem.onclick = ()=>{
        menu.style.display='none';
        const newCols = isFrozenHere ? 0 : colIdx;
        _setFreeze(wrap, newCols, currentState.rows);
      };

      const unfreezeAll = document.createElement('div');
      unfreezeAll.className = 'ctx-item';
      unfreezeAll.innerHTML = '✕ Unfreeze all';
      unfreezeAll.onclick = ()=>{
        menu.style.display='none';
        _setFreeze(wrap, 0, 0);
      };

      // Insert before last item
      const items = menu.querySelectorAll('.ctx-item');
      const lastItem = items[items.length-1];
      menu.insertBefore(sep, lastItem);
      menu.insertBefore(freezeColItem, lastItem);
      menu.insertBefore(unfreezeAll, lastItem);
    }, 0);
  }, true); // use capture so it runs before the other contextmenu handler

  // Re-apply freeze whenever a table is re-rendered
  const origRenderLeadTable = window.renderLeadTable;
  if(origRenderLeadTable){
    window.renderLeadTable = function(tab, leads){
      const html = origRenderLeadTable(tab, leads);
      // Apply freeze after DOM updates
      setTimeout(()=>{
        const wrap = document.getElementById('leadtable-wrap-'+tab);
        if(wrap) _loadFreezeState(wrap);
      }, 50);
      return html;
    };
  }

  // Also apply on intake
  const origRenderIntake = window.renderIntakeList;
  if(origRenderIntake){
    window.renderIntakeList = function(){
      origRenderIntake();
      setTimeout(()=>{
        const wrap = document.getElementById('intake-table-wrap');
        if(wrap) _loadFreezeState(wrap);
      }, 50);
    };
  }

})();

// ===== SMS GENERATOR (Gemini-powered, right-click menu) =====
window.openSMSGenerator = function(tab, id){
  const lead = tab==='intake'
    ? (window.state.leads.intake||[]).find(l=>l.id===id)
    : window.findLeadById(id);
  if(!lead){ window.showSuccess('Error','Lead not found.'); return; }

  // Remove any existing
  document.querySelectorAll('.sms-gen-overlay').forEach(x=>x.remove());

  // Lead context for the prompt
  const phoneClean = (lead.phone||'').replace(/\D/g,'');
  const ctx = {
    name: lead.name||'',
    firstName: (lead.name||'').split(/\s+/)[0]||'',
    phone: lead.phone||'',
    email: lead.email||'',
    status: lead.temp||'',
    attorney: lead.attorney||'',
    notes: lead.notes||'',
    followUp: lead.ffup||'',
    tab,
    lastEmail: (window.getLastEmail && window.getLastEmail(lead.id)) ? window.formatEmailDate(window.getLastEmail(lead.id).sentAt) : '—'
  };

  // Built-in defaults (always available); user can extend via Templates tab → SMS Templates
  const defaultPresets = [
    {key:'check_in',  label:'👋 Friendly Check-in', tone:'warm and casual', format:''},
    {key:'follow_up', label:'📞 Follow-up Reminder', tone:'professional and concise', format:''},
    {key:'evidence',  label:'📎 Request Evidence',  tone:'polite and specific about what is missing', format:''},
    {key:'review',    label:'🟢 For Review',        tone:'reassuring, confirming case is moving forward', format:''},
    {key:'urgent',    label:'⚠️ Urgent Response Needed', tone:'firm but professional', format:''}
  ];
  // User-defined templates from Templates tab → SMS Templates
  const userPresets = (window.state.smsTemplates||[]).map((t,i)=>({
    key: 'user_'+i,
    label: '⭐ '+t.name,
    tone: t.tone || 'professional',
    format: t.format || ''
  }));
  const presets = [...userPresets, ...defaultPresets];

  const ov = document.createElement('div');
  ov.className = 'sms-gen-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:4000;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = `
    <div style="background:var(--card);border-radius:10px;padding:20px;max-width:560px;width:100%;box-shadow:0 12px 40px var(--shadow-lg);display:flex;flex-direction:column;max-height:92vh">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <div style="font-size:15px;font-weight:700;color:var(--primary)">💬 SMS Generator</div>
        <span style="font-size:11px;color:var(--text-muted)">— ${lead.name||'(no name)'}</span>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:10px">
        ${phoneClean?`📱 ${lead.phone}`:'⚠️ No phone on file'}
        ${ctx.status?` &nbsp;•&nbsp; ${ctx.status}`:''}
        ${ctx.followUp?` &nbsp;•&nbsp; FFUP: ${ctx.followUp}`:''}
      </div>

      <div style="margin-bottom:10px">
        <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Message type</label>
        <div id="sms-presets" style="display:flex;flex-wrap:wrap;gap:5px">
          ${presets.map((p,i)=>`<button type="button" class="btn btn-sm ${i===0?'btn-primary':'btn-outline'}" data-preset="${p.key}" data-tone="${p.tone}" style="font-size:10px">${p.label}</button>`).join('')}
        </div>
      </div>

      <div style="margin-bottom:10px">
        <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Extra instructions <span style="color:var(--text-muted);font-weight:400">(optional — e.g. "mention his appointment Tuesday")</span></label>
        <textarea id="sms-extra" placeholder="Anything specific to include..." style="width:100%;height:46px;font-size:11px;padding:6px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);resize:vertical;font-family:inherit"></textarea>
      </div>

      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
        <button id="sms-gen-btn" class="btn btn-primary btn-sm" style="font-size:11px">✨ Generate</button>
        <button id="sms-regen-btn" class="btn btn-outline btn-sm" style="font-size:11px;display:none">🔄 Regenerate</button>
        <span id="sms-status" style="font-size:10px;color:var(--text-muted)"></span>
        <span id="sms-char-count" style="font-size:10px;color:var(--text-muted);margin-left:auto">0 chars</span>
      </div>

      <div style="margin-bottom:10px;flex:1;min-height:0;display:flex;flex-direction:column">
        <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Generated SMS <span style="color:var(--text-muted);font-weight:400">(editable)</span></label>
        <textarea id="sms-result" placeholder="Click Generate to draft an SMS using lead details + notes..." style="flex:1;min-height:130px;font-size:12px;padding:10px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);resize:vertical;font-family:inherit;line-height:1.4"></textarea>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center">
        <button class="btn btn-outline btn-sm" onclick="document.querySelector('.sms-gen-overlay').remove()" style="font-size:11px">Cancel</button>
        <button id="sms-copy-btn" class="btn btn-primary btn-sm" style="font-size:11px">📋 Copy SMS</button>
        ${phoneClean?`<button id="sms-open-btn" class="btn btn-outline btn-sm" onclick="window._openSmsInQuo('${phoneClean}')" style="font-size:11px">📱 Open in SMS</button>`:''}
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });

  // Live character counter
  const resultEl = document.getElementById('sms-result');
  const countEl  = document.getElementById('sms-char-count');
  const updateCount = ()=>{
    const n = resultEl.value.length;
    countEl.textContent = `${n} chars · ${Math.ceil(n/160)||1} SMS`;
    countEl.style.color = n>320 ? 'var(--danger-text)' : n>160 ? 'var(--warning-text)' : 'var(--text-muted)';
  };
  resultEl.addEventListener('input', updateCount);
  updateCount();

  // Preset selection
  let selectedPreset = presets[0];
  document.querySelectorAll('#sms-presets [data-preset]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('#sms-presets [data-preset]').forEach(b=>{
        b.classList.remove('btn-primary'); b.classList.add('btn-outline');
      });
      btn.classList.remove('btn-outline'); btn.classList.add('btn-primary');
      selectedPreset = presets.find(p=>p.key===btn.dataset.preset);
    });
  });

  const doGenerate = async ()=>{
    const status = document.getElementById('sms-status');
    const btn    = document.getElementById('sms-gen-btn');
    const reBtn  = document.getElementById('sms-regen-btn');
    const extra  = (document.getElementById('sms-extra').value||'').trim();
    btn.disabled = true; reBtn.disabled = true;
    status.textContent = '✨ Generating with OpenRouter...';

    const result = await window._geminiGenerateSMS(ctx, selectedPreset, extra);
    btn.disabled = false; reBtn.disabled = false;
    if(result.error){
      status.textContent = '❌ '+result.error;
      status.style.color = 'var(--danger-text)';
      return;
    }
    resultEl.value = result.text;
    updateCount();
    status.textContent = '✓ Ready — edit if needed, then copy';
    status.style.color = 'var(--success)';
    btn.style.display='none'; reBtn.style.display='inline-block';
  };

  document.getElementById('sms-gen-btn').addEventListener('click', doGenerate);
  document.getElementById('sms-regen-btn').addEventListener('click', doGenerate);

  document.getElementById('sms-copy-btn').addEventListener('click', async ()=>{
    const txt = resultEl.value.trim();
    if(!txt){ window.showSuccess('Empty','Generate or write an SMS first.'); return; }
    try{
      await navigator.clipboard.writeText(txt);
      const btn = document.getElementById('sms-copy-btn');
      const orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      btn.classList.remove('btn-primary'); btn.classList.add('btn-success');
      setTimeout(()=>{ btn.textContent = orig; btn.classList.remove('btn-success'); btn.classList.add('btn-primary'); }, 1600);
    }catch(err){
      // Fallback for non-clipboard contexts
      resultEl.select(); document.execCommand('copy');
      window.showSuccess('Copied','SMS copied to clipboard.');
    }
  });

  // Auto-generate on open for instant value
  setTimeout(doGenerate, 100);
};

// ===== Open in SMS → Quo =====
// When the user clicks "Open in SMS" in the SMS Generator, we want to:
//  1. Copy the generated SMS to the clipboard (so they can paste in Quo).
//  2. Reuse their existing Quo browser tab if it's already open (via a
//     named window target). If not, open it once and reuse it on every
//     subsequent click — no duplicates, no page reload of the CRM.
//
// Browser limitation: a web page can only refocus a tab that it itself
// opened (or one with the same window name that's still alive). If Quo
// was opened independently in another tab before this feature was used,
// the first click here will open a new Quo tab; from then on, every
// click reuses that same tab.

window._getQuoUrl = function () {
  const stored = (localStorage.getItem('bs_quo_url') || '').trim();
  return stored || 'https://my.quo.com/';
};

window._setQuoUrl = function (url) {
  const v = (url || '').trim();
  if (v && !/^https?:\/\//i.test(v)) {
    window.showSuccess('Invalid URL', 'URL must start with http:// or https://');
    return false;
  }
  if (v) localStorage.setItem('bs_quo_url', v);
  else   localStorage.removeItem('bs_quo_url');
  window.showSuccess('Saved', 'Quo URL updated.');
  return true;
};

window._openSmsInQuo = async function (phoneClean) {
  // 1. Copy SMS text to clipboard so the user can paste it in Quo
  const resultEl = document.getElementById('sms-result');
  const txt = resultEl ? resultEl.value.trim() : '';
  let copied = false;
  if (txt) {
    try {
      await navigator.clipboard.writeText(txt);
      copied = true;
    } catch (err) {
      try {
        resultEl.select();
        copied = document.execCommand('copy');
      } catch (e2) { /* ignore */ }
    }
  }

  // 2. Open or refocus Quo using a fixed window name.
  //    Window name 'bs_quo_sms' is reused across clicks — if a tab with
  //    this name exists, the browser focuses it; otherwise a new tab opens
  //    and gets that name for next time.
  const url = window._getQuoUrl();
  const win = window.open(url, 'bs_quo_sms');
  if (win) {
    try { win.focus(); } catch (e) { /* cross-origin, ignored */ }
  }

  // 3. Feedback toast — tell the user what happened
  if (copied && phoneClean) {
    window.showSuccess(
      '📋 SMS copied + Quo opened',
      `Phone: ${phoneClean} · Paste the message into Quo and send.`
    );
  } else if (copied) {
    window.showSuccess('📋 SMS copied', 'Paste the message into Quo.');
  } else {
    window.showSuccess('Quo opened', 'Switching to your Quo tab.');
  }
};

// OpenRouter API call — returns {text} or {error}
window._geminiGenerateSMS = async function(ctx, preset, extra){
  const key = (window.openrouterKey || window.geminiKey || '').trim();
  if(!key){
    return { error:'No OpenRouter API key. Add one in Settings → AI Key.' };
  }

  const formatBlock = (preset.format||'').trim() ? `

USE THIS EXACT FORMAT AS A TEMPLATE (fill in the placeholders {firstName}, {name}, {phone}, {attorney}, {status}, {notes}, {followUp} with the lead data, and adjust wording to match the tone — do NOT leave any {placeholder} unfilled):
${preset.format}` : '';

  const prompt = `You are drafting a concise SMS text message from a personal injury law firm to a lead/client. Write ONLY the SMS body — no greetings like "Dear", no signatures, no quotes around the message, no preamble like "Here's your SMS:".

CONSTRAINTS:
- Max 320 characters (2 SMS segments)
- Tone: ${preset.tone}
- Use the lead's FIRST NAME naturally if appropriate
- Sound like a real human paralegal/case manager, not a bot
- Do NOT make up facts not in the data below
- Do NOT include "[Your Name]" or placeholder brackets like {something}
- If asking a question, make it easy to answer with a short reply

LEAD DATA:
- Name: ${ctx.name||'(unknown)'}
- First name: ${ctx.firstName||'(unknown)'}
- Status: ${ctx.status||'(none)'}
- Handling attorney: ${ctx.attorney||'(none)'}
- Last email sent: ${ctx.lastEmail}
- Follow-up date: ${ctx.followUp||'(none)'}
- Internal notes from case manager: ${ctx.notes||'(none)'}

MESSAGE TYPE: ${preset.label}${formatBlock}
${extra ? `EXTRA INSTRUCTIONS FROM USER: ${extra}` : ''}

Now write the SMS body (and only the body):`;

  // Model fallback chain — free/cheap models first
  const models = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.1-8b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
    'openai/gpt-4o-mini',
    'anthropic/claude-3.5-haiku'
  ];

  let lastErr = '';
  for(const model of models){
    try{
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Authorization':`Bearer ${key}`,
          'HTTP-Referer': window.location.origin || 'https://crm.local',
          'X-Title':'BS Clients CRM'
        },
        body: JSON.stringify({
          model,
          messages: [{ role:'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 300
        })
      });
      if(res.ok){
        const data = await res.json();
        let text = data?.choices?.[0]?.message?.content || '';
        text = text.trim().replace(/^["'`]+|["'`]+$/g,'').trim();
        if(text) return { text };
        lastErr = 'Empty response from '+model;
        continue;
      }
      const errText = await res.text().catch(()=>'');
      let parsed = '';
      try{ parsed = JSON.parse(errText)?.error?.message || ''; }catch(e){}
      lastErr = `${model}: ${res.status} ${parsed||errText.slice(0,120)}`;
      if(res.status === 401 || res.status === 403){
        return { error:`OpenRouter auth error (${res.status}). Check your API key. ${parsed||''}` };
      }
      if(res.status === 402){
        return { error:'OpenRouter: insufficient credits. Add credits or use a :free model.' };
      }
      // 404/400/429/5xx → try next
    }catch(err){
      lastErr = 'Network: '+(err?.message||err);
    }
  }
  return { error:`All OpenRouter models failed. Last: ${lastErr}` };
};

// ===== EMAIL HISTORY MODAL (right-click → Show Email History) =====
window.openEmailHistoryModal = function(tab, id){
  const lead = tab==='intake'
    ? (window.state.leads.intake||[]).find(l=>l.id===id)
    : window.findLeadById(id);
  if(!lead){ window.showSuccess('Error','Lead not found.'); return; }

  document.querySelectorAll('.email-history-overlay').forEach(x=>x.remove());

  const hist = (window.state.emailHistory && window.state.emailHistory[lead.id]) || [];
  const scheduled = (window.state.scheduled||[]).filter(s => s.leadId === lead.id);

  const histHtml = hist.length ? hist.map(e => `
    <div style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px;background:var(--bg)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;gap:8px">
        <div style="font-weight:600;font-size:12px;flex:1">${(e.subject||'No Subject').replace(/</g,'&lt;')}</div>
        <span style="font-size:10px;color:var(--text-muted);white-space:nowrap">${window.formatEmailDateLong ? window.formatEmailDateLong(e.sentAt) : (e.sentAt||'—')}</span>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">
        ${e.templateName||e.template?`📋 ${e.templateName||e.template}`:''}
        ${e.sentBy?` · by ${e.sentBy}`:''}
        ${e.status?` · ${e.status}`:''}
      </div>
      ${e.body?`<div style="font-size:11px;color:var(--text);max-height:120px;overflow:auto;border-top:1px solid var(--border);padding-top:6px;line-height:1.4">${e.body}</div>`:''}
    </div>
  `).join('') : '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:11px">No emails sent yet.</div>';

  const schedHtml = scheduled.length ? `
    <div style="font-size:11px;font-weight:700;color:var(--warning-text);margin:14px 0 6px">⏳ Scheduled (${scheduled.length})</div>
    ${scheduled.map(s => `
      <div style="border:1px solid var(--warning);border-radius:6px;padding:8px 10px;margin-bottom:6px;background:var(--warning-bg)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="font-weight:600;font-size:11px;flex:1">${(s.subject||'(no subject)').replace(/</g,'&lt;')}</div>
          <span style="font-size:10px;color:var(--warning-text);font-weight:600;white-space:nowrap">${window.formatEmailDateLong ? window.formatEmailDateLong(s.scheduledTime) : new Date(s.scheduledTime).toISOString()}</span>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:3px">📋 ${s.template||'Custom'} · <a href="#" onclick="event.preventDefault();window._cancelScheduledEmail('${s.id}');" style="color:var(--danger-text)">Cancel</a></div>
      </div>
    `).join('')}` : '';

  const ov = document.createElement('div');
  ov.className = 'email-history-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:4000;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = `
    <div style="background:var(--card);border-radius:10px;padding:20px;max-width:600px;width:100%;box-shadow:0 12px 40px var(--shadow-lg);display:flex;flex-direction:column;max-height:88vh">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--primary)">📜 Email History</div>
          <div style="font-size:11px;color:var(--text-muted)">${lead.name||'(no name)'} · ${lead.email||'(no email)'}</div>
        </div>
        <div style="font-size:11px;color:var(--text-muted)">${hist.length} sent${scheduled.length?` · ${scheduled.length} scheduled`:''}</div>
      </div>
      <div style="flex:1;overflow-y:auto;border-top:1px solid var(--border);padding-top:10px">
        ${histHtml}
        ${schedHtml}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn btn-outline btn-sm" onclick="document.querySelector('.email-history-overlay').remove()">Close</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e=>{ if(e.target===ov) ov.remove(); });
};

window._cancelScheduledEmail = async function(schedId){
  if(!confirm('Cancel this scheduled email?')) return;
  window.state.scheduled = (window.state.scheduled||[]).filter(s => s.id !== schedId);
  // Also remove the paired forward-dated EOD entry, if any
  if (Array.isArray(window.state.eod)) {
    window.state.eod = window.state.eod.filter(e => !(e && e.isScheduled && e.scheduledId === schedId));
  }
  try{ await window.api({ action:'saveMeta', scheduled: JSON.stringify(window.state.scheduled), eod: JSON.stringify(window.state.eod||[]) }); }catch(e){}
  // Refresh history modal if still open
  document.querySelectorAll('.email-history-overlay').forEach(x=>x.remove());
  if(window._updateScheduledBadge) window._updateScheduledBadge();
  if(document.getElementById('page-scheduled')?.classList.contains('active')) window.renderScheduledPage();
  if(document.getElementById('page-eod')?.classList.contains('active') && window.renderEOD) window.renderEOD();
  window.showSuccess('Cancelled','Scheduled email removed.');
};

// ===== SCHEDULE EMAIL MODAL (right-click → Schedule Email) =====
window.openScheduleEmailModal = function(tab, id){
  const lead = tab==='intake'
    ? (window.state.leads.intake||[]).find(l=>l.id===id)
    : window.findLeadById(id);
  if(!lead){ window.showSuccess('Error','Lead not found.'); return; }
  if(!lead.email){ window.showSuccess('No Email','This lead has no email on file.'); return; }

  document.querySelectorAll('.schedule-email-overlay').forEach(x=>x.remove());

  const templates = window.state.templates || [];
  // Note: even with zero templates, the user can still pick "Custom".
  // Removed the old "no templates" early return.

  // Default: tomorrow 9:00 AM
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate()+1);
  tomorrow.setHours(9,0,0,0);
  const toLocalDT = (d) => {
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const defaultDT = toLocalDT(tomorrow);

  // Custom-template state lives outside the DOM so it survives re-renders.
  window._schedCustom = { active: false, subject: '', body: '' };
  // Per-row "manual override" dates keyed by row index, so changing the
  // gap doesn't wipe individually-edited rows.
  window._schedManualDates = {};

  const ov = document.createElement('div');
  ov.className = 'schedule-email-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:4000;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = `
    <div style="background:var(--card);border-radius:10px;padding:20px;max-width:680px;width:100%;box-shadow:0 12px 40px var(--shadow-lg);display:flex;flex-direction:column;max-height:90vh">
      <div style="margin-bottom:10px">
        <div style="font-size:15px;font-weight:700;color:var(--primary)">📅 Schedule Emails</div>
        <div style="font-size:11px;color:var(--text-muted)">${lead.name} · ${lead.email}</div>
      </div>

      <div style="margin-bottom:12px">
        <label style="font-size:11px;font-weight:600;display:block;margin-bottom:6px">Pick templates to schedule (one email per template)</label>
        <div id="sched-tpl-list" style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:5px;padding:4px 8px">
          ${templates.map((t,i)=>`
            <label style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:11px;cursor:pointer">
              <input type="checkbox" class="sched-tpl-cb" data-idx="${i}" data-name="${(t.name||'').replace(/"/g,'&quot;')}">
              <span style="flex:1;font-weight:500">${t.name}</span>
              <span style="font-size:10px;color:var(--text-muted)">${(t.subject||'').slice(0,40)}${(t.subject||'').length>40?'…':''}</span>
            </label>`).join('')}
          <label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:11px;cursor:pointer">
            <input type="checkbox" class="sched-tpl-cb" id="sched-custom-cb" data-idx="__CUSTOM__" data-name="Custom">
            <span style="flex:1;font-weight:600;color:var(--primary)">✏️ Custom email…</span>
            <a href="#" id="sched-edit-custom" style="font-size:10px;color:var(--primary);text-decoration:underline">edit</a>
          </label>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">
          <a href="#" onclick="event.preventDefault();document.querySelectorAll('.sched-tpl-cb').forEach(c=>{if(c.id!=='sched-custom-cb')c.checked=true;});window._updateSchedPreview();" style="color:var(--primary)">Select all</a>
          ·
          <a href="#" onclick="event.preventDefault();document.querySelectorAll('.sched-tpl-cb').forEach(c=>c.checked=false);window._schedManualDates={};window._updateSchedPreview();" style="color:var(--primary)">Clear</a>
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:180px">
          <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Start date &amp; time</label>
          <input id="sched-start" type="datetime-local" value="${defaultDT}" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text)">
        </div>
        <div style="width:140px">
          <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">Gap between</label>
          <select id="sched-gap" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text)">
            <option value="0">All at once</option>
            <option value="1">1 day later each</option>
            <option value="3" selected>3 days later each</option>
            <option value="7">1 week later each</option>
            <option value="14">2 weeks later each</option>
            <option value="__CUSTOM__">Custom (# of days)…</option>
          </select>
        </div>
        <div id="sched-gap-custom-wrap" style="width:120px;display:none">
          <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px"># of days</label>
          <input id="sched-gap-custom" type="number" min="0" step="1" value="5" style="width:100%;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text)">
        </div>
      </div>

      <div style="margin-bottom:10px">
        <div style="font-size:11px;font-weight:600;margin-bottom:4px;display:flex;justify-content:space-between">
          <span>📋 Schedule preview <span style="font-weight:400;color:var(--text-muted)">(edit any date to override)</span></span>
          <a href="#" id="sched-reset-dates" style="font-size:10px;color:var(--primary);text-decoration:underline">Reset to gap</a>
        </div>
        <div id="sched-preview" style="border:1px solid var(--border);border-radius:5px;padding:6px 10px;min-height:50px;max-height:200px;overflow-y:auto;font-size:11px;background:var(--bg);color:var(--text-muted)">
          Pick at least one template to see the schedule.
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
        <button class="btn btn-outline btn-sm" onclick="document.querySelector('.schedule-email-overlay').remove()">Cancel</button>
        <button id="sched-confirm-btn" class="btn btn-primary btn-sm">📅 Schedule</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e=>{ if(e.target===ov) ov.remove(); });

  document.querySelectorAll('.sched-tpl-cb').forEach(cb => cb.addEventListener('change', window._updateSchedPreview));
  document.getElementById('sched-start').addEventListener('change', () => {
    // When start changes, wipe per-row overrides so the new base flows down.
    window._schedManualDates = {};
    window._updateSchedPreview();
  });
  document.getElementById('sched-gap').addEventListener('change', (e) => {
    const wrap = document.getElementById('sched-gap-custom-wrap');
    wrap.style.display = e.target.value === '__CUSTOM__' ? '' : 'none';
    window._schedManualDates = {}; // gap change resets per-row edits
    window._updateSchedPreview();
  });
  document.getElementById('sched-gap-custom').addEventListener('input', () => {
    window._schedManualDates = {};
    window._updateSchedPreview();
  });
  document.getElementById('sched-reset-dates').addEventListener('click', e => {
    e.preventDefault();
    window._schedManualDates = {};
    window._updateSchedPreview();
  });

  // Custom-template editor
  document.getElementById('sched-edit-custom').addEventListener('click', e => {
    e.preventDefault();
    window._openCustomTemplateEditor(tab, id);
  });
  document.getElementById('sched-custom-cb').addEventListener('change', e => {
    if (e.target.checked && !window._schedCustom.subject && !window._schedCustom.body) {
      // Auto-open the editor the first time they enable Custom
      window._openCustomTemplateEditor(tab, id);
    }
  });

  document.getElementById('sched-confirm-btn').addEventListener('click', ()=>window._confirmSchedule(tab, id));
};

// Inline editor for the one-off "Custom" template used by Schedule Emails
window._openCustomTemplateEditor = function(tab, id) {
  const lead = window.findLeadById(id) || (window.state.leads.intake||[]).find(l=>l.id===id);
  const replace = window._buildReplacer ? window._buildReplacer(lead) : (s=>s);
  const cur = window._schedCustom || { subject:'', body:'' };

  const ov = document.createElement('div');
  ov.className = 'custom-tpl-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = `
    <div style="background:var(--card);border-radius:10px;padding:20px;max-width:560px;width:100%;box-shadow:0 12px 40px var(--shadow-lg);display:flex;flex-direction:column;max-height:88vh">
      <div style="font-size:15px;font-weight:700;color:var(--primary);margin-bottom:12px">✏️ Custom Email</div>
      <label style="font-size:11px;font-weight:600;margin-bottom:4px">Subject</label>
      <input id="custom-tpl-subject" type="text" value="${(cur.subject||'').replace(/"/g,'&quot;')}" style="width:100%;font-size:12px;padding:7px 9px;border:1px solid var(--border);border-radius:5px;margin-bottom:10px;background:var(--bg);color:var(--text)">
      <label style="font-size:11px;font-weight:600;margin-bottom:4px">Body</label>
      <textarea id="custom-tpl-body" rows="10" style="width:100%;font-size:12px;padding:7px 9px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);font-family:inherit;resize:vertical">${cur.body||''}</textarea>
      <div style="font-size:10px;color:var(--text-muted);margin-top:6px">Tokens like {{name}}, {{firstName}}, {{attorney}} are supported.</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn btn-outline btn-sm" id="custom-tpl-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="custom-tpl-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.getElementById('custom-tpl-cancel').onclick = () => ov.remove();
  document.getElementById('custom-tpl-save').onclick = () => {
    window._schedCustom = {
      active: true,
      subject: document.getElementById('custom-tpl-subject').value || '',
      body:    document.getElementById('custom-tpl-body').value    || ''
    };
    const cb = document.getElementById('sched-custom-cb');
    if (cb) cb.checked = true;
    ov.remove();
    window._updateSchedPreview();
  };
  // Focus subject
  setTimeout(() => document.getElementById('custom-tpl-subject')?.focus(), 50);
};

window._updateSchedPreview = function(){
  const preview = document.getElementById('sched-preview');
  if(!preview) return;
  const checked = Array.from(document.querySelectorAll('.sched-tpl-cb:checked'));
  if(!checked.length){
    preview.innerHTML = '<span style="color:var(--text-muted)">Pick at least one template to see the schedule.</span>';
    return;
  }
  const startVal = document.getElementById('sched-start').value;
  const gapSel = document.getElementById('sched-gap').value || '0';
  const gapDays = gapSel === '__CUSTOM__'
    ? Math.max(0, parseInt(document.getElementById('sched-gap-custom').value || '0', 10) || 0)
    : parseInt(gapSel || '0', 10);
  if(!startVal){ preview.innerHTML = '<span style="color:var(--danger-text)">Pick a start date.</span>'; return; }

  const baseDate = new Date(startVal);
  const toLocal = (d) => {
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  preview.innerHTML = checked.map((cb,i) => {
    const isCustom = cb.dataset.idx === '__CUSTOM__';
    const name = isCustom
      ? `Custom${window._schedCustom?.subject ? ' — ' + window._schedCustom.subject.slice(0,40) : ''}`
      : cb.dataset.name;
    // Manual override wins; otherwise compute from gap
    const computed = new Date(baseDate.getTime() + i * gapDays * 24 * 60 * 60 * 1000);
    const manual = window._schedManualDates?.[i];
    const dtVal = manual || toLocal(computed);
    return `
      <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--primary);font-weight:600;width:18px">${i+1}.</span>
        <span style="flex:1;color:var(--text);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</span>
        <input type="datetime-local" class="sched-row-date" data-idx="${i}" value="${dtVal}" style="font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--text)">
      </div>`;
  }).join('');

  // Wire per-row date inputs so edits persist into _schedManualDates
  preview.querySelectorAll('.sched-row-date').forEach(inp => {
    inp.addEventListener('change', () => {
      const i = inp.dataset.idx;
      if (!window._schedManualDates) window._schedManualDates = {};
      window._schedManualDates[i] = inp.value;
    });
  });
};

window._confirmSchedule = async function(tab, leadId){
  const lead = tab==='intake'
    ? (window.state.leads.intake||[]).find(l=>l.id===leadId)
    : window.findLeadById(leadId);
  if(!lead) return;
  const checked = Array.from(document.querySelectorAll('.sched-tpl-cb:checked'));
  if(!checked.length){ window.showSuccess('Pick Templates','Select at least one template.'); return; }
  const startVal = document.getElementById('sched-start').value;
  if(!startVal){ window.showSuccess('Pick Date','Select a start date and time.'); return; }
  const baseDate = new Date(startVal);
  if(isNaN(baseDate.getTime())){ window.showSuccess('Invalid','Invalid date format.'); return; }
  const gapSel = document.getElementById('sched-gap').value || '0';
  const gapDays = gapSel === '__CUSTOM__'
    ? Math.max(0, parseInt(document.getElementById('sched-gap-custom').value || '0', 10) || 0)
    : parseInt(gapSel || '0', 10);

  // If "Custom" template is checked but never edited, prompt instead of sending empty
  const hasCustom = checked.some(cb => cb.dataset.idx === '__CUSTOM__');
  if (hasCustom && (!window._schedCustom?.subject && !window._schedCustom?.body)) {
    window.showSuccess('Edit Custom', 'Click "edit" next to Custom to set its subject and body.');
    return;
  }

  if(!Array.isArray(window.state.scheduled)) window.state.scheduled = [];
  const replace = window._buildReplacer ? window._buildReplacer(lead) : (s=>s);
  const manual = window._schedManualDates || {};

  const newItems = checked.map((cb,i) => {
    const isCustom = cb.dataset.idx === '__CUSTOM__';
    let subject, body, templateName;
    if (isCustom) {
      templateName = 'Custom';
      subject = replace(window._schedCustom.subject || '');
      body    = replace(window._schedCustom.body    || '');
    } else {
      const idx = parseInt(cb.dataset.idx, 10);
      const tpl = (window.state.templates||[])[idx];
      if(!tpl) return null;
      templateName = tpl.name;
      subject = replace(tpl.subject||'');
      body    = replace(tpl.body||'');
    }
    // Per-row manual date wins; otherwise compute from base+gap
    const sendAt = manual[i]
      ? new Date(manual[i])
      : new Date(baseDate.getTime() + i * gapDays * 24 * 60 * 60 * 1000);
    return {
      id: 'sch_'+Date.now()+'_'+i+'_'+Math.random().toString(36).slice(2,7),
      leadId: lead.id,
      leadName: lead.name||'',
      leadEmail: lead.email||'',
      tab,
      template: templateName,
      templateIndex: isCustom ? -1 : parseInt(cb.dataset.idx, 10),
      isCustom: isCustom,
      subject,
      body,
      scheduledTime: sendAt.toISOString(),
      createdAt: new Date().toISOString(),
      status: 'pending'
    };
  }).filter(Boolean);

  window.state.scheduled.push(...newItems);

  // ── Real-time EOD reflection for scheduled emails ──
  if (!Array.isArray(window.state.eod)) window.state.eod = [];
  newItems.forEach(item => {
    const send = new Date(item.scheduledTime);
    const phDate = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila', year: '2-digit', month: 'numeric', day: 'numeric'
    }).formatToParts(send);
    const mo = phDate.find(p => p.type === 'month')?.value || '';
    const dy = phDate.find(p => p.type === 'day')?.value   || '';
    const yr = phDate.find(p => p.type === 'year')?.value  || '';
    const phTime = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true
    }).format(send).replace(/\s+/g,'');
    window.state.eod.unshift({
      leadId: lead.id,
      leadName: lead.name,
      tab,
      text: `Email reminder sent to ${lead.name}`,
      time: `${mo}/${dy}/${yr} ${phTime}`,
      isScheduled: true,
      scheduledId: item.id
    });
  });
  if (typeof window._pruneOldEodEntries === 'function') window._pruneOldEodEntries();

  try{ await window.api({ action:'saveMeta', scheduled: JSON.stringify(window.state.scheduled), eod: JSON.stringify(window.state.eod) }); }catch(e){}
  if (document.getElementById('page-eod')?.classList.contains('active') && window.renderEOD) window.renderEOD();
  document.querySelector('.schedule-email-overlay')?.remove();
  if(window._updateScheduledBadge) window._updateScheduledBadge();
  if(document.getElementById('page-scheduled')?.classList.contains('active')) window.renderScheduledPage();
  window.playNotifSound && window.playNotifSound();
  window.showSuccess('✅ Scheduled', `${newItems.length} email${newItems.length>1?'s':''} scheduled for ${lead.name}.`);
};

// ===== RENDER SCHEDULED PAGE (was missing) =====
window.renderScheduledPage = function(){
  const el = document.getElementById('scheduledList');
  if(!el) return;
  const items = (window.state.scheduled||[]).slice().sort((a,b)=>new Date(a.scheduledTime)-new Date(b.scheduledTime));
  if(!items.length){
    el.innerHTML = '<div class="empty-state">No scheduled emails. Right-click a lead → "Schedule Email" to set one up.</div>';
    return;
  }
  const now = Date.now();
  el.innerHTML = items.map(s => {
    const t = new Date(s.scheduledTime).getTime();
    const overdue = t < now && s.status === 'pending';
    const sent = s.status === 'sent';
    const color = sent ? 'var(--success)' : overdue ? 'var(--danger)' : 'var(--primary)';
    const badge = sent ? '✅ Sent' : overdue ? '⚠️ Overdue' : '⏳ Pending';
    return `
      <div style="border:1px solid var(--border);border-left:4px solid ${color};border-radius:6px;padding:10px 12px;margin-bottom:8px;background:var(--card);display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
            <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase">${badge}</span>
            <span style="font-size:13px;font-weight:600">${s.leadName||'(no name)'}</span>
            <span style="font-size:11px;color:var(--text-muted)">${s.leadEmail||''}</span>
          </div>
          <div style="font-size:11px;color:var(--text)">📋 ${s.template||'Custom'} — <span style="color:var(--text-muted)">${(s.subject||'').slice(0,80)}</span></div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:3px">Scheduled for ${window.formatEmailDateLong ? window.formatEmailDateLong(s.scheduledTime) : s.scheduledTime}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          ${!sent?`<button class="btn btn-outline btn-sm" onclick="window._cancelScheduledEmail('${s.id}')" style="font-size:10px">Cancel</button>`:''}
        </div>
      </div>`;
  }).join('');
};

window.clearSentScheduled = async function(){
  if(!Array.isArray(window.state.scheduled)) return;
  const before = window.state.scheduled.length;
  window.state.scheduled = window.state.scheduled.filter(s => s.status !== 'sent');
  const cleared = before - window.state.scheduled.length;
  if(!cleared){ window.showSuccess('Nothing to clear','No sent items in the list.'); return; }
  try{ await window.api({ action:'saveMeta', scheduled: JSON.stringify(window.state.scheduled) }); }catch(e){}
  window.renderScheduledPage();
  window.showSuccess('Cleared',`Removed ${cleared} sent item${cleared>1?'s':''}.`);
};

window._updateScheduledBadge = function(){
  const badge = document.getElementById('nb-scheduled');
  if(!badge) return;
  const pending = (window.state.scheduled||[]).filter(s => s.status !== 'sent').length;
  badge.textContent = pending;
};

// ════════════════════════════════════════════════════════════
// COPY-TO-CLIPBOARD on double-click for Phone & Email cells.
// (Auto-dialer via Quo has been removed — phone is copy-only now.)
// Targets any element with class="copy-cell" + data-copy="value" + data-copy-kind="phone|email".
// ════════════════════════════════════════════════════════════
(function(){
  let _clipToastTimer = null;
  const showClipToast = (msg, ok) => {
    document.querySelectorAll('.clip-toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'clip-toast';
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:100px;right:24px;background:${ok===false?'#dc2626':'#16a34a'};color:#fff;padding:9px 16px;border-radius:8px;font-size:12.5px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.18);z-index:99999;opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease;pointer-events:none`;
    document.body.appendChild(t);
    requestAnimationFrame(()=>{ t.style.opacity='1'; t.style.transform='translateY(0)'; });
    if (_clipToastTimer) clearTimeout(_clipToastTimer);
    _clipToastTimer = setTimeout(()=>{
      t.style.opacity='0'; t.style.transform='translateY(8px)';
      setTimeout(()=>t.remove(), 220);
    }, 1500);
  };

  const copyText = async (text) => {
    if (!text) return false;
    // Modern API first (requires secure context)
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch(e) { /* fall through to execCommand */ }
    // Fallback: textarea + execCommand (works on http://localhost too)
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch(e) { return false; }
  };

  // Block single-clicks from doing anything weird on copy-cells
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.copy-cell');
    if (!el) return;
    // Prevent the cell from triggering row-level handlers on a single click
    // (the dblclick handler below does the actual work)
  }, true);

  // Double-click → copy
  document.addEventListener('dblclick', async (e) => {
    const el = e.target.closest('.copy-cell');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const text = el.getAttribute('data-copy') || el.textContent.trim();
    const kind = el.getAttribute('data-copy-kind') || 'value';
    const ok = await copyText(text);
    if (ok) {
      const label = kind === 'phone' ? 'Phone number' : kind === 'email' ? 'Email' : 'Value';
      showClipToast(`📋 ${label} copied`);
      // Brief visual feedback on the cell itself
      const orig = el.style.background;
      el.style.transition = 'background .25s ease';
      el.style.background = 'rgba(34,197,94,0.25)';
      setTimeout(()=>{ el.style.background = orig; }, 600);
    } else {
      showClipToast('Copy failed — try again', false);
    }
  }, true);

  // Inject minimal styling so copy-cells look interactive
  if (!document.getElementById('copy-cell-styles')) {
    const st = document.createElement('style');
    st.id = 'copy-cell-styles';
    st.textContent = `
      .copy-cell { cursor: pointer; user-select: text; }
      .copy-cell:hover { text-decoration: underline; text-decoration-style: dotted; text-decoration-color: var(--primary); }
    `;
    document.head.appendChild(st);
  }
})();

// ════════════════════════════════════════════════════════════
// NOTES HOVER PREVIEW — shows full lead notes on cell hover.
// ════════════════════════════════════════════════════════════
(function(){
  let tip = null;
  let hideTimer = null;

  const ensureTip = () => {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.id = 'notes-hover-tip';
    tip.style.cssText = `
      position: fixed; z-index: 99998;
      background: #1f2937; color: #fff;
      padding: 10px 14px; border-radius: 8px;
      font-size: 12px; line-height: 1.5;
      max-width: 380px; min-width: 180px;
      box-shadow: 0 10px 28px rgba(0,0,0,0.30), 0 0 0 1px rgba(255,255,255,0.08);
      pointer-events: none;
      opacity: 0; transform: translateY(4px);
      transition: opacity .14s ease, transform .14s ease;
      white-space: pre-wrap; word-wrap: break-word;
      font-family: inherit;
    `;
    document.body.appendChild(tip);
    return tip;
  };

  const showTip = (cell) => {
    const raw = cell.getAttribute('data-notes') || '';
    if (!raw.trim()) return; // don't show for empty notes
    const t = ensureTip();
    t.textContent = raw;
    // Position: prefer below the cell; flip above if it would overflow viewport
    const r = cell.getBoundingClientRect();
    t.style.left = '0px'; t.style.top = '0px';
    t.style.opacity = '0';
    t.style.display = 'block';
    // Force layout to measure
    const tRect = t.getBoundingClientRect();
    const margin = 8;
    let left = r.left;
    let top  = r.bottom + 6;
    if (left + tRect.width + margin > window.innerWidth) {
      left = window.innerWidth - tRect.width - margin;
    }
    if (left < margin) left = margin;
    if (top + tRect.height + margin > window.innerHeight) {
      top = r.top - tRect.height - 6;       // flip above
      if (top < margin) top = margin;
    }
    t.style.left = left + 'px';
    t.style.top  = top  + 'px';
    requestAnimationFrame(() => {
      t.style.opacity = '1';
      t.style.transform = 'translateY(0)';
    });
  };

  const hideTip = () => {
    if (!tip) return;
    tip.style.opacity = '0';
    tip.style.transform = 'translateY(4px)';
  };

  document.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('.notes-cell');
    if (!cell) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    showTip(cell);
  });

  document.addEventListener('mouseout', (e) => {
    const cell = e.target.closest('.notes-cell');
    if (!cell) return;
    // Only hide if we're actually leaving the cell (not crossing children)
    const to = e.relatedTarget;
    if (to && cell.contains(to)) return;
    hideTimer = setTimeout(hideTip, 60);
  });

  // Also hide on scroll so the tooltip doesn't drift away from its cell
  ['scroll','wheel','resize'].forEach(ev => {
    window.addEventListener(ev, hideTip, true);
  });
})();
