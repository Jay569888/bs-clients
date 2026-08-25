// ===== TODAY'S FOCUS — Enhanced v3.0 =====
// Complete replacement with all new requirements

// ── Date helpers ──────────────────────────────────────────

window._forceCleanDate = function(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(s)) return s;
  if (/^\d{1,2}\/\d{1,2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d)) return `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
  return s;
};

window._forceCleanFFUP = function(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{1,2}\/\d{1,2}$/.test(s)) return s;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const parts = s.split('/');
    return `${parts[0]}/${parts[1]}`;
  }
  const d = new Date(s);
  if (!isNaN(d)) return `${d.getMonth()+1}/${d.getDate()}`;
  return s;
};

window._parseFFUPDate = function(ffup) {
  if (!ffup) return null;
  const s = String(ffup).trim();
  if (/^\d{1,2}\/\d{1,2}$/.test(s)) {
    const [m, d] = s.split('/');
    const today = new Date(); 
    today.setHours(0,0,0,0);
    return new Date(today.getFullYear(), parseInt(m)-1, parseInt(d));
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [m, d, y] = s.split('/');
    const year = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    return new Date(year, parseInt(m)-1, parseInt(d));
  }
  const parsed = new Date(s);
  return isNaN(parsed) ? null : parsed;
};

window._isOverdue = function(lead) {
  // Overdue = follow-up date is MORE THAN 7 days in the past.
  // Less than 7 days past, due today, or no FFUP → NOT overdue.
  const d = window._parseFFUPDate(lead.ffup);
  if (!d) return false;
  const today = new Date();
  today.setHours(0,0,0,0);
  const diffDays = Math.floor((today - d) / (1000*60*60*24));
  return diffDays >= 7;
};

window._isDueToday = function(lead) {
  const d = window._parseFFUPDate(lead.ffup);
  if (!d) return false;
  const today = new Date(); 
  today.setHours(0,0,0,0);
  return d.getTime() === today.getTime();
};

window._daysSinceLastEmail = function(leadId) {
  const le = window.getLastEmail(leadId);
  if (!le) return 999;
  
  const sentStr = String(le.sentAt || '');
  
  // Try M/D/YY format first
  const m = sentStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const month = parseInt(m[1]) - 1; // 0-indexed
    const day = parseInt(m[2]);
    const year = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
    
    const emailDate = new Date(year, month, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    emailDate.setHours(0, 0, 0, 0);
    
    const diffTime = today - emailDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays >= 0 ? diffDays : 999;
  }
  
  // Fallback to Date parsing
  const d = new Date(sentStr);
  if (isNaN(d)) return 999;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  
  const diffTime = today - d;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays >= 0 ? diffDays : 999;
};

window._parseLeadDate = function(lead) {
  const raw = lead.date || lead.createdAt || '';
  if (!raw) return new Date(8640000000000000);
  const s = String(raw).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [mo, dy, yr] = s.split('/');
    return new Date(yr.length===2 ? 2000+parseInt(yr) : parseInt(yr), parseInt(mo)-1, parseInt(dy));
  }
  const d = new Date(s);
  return isNaN(d) ? new Date(8640000000000000) : d;
};

window._getDuration = function(lead) {
  const parsed = window._parseLeadDate(lead);
  if (!parsed || isNaN(parsed)) return '—';
  const now = new Date();
  const diff = now - parsed;
  const days = Math.floor(diff / 86400000);
  if (days < 0) return '—';
  if (days < 30) return days + 'd';
  if (days < 365) {
    const mo = Math.floor(days/30);
    const rem = days % 30;
    return mo + 'mo' + (rem > 0 ? ' ' + rem + 'd' : '');
  }
  const y = Math.floor(days/365);
  const rm = Math.floor((days%365)/30);
  return y + 'yr' + (rm > 0 ? ' ' + rm + 'mo' : '');
};

// ── Check if lead should be dropped today (any N-day notice has matured) ──
// Picks up two signals:
//   1. lead._dropDate (set when an "N-Day Notice" email is sent) — most accurate
//   2. "Drop on M/D/YY" inside lead.notes — fallback for legacy/manual entries
// Lead is "Drop Today" if today >= the recorded drop date.
window._shouldDropToday = function(lead) {
  if (!lead) return false;
  const today = new Date(); today.setHours(0,0,0,0);

  // 1. ISO drop date set by N-Day Notice auto-detection
  if (lead._dropDate) {
    const d = new Date(lead._dropDate + 'T00:00:00');
    if (!isNaN(d) && today >= d) return true;
  }

  // 2. Fall back to "Drop on M/D/YY" parsed out of notes
  const notesMatch = String(lead.notes || '').match(/Drop on\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (notesMatch) {
    let yr = parseInt(notesMatch[3], 10);
    if (yr < 100) yr += 2000;
    const noteDate = new Date(yr, parseInt(notesMatch[1],10)-1, parseInt(notesMatch[2],10));
    noteDate.setHours(0,0,0,0);
    if (!isNaN(noteDate) && today >= noteDate) return true;
  }

  // 3. Legacy: subject regex + 7-day check (kept for backward compat)
  const lastEmail = window.getLastEmail && window.getLastEmail(lead.id);
  if (lastEmail) {
    const subj = lastEmail.subject || '';
    const m = subj.match(/(\d{1,3})\s*[-_ ]?\s*day(?:s)?\s*[-_ ]?\s*notice/i);
    if (m) {
      const n = parseInt(m[1], 10);
      const daysSince = window._daysSinceLastEmail ? window._daysSinceLastEmail(lead.id) : 999;
      if (daysSince >= n) return true;
    }
  }
  return false;
};

// ── NEW: Check if lead is untouched for 7+ days ──
window._isUntouched = function(lead) {
  // Check if any actions exist
  const hasActions = lead.call || lead.vm || lead.emailChk || lead.text || lead.upload;
  
  // Check last email
  const daysSinceEmail = window._daysSinceLastEmail(lead.id);
  
  // Check last follow-up update
  const lastFollowUp = window._parseFFUPDate(lead.ffup);
  let daysSinceFollowUp = 999;
  
  if (lastFollowUp) {
    const today = new Date();
    today.setHours(0,0,0,0);
    daysSinceFollowUp = Math.floor((today - lastFollowUp) / 86400000);
  }
  
  // Untouched if no actions AND (no email for 7+ days OR no follow-up for 7+ days)
  return !hasActions && (daysSinceEmail >= 7 || daysSinceFollowUp >= 7);
};

// ── Panel ─────────────────────────────────────────────────

window.openTodaysFocus = function() {
  window._renderTodaysFocus();
  window.openModal('modalTodaysFocus');
};

window._renderTodaysFocus = function() {
  // Tabs excluded from Today's Focus:
  //  • intake  — not yet in the pipeline
  //  • drop    — already dropped, no action needed
  //  • clients — already signed/onboarded, no follow-up needed
  const skipTabs = ['drop', 'intake', 'clients', 'retainer'];
  const allLeads = [];

  window.ALL_TABS.forEach(tab => {
    if (skipTabs.includes(tab)) return;
    (window.state.leads[tab] || []).forEach(l => allLeads.push({ ...l, tab }));
  });

  // NEW CATEGORIES (only 3)
  
  // Category 1: Priority (Prio Today + Yesterday's Prio Tomorrow)
  const prioToday = allLeads.filter(l => l._prioToday === true || l._prioTomorrow === true);
  
  // Category 2: Drop Today (7-day notice was sent, now it's been 7 days)
  const dropToday = allLeads.filter(l => window._shouldDropToday(l));
  
  // Category 3: Untouched Leads (STRICT 7+ days check)
  const untouched = allLeads.filter(l => {
    // Check if ANY action exists
    const hasActions = l.call || l.vm || l.emailChk || l.text || l.upload;
    if (hasActions) return false; // Has actions = not untouched
    
    // Check last email (must be 7+ days ago)
    const daysSinceEmail = window._daysSinceLastEmail(l.id);
    
    // Check last follow-up update (must be 7+ days ago)
    const lastFollowUp = window._parseFFUPDate(l.ffup);
    let daysSinceFollowUp = 999;
    
    if (lastFollowUp) {
      const today = new Date();
      today.setHours(0,0,0,0);
      daysSinceFollowUp = Math.floor((today - lastFollowUp) / 86400000);
    }
    
    // STRICT: Both email AND follow-up must be 7+ days old (or not exist)
    // If either is less than 7 days, lead is NOT untouched
    const emailOldEnough = daysSinceEmail >= 7;
    const followUpOldEnough = daysSinceFollowUp >= 7;
    
    return emailOldEnough && followUpOldEnough;
  });
  
  // Group untouched by tab and sort oldest first within each tab
  const groupedUntouched = {};
  const tabOrder = ['pc', 'star', 'o', 'dbb', 'clients', 'retainer'];
  
  untouched.forEach(lead => {
    if (!groupedUntouched[lead.tab]) {
      groupedUntouched[lead.tab] = [];
    }
    groupedUntouched[lead.tab].push(lead);
  });
  
  // Sort each group by oldest first
  Object.keys(groupedUntouched).forEach(tab => {
    groupedUntouched[tab].sort((a, b) => {
      const dateA = window._parseFFUPDate(a.ffup) || window._parseLeadDate(a);
      const dateB = window._parseFFUPDate(b.ffup) || window._parseLeadDate(b);
      return dateA - dateB; // oldest first
    });
  });

  // Date header
  const d = new Date();
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  document.getElementById('todaysFocusDate').textContent =
    `${days[d.getDay()]}, ${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;

  // Metrics cards (NEW: only 3 categories)
  const mkCard = (num, label, color) =>
    `<div style="background:var(--card);border:1px solid var(--border);border-radius:7px;padding:10px;text-align:center">
      <div style="font-size:22px;font-weight:700;color:${color}">${num}</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${label}</div>
    </div>`;

  document.getElementById('todaysFocusMetrics').innerHTML =
    mkCard(prioToday.length,   'Priority',        'var(--primary)')      +
    mkCard(dropToday.length,   'Drop Today',      'var(--danger-text)')  +
    mkCard(untouched.length,   'Untouched 7d+',   'var(--warning-text)');

  // Render sections with GROUPED FORMAT
  const mkSection = (icon, title, color, leads, accent) => {
    if (!leads.length) return '';
    
    let s = `<div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:600;color:${color};margin-bottom:6px">${icon} ${title}</div>`;
    
    leads.forEach(l => {
      const lastFFUP = l.ffup ? window._forceCleanFFUP(l.ffup) : '—';
      const tabLabel = (window.TAB_LABELS[l.tab] || l.tab).toUpperCase();
      
      // Check if completed (marked done)
      const isDone = window._focusCompletedLeads?.has(l.id) || false;
      const checkIcon = isDone ? '✅' : '☐';
      
      s += `<div id="focus-row-${l.id}" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:6px;margin-bottom:4px;background:var(--card);border:1px solid var(--border);border-left:3px solid ${accent};gap:8px;${isDone ? 'opacity:0.5;' : ''}">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:12px;${isDone ? 'text-decoration:line-through;' : ''}">
            <span onclick="window._toggleFocusDone('${l.id}')" style="cursor:pointer;margin-right:6px;user-select:none;font-size:14px">${checkIcon}</span>
            ${l.name}
            <span style="font-size:10px;font-weight:400;color:var(--text-muted);margin-left:6px">(${tabLabel})</span>
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;${isDone ? 'text-decoration:line-through;' : ''}">
            Phone: ${l.phone || '—'} · Last Follow-up: ${lastFFUP}
          </div>
        </div>
        <button onclick="window._focusGoToLead('${l.id}','${l.tab}')"
          style="background:${accent};color:#fff;border:none;border-radius:5px;padding:3px 10px;cursor:pointer;font-size:10px;font-weight:600;white-space:nowrap;flex-shrink:0">
          Go →
        </button>
      </div>`;
    });
    
    return s + '</div>';
  };
  
  // New function for grouped untouched section
  const mkGroupedUntouchedSection = (icon, title, color, groupedLeads, accent) => {
    const totalCount = Object.values(groupedLeads).flat().length;
    if (totalCount === 0) return '';
    
    let s = `<div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:600;color:${color};margin-bottom:6px">${icon} ${title}</div>`;
    
    // Render each tab group
    tabOrder.forEach(tab => {
      const leads = groupedLeads[tab];
      if (!leads || leads.length === 0) return;
      
      const tabLabel = (window.TAB_LABELS[tab] || tab).toUpperCase();
      
      // Tab header
      s += `<div style="font-size:10px;font-weight:600;color:var(--text-muted);margin:8px 0 4px 0;text-transform:uppercase">${tabLabel} (${leads.length})</div>`;
      
      // Leads in this tab
      leads.forEach(l => {
        const lastFFUP = l.ffup ? window._forceCleanFFUP(l.ffup) : '—';
        
        // Check if completed
        const isDone = window._focusCompletedLeads?.has(l.id) || false;
        const checkIcon = isDone ? '✅' : '☐';
        
        // Calculate ACCURATE days untouched
        let daysUntouched = 999;
        let daysText = 'No activity';
        
        // Try to get last email date
        const daysSinceEmail = window._daysSinceLastEmail(l.id);
        
        if (daysSinceEmail < 999) {
          // Has email history - use that
          daysUntouched = daysSinceEmail;
          daysText = daysSinceEmail + 'd ago';
        } else if (l.ffup) {
          // No email but has follow-up date - calculate from that
          const ffupDate = window._parseFFUPDate(l.ffup);
          if (ffupDate) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            ffupDate.setHours(0, 0, 0, 0);
            
            const diffTime = today - ffupDate;
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays >= 0) {
              daysUntouched = diffDays;
              daysText = diffDays + 'd ago';
            }
          }
        }
        
        s += `<div id="focus-row-${l.id}" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:6px;margin-bottom:4px;background:var(--card);border:1px solid var(--border);border-left:3px solid ${accent};gap:8px;${isDone ? 'opacity:0.5;' : ''}">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:12px;${isDone ? 'text-decoration:line-through;' : ''}">
              <span onclick="window._toggleFocusDone('${l.id}')" style="cursor:pointer;margin-right:6px;user-select:none;font-size:14px">${checkIcon}</span>
              ${l.name}
            </div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px;${isDone ? 'text-decoration:line-through;' : ''}">
              Phone: ${l.phone || '—'} · Last Follow-up: ${lastFFUP} · ${daysText}
            </div>
          </div>
          <button onclick="window._focusGoToLead('${l.id}','${l.tab}')"
            style="background:${accent};color:#fff;border:none;border-radius:5px;padding:3px 10px;cursor:pointer;font-size:10px;font-weight:600;white-space:nowrap;flex-shrink:0">
            Go →
          </button>
        </div>`;
      });
    });
    
    return s + '</div>';
  };

  let html = '';
  html += mkSection('🎯', 'Priority', 'var(--primary)', prioToday, 'var(--primary)');
  html += mkSection('🔴', 'Drop Today', 'var(--danger-text)', dropToday, 'var(--danger)');
  html += mkGroupedUntouchedSection('📭', 'Untouched Leads (7+ days)', 'var(--warning-text)', groupedUntouched, 'var(--warning)');

  if (!html) {
    html = `<div style="text-align:center;padding:28px;color:var(--success-text);font-size:13px">
      ✅ All caught up! No pending tasks today.
    </div>`;
  }

  document.getElementById('todaysFocusContent').innerHTML = html;
};

