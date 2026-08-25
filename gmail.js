// ===== GMAIL — Inbox Panel, Replies, Signature, Auto-EOD =====
// CHANGES v2:
//   - Topbar badge shows unread count; click opens full inbox panel
//   - Full email body displayed (not just snippet)
//   - Reply composer with template picker + Gmail signature auto-inserted
//   - After reply: marks emailChk, updates ffup, logs EOD, removes from panel
//   - Answered emails removed from panel in real-time
//   - sendGmailDirect unchanged (core send function)

// ── Core send ─────────────────────────────────────────────
window.sendGmailDirect = async function(to, subject, body) {
    if (!window.gmailToken) return { sent: false, noToken: true };
    
    // Minimal cleanup only — preserves the body exactly as composed
    if (window._normalizeEmailHtml) body = window._normalizeEmailHtml(body);
    
    // Auto-append Gmail signature if (a) one exists, (b) it's not already in the body.
    try {
        if (window._fetchGmailSignature) {
            const sig = await window._fetchGmailSignature();
            if (sig && sig.trim()) {
                const bodyText = body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').toLowerCase();
                const sigText  = sig.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').toLowerCase();
                const sigFingerprint = sigText.slice(0, 60);
                
                if (sigFingerprint && !bodyText.includes(sigFingerprint)) {
                    // The body's last <p> already carries margin-bottom:1em (added by
                    // _normalizeEmailHtml). Stacking that margin with the <br>--<br>
                    // divider produces a double gap. Strip the margin from the final
                    // paragraph only, so the divider provides the single line gap.
                    body = body.replace(/(<p\b[^>]*style="[^"]*?)margin:0 0 1em 0;([^"]*"[^>]*>(?:(?!<p\b).)*)$/is, '$1margin:0;$2');
                    // Single <br> before -- is enough; the last <p> already had margin-bottom:1em
                    body = body + '<br>--<br>' + sig;
                }
            }
        }
    } catch(e) { /* signature optional */ }

    // Wrap the whole email in a single font container
    const finalBody = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${body}</div>`;
    
    const mime = [
        'To: ' + to,
        'Subject: =?UTF-8?B?' + btoa(unescape(encodeURIComponent(subject))) + '?=',
        'Content-Type: text/html; charset=UTF-8',
        'MIME-Version: 1.0',
        '',
        finalBody
    ].join('\r\n');
    
    const encoded = btoa(unescape(encodeURIComponent(mime)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
        
    try {
        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + window.gmailToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw: encoded })
        });
        const data = await res.json();
        if (data.id) return { sent: true };
        if (data.error?.code === 401) return { sent: false, expired: true };
        return { sent: false, error: data.error?.message || 'Unknown' };
    } catch(e) {
        return { sent: false, error: e.message };
    }
};

// ── Reply send (with thread linking) ─────────────────────
window._sendReplyDirect = async function(to, subject, body, inReplyToMsgId, threadId) {
    if (!window.gmailToken) return { sent: false, noToken: true };
    if (window._normalizeEmailHtml) body = window._normalizeEmailHtml(body);
    
    const replySubject = subject.startsWith('Re:') ? subject : 'Re: ' + subject;
    const mime = [
        'To: ' + to,
        'Subject: =?UTF-8?B?' + btoa(unescape(encodeURIComponent(replySubject))) + '?=',
        'In-Reply-To: <' + inReplyToMsgId + '>',
        'References: <' + inReplyToMsgId + '>',
        'Content-Type: text/html; charset=UTF-8',
        'MIME-Version: 1.0',
        '',
        body
    ].join('\r\n');
    
    const encoded = btoa(unescape(encodeURIComponent(mime)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
        
    try {
        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + window.gmailToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw: encoded, threadId })
        });
        const data = await res.json();
        if (data.id) return { sent: true, msgId: data.id };
        if (data.error?.code === 401) return { sent: false, expired: true };
        return { sent: false, error: data.error?.message || 'Unknown' };
    } catch(e) {
        return { sent: false, error: e.message };
    }
};

// ── Fetch Gmail signature ─────────────────────────────────
window._gmailSignature = null;
window._fetchGmailSignature = async function() {
    if (window._gmailSignature !== null) return window._gmailSignature;
    if (!window.gmailToken) return '';
    try {
        const emailAddr = localStorage.getItem(window.userPrefix() + 'gmail_email') || '';
        if (!emailAddr) return '';
        const res = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/${encodeURIComponent(emailAddr)}`,
            { headers: { Authorization: 'Bearer ' + window.gmailToken } }
        );
        if (!res.ok) return '';
        const data = await res.json();
        window._gmailSignature = data.signature || '';
        return window._gmailSignature;
    } catch(e) {
        return '';
    }
};

