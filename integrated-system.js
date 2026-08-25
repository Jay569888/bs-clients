// ===== INTEGRATED LEAD MANAGEMENT SYSTEM - PRODUCTION v3.0 =====
// Complete overhaul with all improvements applied
// Date: 2026-05-14

// ═══════════════════════════════════════════════════════════════
// 1. ERROR HANDLER - Deploy First (Catches Everything)
// ═══════════════════════════════════════════════════════════════

class ErrorHandler {
  constructor() {
    this.errorLog = [];
    this.maxLogSize = 100;
    this.notificationQueue = [];
    this.circuitBreaker = {
      failures: 0,
      threshold: 5,
      state: 'CLOSED',
      resetTimeout: 60000,
      nextAttempt: 0
    };
  }

  async handle(error, context = {}) {
    // Null-safe: callers occasionally pass null/undefined/string
    if (!error) return;
    if (!(error instanceof Error)) {
      try { error = new Error(typeof error === 'string' ? error : JSON.stringify(error)); }
      catch(e) { error = new Error('Unknown error'); }
    }
    // Log error
    const entry = {
      message: error.message || 'Unknown',
      stack: error.stack || '',
      context,
      timestamp: Date.now()
    };
    this.errorLog.push(entry);
    if (this.errorLog.length > this.maxLogSize) this.errorLog.shift();

    // Show notification
    this.queueNotification(error, context);

    // Critical error handling
    if (this.isCritical(error)) {
      this.handleCriticalError(error);
    }

    console.error('🔥 Error:', error.message, context);
  }

  isCritical(error) {
    return error && error.message && /authentication|session expired|network error|failed to fetch/i.test(error.message);
  }

  handleCriticalError(error) {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:32px;max-width:500px;box-shadow:0 20px 60px rgba(0,0,0,0.5)">
        <div style="font-size:48px;text-align:center;margin-bottom:16px">⚠️</div>
        <h2 style="margin:0 0 12px;color:#dc2626;text-align:center">Critical Error</h2>
        <p style="color:#6b7280;margin:0 0 20px;text-align:center;font-size:14px">
          ${this.getUserMessage(error)}
        </p>
        <div style="display:flex;gap:10px;justify-content:center">
          <button onclick="location.reload()" 
            style="background:#3b82f6;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-weight:600">
            Reload Page
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  getUserMessage(error) {
    if (error.message.includes('Failed to fetch')) return 'Network connection lost. Please check your internet.';
    if (error.message.includes('Authentication')) return 'Your session has expired. Please log in again.';
    return 'An unexpected error occurred. Please reload the page.';
  }

  queueNotification(error, context) {
    this.notificationQueue.push({ error, context, timestamp: Date.now() });
    clearTimeout(this.notificationTimer);
    this.notificationTimer = setTimeout(() => this.flushNotifications(), 500);
  }

  flushNotifications() {
    if (!this.notificationQueue.length) return;
    
    const error = this.notificationQueue[0].error;
    const count = this.notificationQueue.length;
    this.notificationQueue = [];

    const toast = document.createElement('div');
    toast.style.cssText = `
      position:fixed;top:80px;right:20px;background:#fee;border:1px solid #fcc;
      border-left:4px solid #dc2626;padding:16px;border-radius:8px;
      box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:9999;max-width:400px;
      animation:slideIn 0.3s ease;
    `;
    toast.innerHTML = `
      <div style="display:flex;align-items:start;gap:12px">
        <span style="font-size:20px">⚠️</span>
        <div style="flex:1">
          <div style="font-weight:600;color:#991b1b;margin-bottom:4px">
            ${count > 1 ? `${count} errors occurred` : 'Error'}
          </div>
          <div style="color:#6b7280;font-size:13px">${this.getUserMessage(error)}</div>
          <div style="color:#9ca3af;font-size:10px;margin-top:4px;font-family:monospace;word-break:break-all">${error.message || ''}</div>
        </div>
        <button onclick="this.parentElement.parentElement.remove()" 
          style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:18px;line-height:1">×</button>
      </div>`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 8000);
  }

