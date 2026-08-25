// ===== ENHANCED EMAIL SYSTEM v3.0 - COMPLETE =====
// Includes: highlight removal, follow-up sync, EOD automation, modal fix

// ── Template population ───────────────────────────────────
window.populateEmailTemplateSelect = function() {
    const el = document.getElementById('emailTemplateSelect');
    if (!el) return;
    el.innerHTML = '<option value="">-- Write custom --</option>' +
        window.state.templates.map((t, i) =>
            `<option value="${i}">${window._escAttr(t.name)}</option>`
        ).join('');
};

window._escAttr = function(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

window._buildReplacer = function(lead) {
    const fn = (lead.name || '').trim().split(' ')[0];
    let evidenceText = 'Please provide all requested documentation.';
    if (window.REQUIRED_EVIDENCE) {
        const ev = lead.evidence || {};
        if (ev._missingOverride) {
            evidenceText = ev._missingOverride;
        } else {
            const missing = window.REQUIRED_EVIDENCE
                .filter(req => ev[req.opt] !== 'check' && ev[req.opt] !== 'x')
                .map(req => `• ${req.label}`);
            evidenceText = missing.length
                ? missing.join('<br>')
                : '✅ All required documentation has been received.';
        }
    }
    const gdriveLink = lead.gdrive || '';
    const gdriveHtml = gdriveLink
        ? `<a href="${gdriveLink}" style="color:#1e3a5f;font-weight:bold;text-decoration:underline;">CLICK HERE TO UPLOAD EVIDENCE</a>`
        : '<span style="color:#999;font-style:italic;">[No Drive Link Provided]</span>';
        
    return str => (str || '')
        .replace(/{name}/g, fn)
        .replace(/{full_name}/g, lead.name || '')
        .replace(/{email}/g, lead.email || '')
        .replace(/{phone}/g, lead.phone || '')
        .replace(/{missing_evidence}/g, evidenceText)
        .replace(/{gdrive}/g, gdriveHtml);
};

window.applyEmailTemplate = function() {
    const el = document.getElementById('emailTemplateSelect');
    const idx = parseInt(el.value);
    if (isNaN(idx) || !window.state.templates[idx]) {
        document.getElementById('emailSubject').value = '';
        document.getElementById('emailBody').innerHTML = '';
        document.getElementById('emailPreview').innerHTML = '';
        return;
    }
    const tpl = window.state.templates[idx];
    const lead = window.findLeadById(window.currentEmailLeadId);
    if (!lead) return;
    const repl = window._buildReplacer(lead);
    const subject = repl(tpl.subject || '');
    const body = repl(tpl.body || '');
    document.getElementById('emailSubject').value = subject;
    document.getElementById('emailBody').innerHTML = body;
    document.getElementById('emailPreview').innerHTML = body;
};

// ── FIXED: Modal opening function ──────────────────────────
window.openEmailModal = function(tab, leadId) {
    const lead = window.findLeadById(leadId);
    if (!lead) {
        console.warn('Lead not found:', leadId);
        return;
    }
    window.currentEmailLeadId = lead.id;

    const nameEl = document.getElementById('emailLeadName');
    const subjectEl = document.getElementById('emailSubject');
    const bodyEl = document.getElementById('emailBody');
    const previewEl = document.getElementById('emailPreview');
    const templateEl = document.getElementById('emailTemplateSelect');
    const warningEl = document.getElementById('gmailWarning');

    if (nameEl) nameEl.textContent = lead.name;
    if (subjectEl) subjectEl.value = '';
    if (bodyEl) bodyEl.innerHTML = '';
    if (previewEl) previewEl.innerHTML = '';
    if (templateEl) templateEl.value = '';
    if (warningEl) warningEl.style.display = window.gmailToken ? 'none' : 'block';

    if (typeof window.populateEmailTemplateSelect === 'function') {
        window.populateEmailTemplateSelect();
    }

    if (typeof window._switchEmailTab === 'function') {
        window._switchEmailTab('compose');
    } else if (typeof window.switchEmailTab === 'function') {
        window.switchEmailTab('compose');
    }

    if (typeof window.renderEmailHistory === 'function') {
        window.renderEmailHistory(lead.id);
    }

    if (typeof window.openModal === 'function') {
        window.openModal('modalEmail');
    } else {
        const modal = document.getElementById('modalEmail');
        if (modal) {
            modal.classList.add('active');
            modal.style.display = 'flex';
        }
    }
};

window.openEmailFromIntake = function(id) {
    const l = (window.state.leads.intake || []).find(x => x.id === id);
    if (!l) {
        console.warn('Intake lead not found:', id);
        return;
    }
    window.openEmailModal('intake', l.id);
};

window.switchEmailTab = function(tab) {
    const tabs = document.querySelectorAll('.email-tab');
    tabs.forEach(t => t.classList.remove('active'));
    const btn = document.querySelector(`.email-tab[data-tab="${tab}"]`);
    if (btn) btn.classList.add('active');
    const panes = document.querySelectorAll('.email-pane');
    panes.forEach(p => p.style.display = 'none');
    const pane = document.getElementById('emailPane-' + tab);
    if (pane) pane.style.display = 'block';
};

// ── ENHANCED: Send email with all new features ─────────────
window.sendEmailNow = async function() {
    const lead = window.findLeadById(window.currentEmailLeadId);
    if (!lead) return;
    const subject = document.getElementById('emailSubject').value.trim();
    let body = document.getElementById('emailBody').innerHTML.trim();
    if (!subject || !body) {
        alert('Subject and body are required.');
        return;
    }
    if (!lead.email) {
        alert('This lead has no email address.');
        return;
    }

    body = window._normalizeEmailHtml(body);
    const tab = window.findLeadTab(lead.id);
    if (!tab) return;
    window.showLoading('Sending email...');

    try {
        const result = await window.sendGmailDirect(lead.email, subject, body);
        if (result.noToken) {
            window.hideLoading();
            alert('Gmail not connected. Click Settings → Connect Gmail.');
            return;
        }
        if (result.expired) {
            window.hideLoading();
            alert('Gmail token expired. Reconnect in Settings.');
            return;
        }
        if (!result.sent) {
            window.hideLoading();
            alert('Failed to send: ' + (result.error || 'Unknown error'));
            return;
        }

        const templateSelect = document.getElementById('emailTemplateSelect');
        const templateIdx = templateSelect ? parseInt(templateSelect.value) : NaN;
        const template = !isNaN(templateIdx) && window.state.templates[templateIdx]
            ? window.state.templates[templateIdx].name
            : '';

        const subjectLower = subject.toLowerCase();
        const templateLower = template.toLowerCase();

        const is7DayNotice = /7.?day.?notice/i.test(subjectLower) ||
                             /drop/i.test(subjectLower) ||
                             /final.?notice/i.test(subjectLower);

        if (!is7DayNotice && lead._highlight === 'red') {
            delete lead._highlight;
            console.log('✅ Red highlight removed from:', lead.name);
        }

        const isForReview = /for.?review/i.test(subjectLower) ||
                            /review/i.test(templateLower);

        if (!isForReview && lead._highlight === 'green') {
            delete lead._highlight;
            console.log('✅ Green highlight removed from:', lead.name);
        }

        const todayMD = window.todayMD ? window.todayMD() :
                        `${new Date().getMonth()+1}/${new Date().getDate()}`;

        lead.ffup = todayMD;
        lead.emailChk = true;
        console.log('✅ Follow-up synced to:', todayMD);

        if (tab === 'intake') {
            const todayMDYY = window.todayMDYY ? window.todayMDYY() :
                              `${new Date().getMonth()+1}/${new Date().getDate()}/${String(new Date().getFullYear()).slice(-2)}`;

            lead._eodNote = 'Chased Intake';
            lead._eodDate  = todayMDYY;

            if (!window.state.eod) window.state.eod = [];

            const alreadyLogged = window.state.eod.some(e =>
                e.leadId === lead.id && e.date === todayMDYY
            );

            if (!alreadyLogged) {
                window.state.eod.unshift({
                    date: todayMDYY,
                    note: `Chased Intake of ${lead.name}`,
                    leadId: lead.id,
                    tab: tab,
                    timestamp: Date.now()
                });
                console.log('✅ EOD added: Chased Intake of', lead.name);
            }
        }

        if (template) {
            lead.level = template;
            if (window._protectField) window._protectField(lead.id, 'level', 15*60*1000, template);
        }

        (function applyNDayNotice(){
            const sources = [String(template||''), String(subject||'')];
            let nDays = 0;
            for (const src of sources) {
                const m = src.match(/(\d{1,3})\s*[-_ ]?\s*day(?:s)?\s*[-_ ]?\s*notice/i);
                if (m) { nDays = parseInt(m[1], 10); break; }
            }

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
                    console.log(`↩️ Drop alert cancelled for ${lead.name} (new email sent)`);
                }
                return;
            }

            if (nDays < 1 || nDays > 365) return;

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
            const newNote = `Drop on ${dropStr}`;
            lead.notes = cleanedNotes ? `${cleanedNotes} | ${newNote}` : newNote;

            if (window.upsertTodaysEodEntry) {
                window.upsertTodaysEodEntry({
                    leadId: lead.id,
                    leadName: lead.name,
                    tab,
                    newText: `${nDays}-day notice sent - ${lead.name}`
                });
            }

            if (window._protectField) {
                window._protectField(lead.id, 'rowAlert', 30*60*1000, 'drop');
                window._protectField(lead.id, 'notes', 30*60*1000, lead.notes);
                window._protectField(lead.id, '_dropDate', 30*60*1000, lead._dropDate);
            }

            console.log(`📅 ${nDays}-Day Notice detected → Drop on ${dropStr}`);
        })();

        if (!window.state.emailHistory) window.state.emailHistory = {};
        if (!window.state.emailHistory[lead.id]) window.state.emailHistory[lead.id] = [];

        const entry = {
            subject: subject,
            sentAt: window.todayMDYY ? window.todayMDYY() : new Date().toLocaleDateString(),
            template: template,
            templateName: template,
            body: body,
            to: lead.email
        };

        window.state.emailHistory[lead.id].unshift(entry);

        if (window._queueSave) {
            window._queueSave({
                action: 'updateLead',
                tab: tab,
                lead: JSON.stringify(lead)
            });
            window._queueSave({
                action: 'logEmail',
                leadId: lead.id,
                entry: JSON.stringify(entry)
            });
        } else if (window.api) {
            await window.api({
                action: 'updateLead',
                tab: tab,
                lead: JSON.stringify(lead)
            });
            await window.api({
                action: 'logEmail',
                leadId: lead.id,
                entry: JSON.stringify(entry)
            });
        }

        if (window._refreshTodaysFocusIfOpen) {
            window._refreshTodaysFocusIfOpen();
        }
        if (tab === 'intake' && window.renderIntakeList) {
            window.renderIntakeList();
        } else if (window.renderLeadsTab) {
            window.renderLeadsTab(tab);
        }
        window.hideLoading();

        if (typeof window.closeModal === 'function') {
            window.closeModal('modalEmail');
        } else {
            const modal = document.getElementById('modalEmail');
            if (modal) {
                modal.classList.remove('active');
                modal.style.display = 'none';
            }
        }

        if (window.showSuccess) {
            window.showSuccess('Email Sent', `Sent to ${lead.name}`);
        } else {
            alert(`✅ Email sent to ${lead.name}`);
        }

        console.log('✅ Email sent successfully with all enhancements');
    } catch(e) {
        window.hideLoading();
        console.error('Email send error:', e);
        alert('Error sending email: ' + e.message);
    }
};