// NEW: Track completed leads
if (!window._focusCompletedLeads) {
  window._focusCompletedLeads = new Set();
}

window._toggleFocusDone = function(leadId) {
  if (window._focusCompletedLeads.has(leadId)) {
    window._focusCompletedLeads.delete(leadId);
  } else {
    window._focusCompletedLeads.add(leadId);
  }
  window._renderTodaysFocus();
};

window._clearDoneTasks = function() {
  window._focusCompletedLeads.clear();
  window._renderTodaysFocus();
};

// Go to lead with gold flash
window._focusGoToLead = function(id, tab) {
  window.closeModal('modalTodaysFocus');
  window.showPage(tab);
  
  setTimeout(() => {
    const row = document.querySelector(`tr[data-id="${CSS.escape(id)}"]`)
              || document.getElementById('lead-row-' + id);
    if (!row) return;
    
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    setTimeout(() => {
      const nameCell = row.children[6] || row.children[2];
      if (nameCell) { 
        nameCell.setAttribute('tabindex','-1'); 
        nameCell.focus(); 
      }
      
      // Gold flash
      const cells = [...row.children];
      row.style.transition = 'background 0.15s ease';
      row.style.outline = 'none';
      cells.forEach(td => { 
        td.style.transition = 'background-color 0.15s ease'; 
        td.style.outline = 'none'; 
      });
      
      row.style.background = '#ffe066';
      cells.forEach(td => { td.style.backgroundColor = '#ffe066'; });
      
      setTimeout(() => {
        row.style.background = '#fff3b0';
        cells.forEach(td => { td.style.backgroundColor = '#fff3b0'; });
        
        setTimeout(() => {
          row.style.background = '';
          cells.forEach(td => { 
            td.style.backgroundColor = ''; 
            td.style.transition = ''; 
          });
          row.style.transition = '';
        }, 1400);
      }, 700);
    }, 350);
  }, 400);
};

// Refresh panel when open
window._refreshTodaysFocusIfOpen = function() {
  const modal = document.getElementById('modalTodaysFocus');
  if (modal && modal.classList.contains('active')) {
    window._renderTodaysFocus();
  }
};

console.log('✅ Enhanced Today\'s Focus Loaded');
console.log('   - 3 categories: Priority, Drop Today, Untouched');
console.log('   - Green check system active');
console.log('   - Clear Done Tasks available');