// ── Inbox state ───────────────────────────────────────────
window._inboxMessages  = []; 
window._inboxAnswered  = new Set(); 

// ── Start poller ─────────────────────────────────────────
window._startInboxPoller = function() {
    if (!window.gmailToken) return;
    clearInterval(window._inboxPollInterval);
    window._checkInboxReplies();
    window._inboxPollInterval = setInterval(window._checkInboxReplies, 90000);
};

// ── Poll Gmail inbox for unread lead emails ───────────────
window._checkInboxReplies = async function() {
    if (!window.gmailToken) return;
    try {
        const allLeads = Object.values(window.state.leads).flat().filter(l => l.email);
        if (!allLeads.length) return;
        const emailMap = {};
        allLeads.forEach(l => { emailMap[l.email.toLowerCase().trim()] = l; });

        const res = await fetch(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=30&q=is:unread+in:inbox',
            { headers: { Authorization: 'Bearer ' + window.gmailToken } }
        );
        if (!res.ok) return;
        const data = await res.json();
        const messages = data.messages || []; 
        if (!messages.length) {
            window._updateInboxBadge();
            return;
        }

        const seenNotified = JSON.parse(localStorage.getItem(window.userPrefix() + 'notified_msgs') || '[]');
        let changed = false;

        for (const msg of messages.slice(0, 20)) {
            if (window._inboxAnswered.has(msg.id)) continue;
            if (window._inboxMessages.find(m => m.msgId === msg.id)) continue;

            try {
                const mRes = await fetch(
                    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
                    { headers: { Authorization: 'Bearer ' + window.gmailToken } }
                );
                if (!mRes.ok) continue;
                const mData = await mRes.json();

                const headers   = mData.payload?.headers || [];
                const fromHdr   = headers.find(h => h.name === 'From')?.value  || '';
                const subjectHdr= headers.find(h => h.name === 'Subject')?.value || '(no subject)';
                const dateHdr   = headers.find(h => h.name === 'Date')?.value   || '';

                const emailMatch = fromHdr.match(/[\w.+%-]+@[\w.-]+\.\w+/);
                if (!emailMatch) continue;
                const fromEmail = emailMatch[0].toLowerCase();

                const lead = emailMap[fromEmail];
                if (!lead) continue;

                const bodyHtml = window._extractEmailBody(mData.payload);
                const tab      = window.findLeadTab(lead.id);

                window._inboxMessages.push({
                    msgId:    msg.id,
                    threadId: mData.threadId || msg.id,
                    from:     fromHdr,
                    fromEmail,
                    subject:  subjectHdr,
                    date:     dateHdr,
                    bodyHtml: bodyHtml || mData.snippet || '(no body)',
                    leadId:   lead.id,
                    leadName: lead.name,
                    leadEmail:lead.email,
                    leadTab:  tab || 'intake',
                });

                if (!seenNotified.includes(msg.id)) {
                    window._showInboxToast(lead, subjectHdr);
                    seenNotified.push(msg.id);
                }
                changed = true;
            } catch(e) { continue; }
        }

        if (changed) {
            localStorage.setItem(window.userPrefix() + 'notified_msgs', JSON.stringify(seenNotified.slice(-200)));
        }
        window._updateInboxBadge();

        const panel = document.getElementById('inboxPanelOverlay');
        if (panel && panel.style.display !== 'none') window._renderInboxPanel();
    } catch(e) { console.warn('Inbox check error:', e.message); }
};

