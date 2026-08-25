// ===== CENTRALIZED STATE =====
window.USERS = {
  jay:  { key:'jay',  name:'Jay',  role:'admin', color:'#1e3a5f', initial:'J' },
  cath: { key:'cath', name:'Cath', role:'admin', color:'#be185d', initial:'C' }
};

window.currentUser = null;

window.userPrefix = function() {
  return 'bs_' + (window.currentUser?.key || 'jay') + '_';
};

window.resetState = function() {
  window.state = {
    leads: { intake:[], pc:[], star:[], o:[], dbb:[], clients:[], retainer:[], drop:[] },
    templates: [],
    attorneys: ['Binh','Faris','Samantha'],
    eod: [],
    emailHistory: {},
    sequences: {},
    scheduled: [],
    stickyNotes: [],
  };
  window.pendingMove        = null;
  window.editingTemplateIdx = null;
  window.currentEmailLeadId = null;
  window.intakeDoneLead     = null;
  window.intakeProcessingId = null;
  window.notesLeadId        = null;
  window.notesLeadTab       = null;
  window.prioTomorrowLeads  = [];
  window._pendingSaves      = new Set();
  window._localOverrides    = {}; // { leadId: { fieldName: expiresTimestamp } }
  window.intakeSortDir      = 1;
  window.sortState          = window._loadSortState();
  window.prioFilter         = window._loadPrioFilter();
  window.intakeSortState    = typeof window._loadIntakeSortState === 'function' ? window._loadIntakeSortState() : {};
  window.intakeFilter       = typeof window._loadIntakeFilter === 'function' ? window._loadIntakeFilter() : {};

  const p = window.userPrefix();
  window.SCRIPT_URL    = localStorage.getItem(p + 'script_url')  || localStorage.getItem('bs_script_url')  || '';
  window.gmailToken    = localStorage.getItem(p + 'gmail_token') || '';
  window.geminiKey     = localStorage.getItem(p + 'gemini_key')  || localStorage.getItem('bs_gemini_key')  || '';
  window.openrouterKey = localStorage.getItem(p + 'openrouter_key') || localStorage.getItem('bs_openrouter_key') || '';
  window.notifSoundUrl = localStorage.getItem(p + 'notif_sound') || localStorage.getItem('bs_notif_sound') || '';
};

window._sortStateKey  = function() { return (window.currentUser?.key || 'jay') + '_sortState'; };
window._prioFilterKey = function() { return (window.currentUser?.key || 'jay') + '_prioFilter'; };
window._loadSortState = function() {
  try { return JSON.parse(localStorage.getItem(window._sortStateKey()) || '{}'); } catch(e) { return {}; }
};
window._saveSortState = function() {
  try { localStorage.setItem(window._sortStateKey(), JSON.stringify(window.sortState)); } catch(e) {}
};
window._loadPrioFilter = function() {
  try { return JSON.parse(localStorage.getItem(window._prioFilterKey()) || '{}'); } catch(e) { return {}; }
};
window._savePrioFilter = function() {
  try { localStorage.setItem(window._prioFilterKey(), JSON.stringify(window.prioFilter)); } catch(e) {}
};

window._pollTimer      = null;
window._durationTicker = null;
window.POLL_INTERVAL_MS = 30000; // Poll every 30 seconds for real-time updates

window.resetState();