  async executeWithRetry(fn, maxRetries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          const delay = Math.min(attempt * 1000, 10000) + Math.random() * 1000;
          console.warn(`⏳ Retry ${attempt}/${maxRetries} after ${Math.round(delay)}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  checkCircuit() {
    if (this.circuitBreaker.state === 'OPEN') {
      if (Date.now() < this.circuitBreaker.nextAttempt) {
        throw new Error('Circuit breaker OPEN - too many failures');
      }
      this.circuitBreaker.state = 'HALF_OPEN';
    }
  }

  recordSuccess() {
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.state = 'CLOSED';
  }

  recordFailure() {
    this.circuitBreaker.failures++;
    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
      this.circuitBreaker.state = 'OPEN';
      this.circuitBreaker.nextAttempt = Date.now() + this.circuitBreaker.resetTimeout;
      console.warn('🔴 Circuit breaker OPEN');
    }
  }
}

// Initialize error handler
window.errorHandler = new ErrorHandler();

// Errors and rejections we want to silently ignore (harmless noise)
const _IGNORE_ERROR_PATTERNS = [
  /favicon/i,
  /chrome-extension:/i,
  /ResizeObserver loop/i,
  /Non-Error promise rejection captured/i,
  /Script error\.?$/i,
  /Failed to load resource/i
];
function _shouldIgnoreError(msg) {
  if (!msg) return true;
  return _IGNORE_ERROR_PATTERNS.some(rx => rx.test(String(msg)));
}

// Global error handlers — null-safe (event.error can be null when the browser
// only knows about the message, and event.reason can be a string, object, or null)
window.addEventListener('error', (event) => {
  try {
    if (!event) return;
    const msg = event.message || event.error?.message || '';
    if (_shouldIgnoreError(msg)) return;
    const err = event.error instanceof Error
      ? event.error
      : new Error(msg || 'Unknown error');
    window.errorHandler.handle(err, { type: 'unhandled', source: event.filename });
  } catch(e) { console.warn('error-handler self-error', e); }
});

window.addEventListener('unhandledrejection', (event) => {
  try {
    if (!event) return;
    let reason = event.reason;
    // Normalize whatever was rejected into a proper Error
    let err;
    if (reason instanceof Error) {
      err = reason;
    } else if (reason == null) {
      // null or undefined rejection — usually harmless, ignore
      return;
    } else if (typeof reason === 'string') {
      if (_shouldIgnoreError(reason)) return;
      err = new Error(reason);
    } else if (typeof reason === 'object') {
      const msg = reason.message || reason.error || JSON.stringify(reason).slice(0, 200);
      if (_shouldIgnoreError(msg)) return;
      err = new Error(msg);
    } else {
      err = new Error(String(reason));
    }
    if (_shouldIgnoreError(err.message)) return;
    window.errorHandler.handle(err, { type: 'unhandled-promise' });
  } catch(e) { console.warn('error-handler self-error', e); }
});

// Add animation CSS
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(400px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(400px); opacity: 0; }
  }
`;
document.head.appendChild(style);

// ═══════════════════════════════════════════════════════════════
// 2. ENHANCED API LAYER - With Retry & Circuit Breaker
// ═══════════════════════════════════════════════════════════════

window.CORS_PROXY_URL = 'https://damp-darkness-be57.jasonjavier57.workers.dev';

window.setSyncStatus = function(status, text) {
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncText');
  if (dot) dot.className = 'sync-dot ' + status;
  if (txt) txt.textContent = text;
};

// Enhanced API with error handling
window.apiEnhanced = async function(params) {
  if (!window.SCRIPT_URL) {
    throw new Error('No Apps Script URL configured.');
  }

  // Check circuit breaker
  window.errorHandler.checkCircuit();

  window.setSyncStatus('syncing', 'Syncing...');

  // Sanitize dates on lead saves
  if ((params.action === 'updateLead' || params.action === 'addLead') && params.lead) {
    try {
      const lead = typeof params.lead === 'string' ? JSON.parse(params.lead) : params.lead;
      const clean = window.sanitizeLeadDates ? window.sanitizeLeadDates({...lead}) : lead;
      clean._cachedAt = Date.now();
      params = { ...params, lead: JSON.stringify(clean) };
      
      // Write-through cache for instant UI update
      if (params.tab && clean.id) {
        window._cacheWrite(params.tab, clean);
      }
    } catch(e) {
      console.warn('Date sanitization failed:', e);
    }
  }

  try {
    const sanitized = { _targetUrl: window.SCRIPT_URL };
    for (const [k, v] of Object.entries(params)) {
      sanitized[k] = (typeof v === 'object' && v !== null) ? JSON.stringify(v) : v;
    }

    const res = await fetch(window.CORS_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(sanitized),
      redirect: 'follow',
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch(e) {
      throw new Error('Invalid JSON response from server. Please re-deploy Apps Script.');
    }

    if (!data.ok) {
      throw new Error(data.error || 'API request failed');
    }

    window.setSyncStatus('ok', 'Synced ' + new Date().toLocaleTimeString());
    window.errorHandler.recordSuccess();

    // Clear cache on successful save
    if ((params.action === 'updateLead' || params.action === 'addLead') && params.tab && params.lead) {
      try {
        const lead = typeof params.lead === 'string' ? JSON.parse(params.lead) : params.lead;
        if (lead.id) window._cacheDelete(params.tab, lead.id);
      } catch(e) {}
    }

    return data;

  } catch(e) {
    window.errorHandler.recordFailure();
    const msg = e.message || '';
    
    if (msg.includes('Failed to fetch') || e.name === 'TypeError') {
      window.setSyncStatus('err', 'Network error');
    } else {
      window.setSyncStatus('err', 'Error: ' + msg.substring(0, 50));
    }
    
    throw e;
  }
};

// Safe API with automatic retry
window.safeApi = async function(params) {
  return window.errorHandler.executeWithRetry(() => window.apiEnhanced(params));
};

// Backward compatibility - replace old api() gradually
window.api = window.apiEnhanced;

// Cache functions
window._cacheKey = function(tab, leadId) {
  return `bs_cache_${window.currentUser?.key||'jay'}_${tab}_${leadId}`;
};

window._cacheWrite = function(tab, lead) {
  if (!lead || !lead.id) return;
  try {
    const clean = window.sanitizeLeadDates ? window.sanitizeLeadDates({...lead}) : {...lead};
    localStorage.setItem(window._cacheKey(tab, lead.id), JSON.stringify(clean));
  } catch(e) { /* storage full */ }
};

window._cacheRead = function(tab, leadId) {
  try {
    const s = localStorage.getItem(window._cacheKey(tab, leadId));
    return s ? JSON.parse(s) : null;
  } catch(e) { return null; }
};

window._cacheDelete = function(tab, leadId) {
  try {
    localStorage.removeItem(window._cacheKey(tab, leadId));
  } catch(e) {}
};

// Batch queue
window._batchQueue = [];
window._batchTimer = null;
window._batchDedupeMap = {};

window._queueSave = function(params) {
  // Write-through cache immediately
  if (params.action === 'updateLead' && params.lead && params.tab) {
    try {
      const lead = typeof params.lead === 'string' ? JSON.parse(params.lead) : params.lead;
      if (lead && lead.id) {
        const clean = window.sanitizeLeadDates ? window.sanitizeLeadDates({...lead}) : lead;
        clean._cachedAt = Date.now();
        window._cacheWrite(params.tab, clean);
        params = { ...params, lead: JSON.stringify(clean) };
      }
    } catch(e) {}
  }

  // Deduplicate by leadId
  if (params.action === 'updateLead' && params.lead) {
    let lead;
    try {
      lead = typeof params.lead === 'string' ? JSON.parse(params.lead) : params.lead;
    } catch(e) {}
    
    if (lead && lead.id) {
      const idx = window._batchDedupeMap[lead.id];
      if (idx !== undefined) {
        window._batchQueue[idx] = params;
        return;
      }
      window._batchDedupeMap[lead.id] = window._batchQueue.length;
    }
  }

  window._batchQueue.push(params);
  clearTimeout(window._batchTimer);
  window._batchTimer = setTimeout(window._flushBatch, 300);
};

window._flushBatch = async function() {
  if (!window._batchQueue.length) return;
  
  const toSend = [...window._batchQueue];
  window._batchQueue = [];
  window._batchDedupeMap = {};
  window._batchTimer = null;

  if (toSend.length === 1) {
    try {
      await window.safeApi(toSend[0]);
    } catch(e) {
      await window.errorHandler.handle(e, { context: 'single save' });
    }
    return;
  }

  try {
    await window.safeApi({
      action: 'batchUpdate',
      updates: JSON.stringify(toSend)
    });
  } catch(e) {
    // Batch failed - retry individually
    console.warn('Batch failed, retrying individually...');
    for (const p of toSend) {
      try {
        await window.safeApi(p);
      } catch(e2) {
        await window.errorHandler.handle(e2, { context: 'individual retry' });
      }
    }
  }
};

window._flushNow = async function() {
  clearTimeout(window._batchTimer);
  await window._flushBatch();
};

// ═══════════════════════════════════════════════════════════════
// 3. DATE UTILITIES - Fixed Timezone Issues
// ═══════════════════════════════════════════════════════════════

// BUG FIX: Normalize dates to prevent timezone drift
window.normalizeDate = function(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  
  // Already in correct format
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(s)) return s;
  
  // ISO date: 2026-05-14
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [yr, mo, dy] = s.split('-');
    return `${parseInt(mo)}/${parseInt(dy)}/${String(yr).slice(-2)}`;
  }
  
  // Parse as date
  const d = new Date(s);
  if (!isNaN(d)) {
    return `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
  }
  
  return s;
};

window.normalizeFFUP = function(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  
  // Already M/D
  if (/^\d{1,2}\/\d{1,2}$/.test(s)) return s;
  
  // M/D/YY - strip year
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [mo, dy] = s.split('/');
    return `${parseInt(mo)}/${parseInt(dy)}`;
  }
  
  // ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [, mo, dy] = s.split('-');
    return `${parseInt(mo)}/${parseInt(dy)}`;
  }
  
  const d = new Date(s);
  if (!isNaN(d)) return `${d.getMonth()+1}/${d.getDate()}`;
  
  return s;
};

// BUG FIX: Sanitize ALL date fields before saving
window.sanitizeLeadDates = function(lead) {
  if (!lead) return lead;
  
  if (lead.date) lead.date = window.normalizeDate(lead.date);
  if (lead.ffup) lead.ffup = window.normalizeFFUP(lead.ffup);
  if (lead._prevFFUP) lead._prevFFUP = window.normalizeFFUP(lead._prevFFUP);
  if (lead._prevIntakeFFUP) lead._prevIntakeFFUP = window.normalizeFFUP(lead._prevIntakeFFUP);
  
  if (lead.createdAt) {
    if (!/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(String(lead.createdAt))) {
      const d = new Date(lead.createdAt);
      if (!isNaN(d)) {
        lead.createdAt = `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
      }
    }
  }
  