// ── Extract HTML body from Gmail payload ──────────────────
window._extractEmailBody = function(payload) {
    if (!payload) return '';
    if (payload.body?.data) {
        try {
            return atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
        } catch(e) {}
    }
    if (payload.parts) {
        let htmlPart = '', plainPart = '';
        const scan = parts => {
            for (const part of parts) {
                if (part.mimeType === 'text/html' && part.body?.data) {
                    try { htmlPart = atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/')); } catch(e) {}
                } else if (part.mimeType === 'text/plain' && part.body?.data) {
                    try { plainPart = atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/')); } catch(e) {}
                } else if (part.parts) { scan(part.parts); }
            }
        };
        scan(payload.parts);
        if (htmlPart) return htmlPart;
        if (plainPart) return `<pre style="white-space:pre-wrap;font-family:inherit;font-size:12px">${plainPart}</pre>`;
    }
    return '';
};

// ── Topbar badge ──────────────────────────────────────────
window._updateInboxBadge = function() {
    const unread = window._inboxMessages.filter(m => !window._inboxAnswered.has(m.msgId)).length;
    let badge = document.getElementById('inboxUnreadBadge');
    if (!badge) {
        badge = document.createElement('button');
        badge.id = 'inboxUnreadBadge';
        badge.title = 'Inbox — unread emails from leads';
        badge.onclick = () => window._openInboxPanel();
        badge.style.cssText = [
            'background:var(--danger)',
            'color:#fff',
            'border:none',
            'border-radius:20px',
            'padding:3px 10px',
            'font-size:11px',
            'font-weight:700',
            'cursor:pointer',
            'white-space:nowrap',
            'display:none',
            'animation:gentlePulse 2s ease-in-out infinite',
        ].join(';');
        const topbarRight = document.querySelector('.topbar-right');
        if (topbarRight) topbarRight.insertBefore(badge, topbarRight.firstChild);
    }
    if (unread > 0) {
        badge.textContent = `📬 ${unread} unread`;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
};

// ── Toast notification ────────────────────────────────────
window._showInboxToast = function(lead, subject) {
    const key = 'inboxtoast' + lead.id;
    if (window[key]) return;
    window[key] = true;
    setTimeout(() => delete window[key], 30000);
    const toast = document.createElement('div');
    toast.style.cssText = [
        'position:fixed',
        'bottom:84px',
        'right:24px',
        'z-index:9998',
        'background:#1e3a5f',
        'color:#fff',
        'border-radius:10px',
        'padding:12px 16px',
        'box-shadow:0 4px 20px rgba(0,0,0,0.3)',
        'max-width:300px',
        'cursor:pointer',
        'border-left:4px solid #3b82f6',
        'animation:slideUp 0.3s ease',
    ].join(';');
    toast.innerHTML = `<div style="font-weight:700;font-size:12px;margin-bottom:4px">📬 New email from ${window._escAttr(lead.name)}</div><div style="font-size:11px;opacity:0.85">${window._escAttr(subject)}</div><div style="font-size:10px;opacity:0.7;margin-top:4px">Click to read & reply</div>`;
    toast.onclick = () => { toast.remove(); window._openInboxPanel(); };
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 8000);
};

// ── Open inbox panel ──────────────────────────────────────
window._openInboxPanel = async function() {
    let overlay = document.getElementById('inboxPanelOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'inboxPanelOverlay';
        overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'background:rgba(0,0,0,0.5)',
            'z-index:2000',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'padding:16px',
        ].join(';');
        overlay.addEventListener('click', e => {
            if (e.target === overlay) window._closeInboxPanel();
        });
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    window._renderInboxPanel();
};

window._closeInboxPanel = function() {
    const overlay = document.getElementById('inboxPanelOverlay');
    if (overlay) overlay.style.display = 'none';
};

// ── Render inbox panel ────────────────────────────────────
window._activeInboxMsg = null; 
window._renderInboxPanel = async function() {
    const overlay = document.getElementById('inboxPanelOverlay');
    if (!overlay) return;
    const unread = window._inboxMessages.filter(m => !window._inboxAnswered.has(m.msgId));
    if (!unread.length) {
        overlay.innerHTML = `<div style="background:var(--card);border-radius:10px;padding:28px;max-width:480px;width:100%;box-shadow:0 12px 40px var(--shadow-lg);text-align:center"><div style="font-size:32px;margin-bottom:12px">✅</div><div style="font-size:15px;font-weight:600;color:var(--primary);margin-bottom:6px">All caught up!</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:18px">No unread emails from leads.</div><button class="btn btn-outline btn-sm" onclick="window._closeInboxPanel()">Close</button></div>`;
        window._updateInboxBadge();
        return;
    }

    if (!window._activeInboxMsg || !unread.find(m => m.msgId === window._activeInboxMsg)) {
        window._activeInboxMsg = unread[0].msgId;
    }
    const active = unread.find(m => m.msgId === window._activeInboxMsg) || unread[0];

    const sig = await window._fetchGmailSignature();
    const sigHtml = sig ? `<br><br>--<br>${sig}` : '';
    const templateOptions = (window.state.templates || [])
        .map((t,i) => `<option value="${i}">${window._escAttr(t.name)}</option>`)
        .join('');

    overlay.innerHTML = `
    <div style="background:var(--card);border-radius:10px;width:100%;max-width:880px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 12px 40px var(--shadow-lg);overflow:hidden">
      <div style="background:var(--primary);color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div style="font-size:14px;font-weight:600">📬 Inbox — ${unread.length} unread email${unread.length > 1 ? 's' : ''} from leads</div>
        <button onclick="window._closeInboxPanel()" style="background:rgba(255,255,255,.15);border:none;border-radius:6px;padding:3px 10px;color:#fff;cursor:pointer;font-size:13px">✕ Close</button>
      </div>
      <div style="display:flex;flex:1;min-height:0;overflow:hidden">
        <div style="width:240px;flex-shrink:0;border-right:1px solid var(--border);overflow-y:auto;background:var(--primary-light)">
          ${unread.map(m => {
              const isActive = m.msgId === active.msgId;
              return `<div onclick="window._selectInboxMsg('${m.msgId}')" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);background:${isActive ? 'var(--primary)' : 'transparent'};color:${isActive ? '#fff' : 'var(--text)'}">
                <div style="font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${window._escAttr(m.leadName)}</div>
                <div style="font-size:10px;opacity:0.75;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${window._escAttr(m.subject)}</div>
                <div style="font-size:10px;opacity:0.6;margin-top:1px">${(window.TAB_LABELS[m.leadTab]||m.leadTab).toUpperCase()}</div>
              </div>`;
          }).join('')}
        </div>
        <div style="flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden">
          <div style="padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--card)">
            <div style="font-size:13px;font-weight:600;color:var(--primary);margin-bottom:2px">${window._escAttr(active.subject)}</div>
            <div style="font-size:11px;color:var(--text-muted)">From: ${window._escAttr(active.from)}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:1px">${window._escAttr(active.date)}</div>
          </div>
          <div style="flex:1;overflow-y:auto;padding:14px 16px;font-size:12px;line-height:1.7;background:var(--card);min-height:0">
            <div id="inboxEmailBody" style="max-width:100%;overflow-x:auto">${active.bodyHtml}</div>
          </div>
          <div style="border-top:2px solid var(--border);padding:12px 16px;flex-shrink:0;background:var(--primary-light)">
            <div style="font-size:11px;font-weight:600;color:var(--primary);margin-bottom:8px">↩ Reply to ${window._escAttr(active.leadEmail)}</div>
            <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center">
              <select id="inboxTplSelect" style="flex:1;font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:5px;background:var(--card)">
                <option value="">— Use a template —</option>
                ${templateOptions}
              </select>
              <button onclick="window._applyInboxTemplate('${active.leadId}','${active.msgId}')" style="background:var(--primary);color:#fff;border:none;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:600">Apply</button>
            </div>
            <div style="display:flex;gap:3px;margin-bottom:6px">
              <button onclick="document.execCommand('bold')" style="border:1px solid var(--border);background:var(--card);border-radius:3px;padding:2px 8px;cursor:pointer;font-size:11px;font-weight:700">B</button>
              <button onclick="document.execCommand('italic')" style="border:1px solid var(--border);background:var(--card);border-radius:3px;padding:2px 8px;cursor:pointer;font-size:11px;font-style:italic">I</button>
              <button onclick="document.execCommand('underline')" style="border:1px solid var(--border);background:var(--card);border-radius:3px;padding:2px 8px;cursor:pointer;font-size:11px;text-decoration:underline">U</button>
              <button onclick="document.execCommand('insertUnorderedList')" style="border:1px solid var(--border);background:var(--card);border-radius:3px;padding:2px 8px;cursor:pointer;font-size:11px">• List</button>
            </div>
            <div id="inboxReplyBody" contenteditable="true" style="min-height:90px;max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:10px;font-size:12px;background:var(--card);outline:none;line-height:1.6" placeholder="Type your reply here...">${sigHtml}</div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
              <button onclick="window._markInboxRead('${active.msgId}','${active.leadId}')" style="background:var(--success-bg);color:var(--success-text);border:1px solid var(--success);border-radius:6px;padding:5px 12px;cursor:pointer;font-size:11px;font-weight:600">✓ Mark Read (no reply)</button>
              <button id="inboxSendBtn" onclick="window._sendInboxReply('${active.msgId}','${active.leadId}','${active.leadEmail.replace(/'/g, "\\'")}','${active.subject.replace(/'/g, "\\'")}','${active.threadId}')" style="background:var(--primary);color:#fff;border:none;border-radius:6px;padding:5px 16px;cursor:pointer;font-size:11px;font-weight:700">✉️ Send Reply</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;

    setTimeout(() => {
        const replyBody = document.getElementById('inboxReplyBody');
        if (replyBody) {
            replyBody.focus();
            const range = document.createRange();
            range.setStart(replyBody, 0);
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }, 80);
};

window._selectInboxMsg = function(msgId) {
    window._activeInboxMsg = msgId;
    window._renderInboxPanel();
};

window._applyInboxTemplate = async function(leadId, msgId) {
    const sel = document.getElementById('inboxTplSelect');
    if (!sel || sel.value === '') return;
    const tpl = window.state.templates[parseInt(sel.value)];
    if (!tpl) return;
    const lead = window.findLeadById(leadId);
    const replace = lead && window._buildReplacer ? window._buildReplacer(lead) : s => s;
    const sig = await window._fetchGmailSignature();
    const sigHtml = sig ? `<br><br>--<br>${sig}` : '';
    const replyBody = document.getElementById('inboxReplyBody');
    if (replyBody) replyBody.innerHTML = replace(tpl.body || '') + sigHtml;
};

window._sendInboxReply = async function(msgId, leadId, toEmail, originalSubject, threadId) {
    const replyBody = document.getElementById('inboxReplyBody');
    const btn       = document.getElementById('inboxSendBtn');
    if (!replyBody) return;
    const bodyHtml = replyBody.innerHTML.trim();
    if (!bodyHtml || bodyHtml === '<br>' || bodyHtml === '') {
        window.showSuccess('Empty Reply', 'Please type a reply or apply a template first.');
        return;
    }
    if (btn) { btn.textContent = 'Sending...'; btn.disabled = true; }
    const result = await window._sendReplyDirect(toEmail, originalSubject, bodyHtml, msgId, threadId);
    if (!result.sent) {
        if (btn) { btn.textContent = '✉️ Send Reply'; btn.disabled = false; }
        window.showSuccess('Send Failed', result.noToken ? 'Gmail not connected.' : (result.error || 'Unknown error.'));
        return;
    }

    const lead = window.findLeadById(leadId);
    const tab  = window.findLeadTab(leadId) || 'intake';
    const replySubject = originalSubject.startsWith('Re:') ? originalSubject : 'Re: ' + originalSubject;

    const entry = {
        id:       Date.now(),
        subject:  replySubject,
        sentAt:   window.nowFmt(),
        status:   'Sent',
        sentBy:   window.currentUser?.name || 'Jay',
        sequence: false,
        templateName: document.getElementById('inboxTplSelect')?.selectedOptions?.[0]?.text || 'Reply',
    };
    if (!window.state.emailHistory[leadId]) window.state.emailHistory[leadId] = [];
    window.state.emailHistory[leadId].unshift(entry);
    try { await window.api({ action: 'logEmail', leadId, entry: JSON.stringify(entry) }); } catch(e) {}

    if (lead) {
        lead.emailChk  = true;
        lead._prevFFUP = lead.ffup || '';
        lead.ffup      = window.todayMD();
        if (tab === 'intake') {
            if (lead.ffup && !lead._prevIntakeFFUP) lead._prevIntakeFFUP = lead._prevFFUP;
            lead.intakeChase = true;
        }
        try { await window.api({ action: 'updateLead', tab, lead: JSON.stringify(lead) }); } catch(e) {}
        window._patchRowDOM(tab, lead);
    }

    const eodText = `Replied to email - ${lead?.name || leadId}`;
    window.upsertTodaysEodEntry({ leadId, leadName: lead?.name || leadId, tab, newText: eodText });

    await window._markGmailRead(msgId);

    window._inboxAnswered.add(msgId);
    window._inboxMessages = window._inboxMessages.filter(m => m.msgId !== msgId);
    window._activeInboxMsg = null;

    window._updateInboxBadge();
    window._refreshTodaysFocusIfOpen();
    window.playNotifSound();
    window.showSuccess('✅ Reply Sent!', `Reply sent to ${toEmail}.`);

    window._renderInboxPanel();
};

window._markInboxRead = async function(msgId, leadId) {
    await window._markGmailRead(msgId);
    window._inboxAnswered.add(msgId);
    window._inboxMessages = window._inboxMessages.filter(m => m.msgId !== msgId);
    window._activeInboxMsg = null;
    window._updateInboxBadge();
    window._renderInboxPanel();
};

window._markGmailRead = async function(msgId) {
    if (!window.gmailToken) return;
    try {
        await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/modify`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + window.gmailToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
        });
    } catch(e) { console.warn('markGmailRead failed:', e.message); }
};

window.checkInboxReplies    = window._checkInboxReplies;
window._renderInboxBadges   = window._updateInboxBadge;
window._markAllRepliesRead  = async function() {
    for (const m of [...window._inboxMessages]) {
        await window._markGmailRead(m.msgId);
        window._inboxAnswered.add(m.msgId);
    }
    window._inboxMessages = [];
    window._updateInboxBadge();
    window._renderInboxPanel();
    window.showSuccess('Done!', 'All replies marked as read.');
};
window._showLeadReplies     = function() { window._openInboxPanel(); };
window._closeSidePanel      = function() { window._closeInboxPanel(); };
window.openReplyModal       = function(tab, id) {
    const lead = window.findLeadById(id); if (!lead) return;
    window._openInboxPanel();
};

window._replyBadgeCount = {};
window._updateReplyBadge = function(leadId, count) {
    window._replyBadgeCount[leadId] = count;
};
window._showReplyToast = function(lead) {
    if (lead) window._showInboxToast(lead, 'New message');
};