// ── Email history rendering ────────────────────────────────
window.renderEmailHistory = function(leadId) {
    const el = document.getElementById('emailHistoryList');
    if (!el) return;

    let hist = (window.state.emailHistory && window.state.emailHistory[leadId]) || [];
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 14);

    const parseSentAt = (s) => {
        if (!s) return null;
        let d = new Date(s);
        if (!isNaN(d.getTime())) return d;
        const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
        if (m) {
            const yr = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
            let h = m[4] ? parseInt(m[4], 10) : 0;
            const min = m[5] ? parseInt(m[5], 10) : 0;
            const ampm = (m[6] || '').toUpperCase();
            if (ampm === 'PM' && h < 12) h += 12;
            if (ampm === 'AM' && h === 12) h = 0;
            d = new Date(parseInt(yr), parseInt(m[1], 10) - 1, parseInt(m[2], 10), h, min);
            return isNaN(d.getTime()) ? null : d;
        }
        return null;
    };

    const kept = [];
    let purgedCount = 0;
    for (const e of hist) {
        const d = parseSentAt(e.sentAt);
        if (d && d >= cutoff) {
            kept.push(e);
        } else if (d && d < cutoff) {
            purgedCount++;
        } else {
            kept.push(e);
        }
    }

    if (purgedCount > 0) {
        window.state.emailHistory[leadId] = kept;
        console.log(`📜 Auto-purged ${purgedCount} email(s) older than 14 days for lead ${leadId}`);
    }

    if (!kept.length) {
        el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px">No emails in the last 2 weeks.</div>';
        return;
    }

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const today = [];
    const earlier = [];
    for (const e of kept) {
        const d = parseSentAt(e.sentAt);
        if (d && d >= todayStart) today.push(e);
        else earlier.push(e);
    }

    const fmt = window.formatEmailDateLong || ((s) => s || '—');
    const renderEntry = (e) => `<div style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px;background:var(--card)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px">
            <div style="font-weight:600;font-size:12px;flex:1">${(e.subject || 'No Subject').replace(/</g, '&lt;')}</div>
            <span style="font-size:10px;color:var(--text-muted);white-space:nowrap">${fmt(e.sentAt)}</span>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">
            ${(e.templateName || e.template) ? `📋 ${e.templateName || e.template}` : '📋 Custom'} ${e.sentBy ? ` · by ${e.sentBy}` : ''} ${e.status ? ` · ${e.status}` : ''}
        </div>
        ${e.body ? `<div style="font-size:11px;color:var(--text);max-height:120px;overflow:auto;border-top:1px solid var(--border);padding-top:6px;line-height:1.4">${e.body}</div>` : ''}
    </div>`;

    const sections = [];
    if (today.length) {
        sections.push(`<div style="font-size:11px;font-weight:700;color:var(--primary);margin:0 0 6px;text-transform:uppercase;letter-spacing:.5px">Today (${today.length})</div>${today.map(renderEntry).join('')}`);
    }
    if (earlier.length) {
        sections.push(`<div style="font-size:11px;font-weight:700;color:var(--text-muted);margin:${today.length ? '14px' : '0'} 0 6px;text-transform:uppercase;letter-spacing:.5px">Last 2 Weeks (${earlier.length})</div>${earlier.map(renderEntry).join('')}`);
    }
    el.innerHTML = sections.join('');
};

