// ===== COMPATIBILITY FIX - Missing Functions =====
// Add this file to fix "function is not a function" errors

// Fix for _updateScheduledBadge
if (typeof window._updateScheduledBadge === 'undefined') {
  window._updateScheduledBadge = function() {
    // Update scheduled email badge count
    const badge = document.getElementById('scheduledBadge');
    if (!badge) return;
    
    const count = window.state?.scheduled?.length || 0;
    
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  };
}

// Fix for _startScheduler
if (typeof window._startScheduler === 'undefined') {
  window._startScheduler = function() {
    // Check scheduled emails every minute
    if (window._schedulerInterval) {
      clearInterval(window._schedulerInterval);
    }
    
    window._schedulerInterval = setInterval(function() {
      if (!window.state?.scheduled) return;
      
      const now = Date.now();
      const toSend = window.state.scheduled.filter(s => {
        const scheduledTime = new Date(s.scheduledTime).getTime();
        return scheduledTime <= now && s.status !== 'sent';
      });
      
      toSend.forEach(async (scheduled) => {
        try {
          // Send the scheduled email
          if (window.logEmail) {
            await window.logEmail(scheduled.leadId, {
              subject: scheduled.subject,
              body: scheduled.body,
              template: scheduled.template
            });
          }

          // Stamp the lead's "Level" field with the template name that just
          // went out, so the dropdown reflects what was sent. Custom emails
          // are recorded as "Custom".
          try {
            const lead = window.findLeadById
              ? window.findLeadById(scheduled.leadId)
              : ((window.state.leads?.intake || []).find(l => l.id === scheduled.leadId));
            if (lead) {
              lead.level = scheduled.isCustom ? 'Custom' : (scheduled.template || lead.level || '');
              lead._lastTemplateToday = lead.level;
              if (window.todayMDYY) lead._lastTemplateDate = window.todayMDYY();
              // Persist
              const leadTab = scheduled.tab || (lead._tab) || 'pc';
              if (window.apiWithRetry) {
                window.apiWithRetry({ action:'updateLead', tab: leadTab, lead: JSON.stringify(lead) })
                  .catch(()=>{});
              }
              if (window._patchRowDOM) window._patchRowDOM(leadTab, lead);
            }
          } catch (e) { console.error('Level stamp failed:', e); }
          
          // Remove from scheduled list
          window.state.scheduled = window.state.scheduled.filter(s => s.id !== scheduled.id);
          
          // Update badge
          if (window._updateScheduledBadge) {
            window._updateScheduledBadge();
          }
          
          console.log('✅ Scheduled email sent:', scheduled.subject);
        } catch(e) {
          console.error('Failed to send scheduled email:', e);
        }
      });
    }, 60000); // Check every minute
    
    console.log('✅ Email scheduler started');
  };
}

// Fix for other commonly missing functions
if (typeof window.showPage === 'undefined') {
  window.showPage = function(pageId) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => {
      p.style.display = 'none';
    });
    
    // Show requested page
    const page = document.getElementById('page-' + pageId) || 
                 document.getElementById(pageId + '-page');
    if (page) {
      page.style.display = 'block';
    }
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.remove('active');
    });
    
    const navItem = document.querySelector(`[onclick*="${pageId}"]`);
    if (navItem) {
      navItem.classList.add('active');
    }
  };
}

if (typeof window.openModal === 'undefined') {
  window.openModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
    }
  };
}

if (typeof window.closeModal === 'undefined') {
  window.closeModal = function(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
  };
}

if (typeof window.showSuccess === 'undefined') {
  window.showSuccess = function(title, message) {
    // Simple toast notification
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: var(--success, #10b981);
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      font-size: 14px;
      max-width: 300px;
    `;
    
    toast.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 4px">${title}</div>
      <div style="font-size: 12px; opacity: 0.9">${message}</div>
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  };
}

if (typeof window.todayMD === 'undefined') {
  window.todayMD = function() {
    const d = new Date();
    return `${d.getMonth()+1}/${d.getDate()}`;
  };
}

if (typeof window.todayMDYY === 'undefined') {
  window.todayMDYY = function() {
    const d = new Date();
    return `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
  };
}

if (typeof window.normalizeFFUP === 'undefined') {
  window.normalizeFFUP = function(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (/^\d{1,2}\/\d{1,2}$/.test(s)) return s;
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
      const [mo, dy] = s.split('/');
      return `${parseInt(mo)}/${parseInt(dy)}`;
    }
    const d = new Date(s);
    if (!isNaN(d)) return `${d.getMonth()+1}/${d.getDate()}`;
    return s;
  };
}

// Initialize on load
document.addEventListener('DOMContentLoaded', function() {
  // Call badge update if scheduled array exists
  if (window._updateScheduledBadge) {
    window._updateScheduledBadge();
  }
  
  // Start email scheduler
  if (window._startScheduler) {
    window._startScheduler();
  }
});

console.log('✅ Compatibility fixes loaded');