  return lead;
};

window.todayMD = function() {
  const d = new Date();
  return `${d.getMonth()+1}/${d.getDate()}`;
};

window.todayMDYY = function() {
  const d = new Date();
  return `${d.getMonth()+1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
};

// ═══════════════════════════════════════════════════════════════
// 4. VIRTUAL SCROLL - Performance Optimization
// ═══════════════════════════════════════════════════════════════

class VirtualScrollTable {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.warn('Virtual scroll container not found:', containerId);
      return;
    }
    
    this.rowHeight = options.rowHeight || 42;
    this.buffer = options.buffer || 10;
    this.data = [];
    this.visibleRange = { start: 0, end: 0 };
    this.rowRenderer = options.rowRenderer;
    
    this.init();
  }

  init() {
    this.scrollContainer = document.createElement('div');
    this.scrollContainer.style.cssText = 'height:100%;overflow-y:auto;position:relative;';
    
    this.spacer = document.createElement('div');
    this.spacer.style.cssText = 'width:100%;position:relative;';
    
    this.table = document.createElement('table');
    this.table.className = 'leads-table';
    this.table.style.cssText = 'width:100%;position:absolute;top:0;left:0;';
    
    this.tbody = document.createElement('tbody');
    this.table.appendChild(this.tbody);
    
    this.spacer.appendChild(this.table);
    this.scrollContainer.appendChild(this.spacer);
    this.container.appendChild(this.scrollContainer);
    
    // Throttled scroll handler
    let scrollTimeout;
    this.scrollContainer.addEventListener('scroll', () => {
      if (scrollTimeout) return;
      scrollTimeout = setTimeout(() => {
        this.render();
        scrollTimeout = null;
      }, 16);
    });
  }

  setData(data) {
    this.data = data || [];
    this.spacer.style.height = (this.data.length * this.rowHeight) + 'px';
    this.render();
  }

  render() {
    const scrollTop = this.scrollContainer.scrollTop;
    const viewportHeight = this.scrollContainer.clientHeight;
    
    const start = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.buffer);
    const end = Math.min(
      this.data.length,
      Math.ceil((scrollTop + viewportHeight) / this.rowHeight) + this.buffer
    );

    if (start === this.visibleRange.start && end === this.visibleRange.end) {
      return;
    }

    this.visibleRange = { start, end };
    this.table.style.transform = `translateY(${start * this.rowHeight}px)`;
    
    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      if (this.data[i]) {
        fragment.appendChild(this.createRow(this.data[i], i));
      }
    }
    
    this.tbody.innerHTML = '';
    this.tbody.appendChild(fragment);
  }

  createRow(lead, index) {
    const tr = document.createElement('tr');
    tr.dataset.id = lead.id;
    tr.dataset.index = index;
    tr.style.height = this.rowHeight + 'px';
    
    if (this.rowRenderer) {
      return this.rowRenderer(lead, tr);
    }
    
    // Default renderer
    tr.innerHTML = `
      <td style="padding:8px">${this.escapeHtml(lead.name || '')}</td>
      <td style="padding:8px">${this.escapeHtml(lead.phone || '')}</td>
      <td style="padding:8px">${this.escapeHtml(lead.email || '')}</td>
    `;
    
    return tr;
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  scrollToRow(index) {
    this.scrollContainer.scrollTop = index * this.rowHeight;
  }

  findRowById(id) {
    return this.data.findIndex(lead => lead.id === id);
  }

  highlightRow(id) {
    const index = this.findRowById(id);
    if (index === -1) return;
    
    this.scrollToRow(index);
    
    setTimeout(() => {
      const row = this.tbody.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
      if (!row) return;
      
      row.style.transition = 'background 0.15s ease';
      row.style.background = '#ffe066';
      
      setTimeout(() => {
        row.style.background = '#fff3b0';
        setTimeout(() => {
          row.style.background = '';
          row.style.transition = '';
        }, 1400);
      }, 700);
    }, 100);
  }

  updateRow(id, updatedLead) {
    const index = this.findRowById(id);
    if (index === -1) return;
    
    this.data[index] = updatedLead;
    
    if (index >= this.visibleRange.start && index < this.visibleRange.end) {
      this.render();
    }
  }
}

window.VirtualScrollTable = VirtualScrollTable;
window.virtualTables = {};

// ═══════════════════════════════════════════════════════════════
// 5. UTILITY FUNCTIONS - Bug Fixes
// ═══════════════════════════════════════════════════════════════

// BUG FIX: Prevent null reference errors
window.findLeadById = function(id) {
  if (!id) return null;
  for (const t of (window.ALL_TABS || [])) {
    const leads = window.state?.leads?.[t] || [];
    const found = leads.find(l => l && l.id === id);
    if (found) return found;
  }
  return null;
};

window.findLeadTab = function(id) {
  if (!id) return null;
  for (const t of (window.ALL_TABS || [])) {
    const leads = window.state?.leads?.[t] || [];
    if (leads.find(l => l && l.id === id)) return t;
  }
  return null;
};

// BUG FIX: Safe email history access
window.getLastEmail = function(id) {
  if (!id || !window.state?.emailHistory) return null;
  const h = window.state.emailHistory[id];
  return (h && Array.isArray(h) && h.length) ? h[0] : null;
};

// BUG FIX: Calculate duration safely
window.calcDuration = function(raw) {
  if (!raw) return '—';
  
  try {
    const d = new Date(raw);
    if (isNaN(d)) return '—';
    
    const now = new Date();
    const diff = now - d;
    const days = Math.floor(diff / 86400000);
    
    if (days < 0) return '—';
    if (days < 30) return days + 'd';
    if (days < 365) {
      const mo = Math.floor(days / 30);
      const rem = days % 30;
      return mo + 'mo' + (rem > 0 ? ' ' + rem + 'd' : '');
    }
    
    const y = Math.floor(days / 365);
    const rm = Math.floor((days % 365) / 30);
    return y + 'yr' + (rm > 0 ? ' ' + rm + 'mo' : '');
  } catch(e) {
    return '—';
  }
};

// ═══════════════════════════════════════════════════════════════
// 6. INITIALIZATION & INTEGRATION
// ═══════════════════════════════════════════════════════════════

console.log('✅ Integrated System v3.0 Loaded');
console.log('   - Error Handler: Active');
console.log('   - Enhanced API: Ready');
console.log('   - Virtual Scroll: Available');
console.log('   - Date Fixes: Applied');
console.log('   - Bug Fixes: Deployed');

// Make sure old code doesn't break
if (!window.api) {
  window.api = window.apiEnhanced;
}

// Initialize on DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 System initialized');
  });
} else {
  console.log('🚀 System initialized');
}