window._switchEmailTab = function(which) {
    const compose = document.getElementById('emailTabCompose');
    const history = document.getElementById('emailTabHistory');
    const composeBtn = document.getElementById('email-tab-compose-btn');
    const historyBtn = document.getElementById('email-tab-history-btn');
    if (!compose || !history) return;
    if (which === 'history') {
        compose.style.display = 'none';
        history.style.display = 'block';
        if (composeBtn) { composeBtn.classList.remove('btn-primary'); composeBtn.classList.add('btn-outline'); }
        if (historyBtn) { historyBtn.classList.remove('btn-outline'); historyBtn.classList.add('btn-primary'); }
        if (window.currentEmailLeadId) window.renderEmailHistory(window.currentEmailLeadId);
    } else {
        compose.style.display = 'block';
        history.style.display = 'none';
        if (historyBtn) { historyBtn.classList.remove('btn-primary'); historyBtn.classList.add('btn-outline'); }
        if (composeBtn) { composeBtn.classList.remove('btn-outline'); composeBtn.classList.add('btn-primary'); }
    }
};

window.updatePreview = function() { /* preview pane removed in the new modal */ };
window.insertMedia   = function() { /* media insert removed — use Link for images */ };

window.makeFollowUpEditable = function(leadId, tab) {
    const cell = document.querySelector(`tr[data-id="${CSS.escape(leadId)}"] .ffup-cell`);
    if (!cell) {
        console.warn('Follow-up cell not found for:', leadId);
        return;
    }
    const currentValue = cell.textContent.trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue === '—' ? '' : currentValue;
    input.style.cssText = 'width:100%;padding:4px;border:2px solid var(--primary);border-radius:3px;font-size:12px;box-sizing:border-box';
    input.placeholder = 'M/D or M/DD';
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    const save = async () => {
        const newValue = input.value.trim();
        const lead = window.findLeadById(leadId);
        if (lead) {
            lead.ffup = window.normalizeFFUP ? window.normalizeFFUP(newValue) : newValue;
            try {
                if (window._queueSave) {
                    window._queueSave({
                        action: 'updateLead',
                        tab: tab,
                        lead: JSON.stringify(lead)
                    });
                } else if (window.api) {
                    await window.api({
                        action: 'updateLead',
                        tab: tab,
                        lead: JSON.stringify(lead)
                    });
                }
                cell.textContent = lead.ffup || '—';
                if (window._isDueToday && window._isDueToday(lead) && tab === 'intake') {
                    const todayMDYY = window.todayMDYY ? window.todayMDYY() : new Date().toLocaleDateString();
                    lead._eodNote = 'Follow-up Due';
                    lead._eodDate = todayMDYY;
                }
                if (window._refreshTodaysFocusIfOpen) {
                    window._refreshTodaysFocusIfOpen();
                }
                console.log('✅ Follow-up updated to:', lead.ffup);
            } catch(e) {
                console.error('Failed to update follow-up:', e);
                cell.textContent = currentValue;
            }
        } else {
            cell.textContent = currentValue;
        }
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            save();
        } else if (e.key === 'Escape') {
            cell.textContent = currentValue;
        }
    });
};

window.checkIntakeEOD = function() {
    if (!window.state?.leads?.intake) return;
    const today = new Date();
    today.setHours(0,0,0,0);
    const todayStr = window.todayMDYY ? window.todayMDYY() : today.toLocaleDateString();
    window.state.leads.intake.forEach(lead => {
        const ffupDate = window._parseFFUPDate ? window._parseFFUPDate(lead.ffup) : null;
        if (ffupDate && ffupDate.getTime() === today.getTime()) {
            if (lead._eodDate !== todayStr) {
                lead._eodNote = 'Follow-up Due';
                lead._eodDate = todayStr;
            }
        }
    });
};

setTimeout(() => {
    if (typeof window.checkIntakeEOD === 'function') {
        window.checkIntakeEOD();
        clearInterval(window._intakeEodInterval);
        window._intakeEodInterval = setInterval(window.checkIntakeEOD, 3600000);
    }
}, 2000);

window.setLeadHighlight = async function(leadId, color) {
    const lead = window.findLeadById(leadId);
    if (!lead) return;
    lead._highlight = color;
    const tab = window.findLeadTab(leadId);
    if (tab && window._queueSave) {
        window._queueSave({
            action: 'updateLead',
            tab: tab,
            lead: JSON.stringify(lead)
        });
    }
};

window.removeLeadHighlight = async function(leadId) {
    const lead = window.findLeadById(leadId);
    if (!lead) return;
    delete lead._highlight;
    const tab = window.findLeadTab(leadId);
    if (tab && window._queueSave) {
        window._queueSave({
            action: 'updateLead',
            tab: tab,
            lead: JSON.stringify(lead)
        });
    }
};

window.getLeadHighlight = function(leadId) {
    const lead = window.findLeadById(leadId);
    return lead?._highlight || null;
};

// ───────────────────────────────────────────────────────────
// EMAIL BODY HTML NORMALIZER
// Preserves the exact single-blank-line spacing shown in templates.
// Removes only the artifacts (empty spacer <p>s, duplicate <br>s)
// that cause double/triple spacing without touching intended gaps.
// ───────────────────────────────────────────────────────────
window._normalizeEmailHtml = function(html) {
    if (!html) return '';
    let s = String(html);

    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<meta[^>]*>/gi, '');
    s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
    s = s.replace(/<o:p[^>]*>[\s\S]*?<\/o:p>/gi, '');
    s = s.replace(/\s+style="[^"]*mso-[^"]*"/gi, '');
    s = s.replace(/\u200B/g, '');

    // Use a detached (never-attached-to-page) container so this never
    // causes a visible flash or interferes with anything on screen.
    const root = document.createElement('div');
    root.innerHTML = s;

    const BLOCK_TAGS = new Set(['DIV','P','UL','OL','LI','TABLE','TR','TD','TH','BLOCKQUOTE','H1','H2','H3','H4','H5','H6']);
    const INLINE_SAFE = new Set(['SPAN','B','I','U','STRONG','EM','FONT','A','BR']);

    // ---------------------------------------------------------------
    // PASS 1: detect "blank-line" <br> pairs — a <br> whose next
    // meaningful token (skipping whitespace-only text and inline tag
    // open/close boundaries) is itself a <br>. Mark both as "remove".
    // ---------------------------------------------------------------
    function* forwardTokens(start) {
        let node = start;
        while (true) {
            if (node.firstChild) {
                node = node.firstChild;
            } else {
                while (node && !node.nextSibling) {
                    node = node.parentNode;
                    if (!node || node === root.parentNode) return;
                    if (node === root) return;
                    yield { type: 'close', node };
                }
                if (!node || node === root.parentNode || node === root) return;
                node = node.nextSibling;
            }
            if (node === root) return;
            if (node.nodeType === 1) yield { type: 'open', node };
            else if (node.nodeType === 3) yield { type: 'text', node };
        }
    }

    const brList = Array.from(root.querySelectorAll('br'));
    const removeBr = new Set();
    const consumed = new Set();

    for (const br of brList) {
        if (consumed.has(br)) continue;
        let pairBr = null, stop = false;
        for (const tok of forwardTokens(br)) {
            if (tok.type === 'text') {
                if (tok.node.nodeValue.trim() !== '') { stop = true; break; }
                continue;
            }
            if (tok.type === 'open') {
                if (tok.node.tagName === 'BR') { pairBr = tok.node; break; }
                if (BLOCK_TAGS.has(tok.node.tagName)) { stop = true; break; }
                continue; // inline open tag, keep scanning
            }
            if (tok.type === 'close') {
                if (BLOCK_TAGS.has(tok.node.tagName)) { stop = true; break; }
                continue; // inline close tag, keep scanning
            }
        }
        if (pairBr) {
            removeBr.add(br);
            removeBr.add(pairBr);
            consumed.add(pairBr);
        }
    }

    // ---------------------------------------------------------------
    // PASS 2: flatten the tree into an ordered list of paragraphs.
    // We walk root's children recursively. Inline content accumulates
    // into a "current paragraph buffer" (as cloned DOM nodes, so we
    // never produce mismatched tags). A block element flushes the
    // current buffer (if non-empty) as its own paragraph, then is
    // itself recursed into (its children become subsequent paragraphs
    // in the same flattened sequence) rather than kept as a nested
    // wrapper — this is what correctly un-nests the AI-chat-tool
    // div-soup while preserving inline formatting inside each line.
    // A blank-line <br> pair (marked for removal) also flushes the
    // current buffer as a paragraph and starts a new one.
    // ---------------------------------------------------------------
    const paragraphs = []; // array of arrays of cloned inline nodes
    let buffer = [];

    function nodeHasVisibleContent(n) {
        if (n.nodeType === 3) return n.nodeValue.trim() !== '';
        if (n.nodeType !== 1) return false;
        if (n.tagName === 'BR') return false; // a lone br carries no text
        if (n.tagName === 'IMG') return true; // images count as content
        return Array.from(n.childNodes).some(nodeHasVisibleContent);
    }

    function flush() {
        // Only flush if buffer has at least one node with real content
        const hasContent = buffer.some(nodeHasVisibleContent);
        if (hasContent) paragraphs.push(buffer);
        buffer = [];
    }

    function walk(node) {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === 3) {
                buffer.push(child.cloneNode(true));
                continue;
            }
            if (child.nodeType !== 1) continue;

            if (child.tagName === 'BR') {
                if (removeBr.has(child)) {
                    flush(); // blank line -> paragraph break
                } else {
                    buffer.push(child.cloneNode(true)); // ordinary line break, keep inline
                }
                continue;
            }

            if (BLOCK_TAGS.has(child.tagName)) {
                flush(); // anything before this block is its own paragraph
                if (child.tagName === 'UL' || child.tagName === 'OL') {
                    // Keep lists intact as their own paragraph-equivalent block
                    // (don't flatten li's individually into plain paragraphs).
                    paragraphs.push([child.cloneNode(true)]);
                } else {
                    walk(child); // recurse: this block's children become more paragraphs
                    flush();
                }
                continue;
            }

            // Inline element (span/b/i/a/etc): keep its wrapper, but we must
            // still detect blank-line brs *inside* it and split around them.
            // Simplest correct way: recurse into it the same way, but wrap
            // each resulting inline run back in a clone of this element's
            // tag so formatting (bold/italic/color) isn't lost across a
            // paragraph split.
            const subParagraphs = flattenInline(child, removeBr);
            subParagraphs.forEach((run, i) => {
                if (i > 0) flush();
                const wrapper = child.cloneNode(false); // shallow clone (tag + attrs only)
                run.forEach(n => wrapper.appendChild(n));
                buffer.push(wrapper);
            });
        }
    }

    // Like walk(), but for inline elements: returns an array of "runs"
    // (each run = array of nodes) split at blank-line br pairs found at
    // any depth inside this inline element. Does not handle block tags
    // (none should appear inside inline elements in practice, but if they
    // do, we just treat them as ordinary content rather than crashing).
    function flattenInline(el) {
        const runs = [[]];
        function inner(node) {
            for (const child of Array.from(node.childNodes)) {
                if (child.nodeType === 3) {
                    runs[runs.length - 1].push(child.cloneNode(true));
                    continue;
                }
                if (child.nodeType !== 1) continue;
                if (child.tagName === 'BR') {
                    if (removeBr.has(child)) {
                        runs.push([]); // start a new run = new paragraph later
                    } else {
                        runs[runs.length - 1].push(child.cloneNode(true));
                    }
                    continue;
                }
                if (BLOCK_TAGS.has(child.tagName)) {
                    // Unexpected, but handle gracefully: treat its flattened
                    // content as part of the current run via recursion.
                    inner(child);
                    continue;
                }
                // Nested inline element: recurse and re-wrap each sub-run.
                const subRuns = flattenInline(child);
                subRuns.forEach((run, i) => {
                    if (i > 0) runs.push([]);
                    const wrapper = child.cloneNode(false);
                    run.forEach(n => wrapper.appendChild(n));
                    runs[runs.length - 1].push(wrapper);
                });
            }
        }
        inner(el);
        return runs;
    }

    walk(root);
    flush();

    // ---------------------------------------------------------------
    // PASS 3: serialize paragraphs to clean HTML.
    // ---------------------------------------------------------------
    // Recursively prune nodes/subtrees that carry no visible content,
    // and drop leading/trailing standalone <br> *anywhere* a paragraph
    // starts or ends (including inside a wrapper like <b><br></b> sitting
    // at the very start of a paragraph) so no empty inline shells leak
    // into the output.
    function pruneEmpty(node) {
        // Returns true if `node` should be removed entirely.
        if (node.nodeType === 3) return node.nodeValue.trim() === '';
        if (node.nodeType !== 1) return false;
        if (node.tagName === 'BR' || node.tagName === 'IMG') return false; // never auto-prune these
        Array.from(node.childNodes).forEach(child => {
            if (pruneEmpty(child)) child.remove();
        });
        return node.childNodes.length === 0;
    }

    function stripEdgeBrs(container) {
        // Remove a single leading <br> (descending into the first child
        // chain) and a single trailing <br> (descending into the last
        // child chain), repeatedly, since these are stray artifacts left
        // at paragraph edges rather than intentional line breaks.
        function leadingBr() {
            let node = container;
            while (node) {
                if (node.tagName === 'BR') return node;
                if (!node.firstChild) return null;
                node = node.firstChild;
            }
            return null;
        }
        function trailingBr() {
            let node = container;
            while (node) {
                if (node.tagName === 'BR') return node;
                if (!node.lastChild) return null;
                node = node.lastChild;
            }
            return null;
        }
        let guard = 0;
        while (guard++ < 50) {
            const lb = leadingBr();
            if (!lb) break;
            lb.remove();
        }
        guard = 0;
        while (guard++ < 50) {
            const tb = trailingBr();
            if (!tb) break;
            tb.remove();
        }
    }

    function serializeNodes(nodes) {
        const tmp = document.createElement('div');
        nodes.forEach(n => tmp.appendChild(n));
        stripEdgeBrs(tmp);
        // Prune any now-empty wrapper elements left behind (e.g. <b></b>
        // after its only content, a <br>, was stripped above).
        Array.from(tmp.childNodes).forEach(child => {
            if (pruneEmpty(child)) child.remove();
        });
        return tmp.innerHTML;
    }

    let out = '';
    for (const p of paragraphs) {
        // If this "paragraph" is actually a single UL/OL block, don't wrap
        // it in <p> — keep it as the list itself.
        if (p.length === 1 && p[0].nodeType === 1 && (p[0].tagName === 'UL' || p[0].tagName === 'OL')) {
            out += p[0].outerHTML;
            continue;
        }
        const inner = serializeNodes(p).trim();
        if (inner === '') continue;
        out += `<p>${inner}</p>`;
    }
    s = out;

    // Collapse any remaining runs of 2+ <br> inside a paragraph (e.g. odd
    // leftover cases) down to one.
    s = s.replace(/(<br\s*\/?>\s*){2,}/gi, '<br>');

    // Inject inline spacing styles — margin-bottom:1em reproduces the
    // single blank line between paragraphs, matching the editor view.
    const ensureStyle = (tag, extra) => {
        const withStyle = new RegExp(`<${tag}\\b([^>]*?)\\sstyle="([^"]*)"([^>]*)>`, 'gi');
        s = s.replace(withStyle, (m, before, existing, after) => {
            let cleaned = existing
                .replace(/margin\s*:[^;]+;?/gi, '')
                .replace(/line-height\s*:[^;]+;?/gi, '')
                .trim();
            cleaned = cleaned.endsWith(';') ? cleaned : (cleaned ? cleaned + ';' : '');
            return `<${tag}${before} style="${cleaned} ${extra}"${after}>`.replace(/\s+/g, ' ');
        });
        const noStyle = new RegExp(`<${tag}\\b((?:(?!style=)[^>])*)>`, 'gi');
        s = s.replace(noStyle, `<${tag}$1 style="${extra}">`);
    };

    ensureStyle('p',  'margin:0 0 1em 0; line-height:1.5;');
    ensureStyle('ul', 'margin:0 0 1em 24px; padding:0; line-height:1.5;');
    ensureStyle('ol', 'margin:0 0 1em 24px; padding:0; line-height:1.5;');
    ensureStyle('li', 'margin:0 0 4px 0; line-height:1.5;');

    return s.trim();
};


console.log('✅ Enhanced Email System Loaded');
console.log('   - Modal opening: Fixed');
console.log('   - Highlight removal: Active');
console.log('   - Follow-up auto-sync: Active');
console.log('   - EOD automation: Active');
console.log('   - Manual follow-up editing: Active');
