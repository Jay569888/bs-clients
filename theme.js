// ===== FEATURE 1: THEME CUSTOMIZER =====

window.THEME_PRESETS = {
  navy:  { label:'Navy (Default)', primary:'#1e3a5f', bg:'#f5f5f5', card:'#ffffff', text:'#1a1a1a', border:'#e5e7eb', rowHover:'#f0f7ff', searchHighlight:'#fef08a', clickHighlight:'#dbeafe', font:'Inter' },
  dark:  { label:'Dark Mode',      primary:'#3b82f6', bg:'#0f172a', card:'#1e293b', text:'#f1f5f9', border:'#334155', rowHover:'#1e3a2f', searchHighlight:'#854d0e', clickHighlight:'#1e3a5f', font:'Inter' },
  rose:  { label:'Rose',           primary:'#be185d', bg:'#fff0f6', card:'#ffffff', text:'#1a1a1a', border:'#fbcfe8', rowHover:'#fce7f3', searchHighlight:'#fef08a', clickHighlight:'#fce7f3', font:'Inter' },
  green: { label:'Forest Green',   primary:'#166534', bg:'#f0fdf4', card:'#ffffff', text:'#1a1a1a', border:'#bbf7d0', rowHover:'#dcfce7', searchHighlight:'#fef08a', clickHighlight:'#dcfce7', font:'Inter' },
  slate: { label:'Slate',          primary:'#475569', bg:'#f8fafc', card:'#ffffff', text:'#1a1a1a', border:'#e2e8f0', rowHover:'#f1f5f9', searchHighlight:'#fef08a', clickHighlight:'#e2e8f0', font:'Inter' },
};

window.FONT_OPTIONS = ['Inter','Georgia','Arial','Verdana','Trebuchet MS','Courier New','Times New Roman','Roboto','Open Sans','Lato','Helvetica'];

window._getTheme = function() {
  const saved = localStorage.getItem(window.userPrefix() + 'theme_custom');
  try { return saved ? JSON.parse(saved) : null; } catch(e) { return null; }
};

window.applyTheme = function(theme) {
  if (!theme) return;
  const root = document.documentElement;
  root.style.setProperty('--primary', theme.primary);
  // Auto-generate hover/light from primary
  root.style.setProperty('--primary-hover', window._darken(theme.primary, 15));
  root.style.setProperty('--primary-light', window._lighten(theme.primary, 92));
  root.style.setProperty('--primary-border', window._lighten(theme.primary, 75));
  root.style.setProperty('--bg', theme.bg);
  root.style.setProperty('--card', theme.card);
  root.style.setProperty('--text', theme.text);
  root.style.setProperty('--border', theme.border);
  root.style.setProperty('--row-hover', theme.rowHover);
  root.style.setProperty('--search-highlight', theme.searchHighlight || '#fef08a');
  root.style.setProperty('--click-highlight',  theme.clickHighlight  || '#dbeafe');
  if (theme.font) {
    document.body.style.fontFamily = `'${theme.font}', system-ui, sans-serif`;
  }
  // Set topbar color same as primary
  const topbar = document.querySelector('.topbar');
  if (topbar) topbar.style.background = theme.primary;
  // Dark mode text fix
  const isDark = window._luminance(theme.bg) < 0.3;
  if (isDark) {
    root.style.setProperty('--text-muted', '#94a3b8');
    root.style.setProperty('--shadow', 'rgba(0,0,0,0.3)');
    root.style.setProperty('--shadow-lg', 'rgba(0,0,0,0.5)');
  } else {
    root.style.setProperty('--text-muted', '#6b7280');
    root.style.setProperty('--shadow', 'rgba(0,0,0,0.08)');
    root.style.setProperty('--shadow-lg', 'rgba(0,0,0,0.15)');
  }
};

window.initTheme = function() {
  const saved = window._getTheme();
  if (saved) window.applyTheme(saved);
};

window.saveTheme = function() {
  const theme = {
    primary:  document.getElementById('tp-primary').value,
    bg:       document.getElementById('tp-bg').value,
    card:     document.getElementById('tp-card').value,
    text:     document.getElementById('tp-text').value,
    border:   document.getElementById('tp-border').value,
    rowHover:        document.getElementById('tp-rowHover').value,
    searchHighlight: document.getElementById('tp-searchHighlight').value,
    clickHighlight:  document.getElementById('tp-clickHighlight').value,
    font:            document.getElementById('tp-font').value,
  };
  const json = JSON.stringify(theme);
  localStorage.setItem(window.userPrefix() + 'theme_custom', json);
  window.applyTheme(theme);
  // Persist to backend so theme loads on any device/browser
  window.api({ action: 'saveMeta', themeCustom: json }).catch(() => {});
  window.showSuccess('Theme Saved!', 'Your design preferences have been applied.');
};

window.loadThemePreset = function(key) {
  const p = window.THEME_PRESETS[key];
  if (!p) return;
  document.getElementById('tp-primary').value  = p.primary;
  document.getElementById('tp-bg').value       = p.bg;
  document.getElementById('tp-card').value     = p.card;
  document.getElementById('tp-text').value     = p.text;
  document.getElementById('tp-border').value   = p.border;
  document.getElementById('tp-rowHover').value        = p.rowHover;
  document.getElementById('tp-searchHighlight').value = p.searchHighlight || '#fef08a';
  document.getElementById('tp-clickHighlight').value  = p.clickHighlight  || '#dbeafe';
  document.getElementById('tp-font').value     = p.font;
  window.saveTheme();
};

window.resetTheme = function() {
  localStorage.removeItem(window.userPrefix() + 'theme_custom');
  window.api({ action: 'saveMeta', themeCustom: '' }).catch(() => {});
  location.reload();
};

window.renderThemeSettings = function() {
  const saved = window._getTheme() || window.THEME_PRESETS.navy;
  const fields = ['primary','bg','card','text','border','rowHover','searchHighlight','clickHighlight'];
  const fieldDefaults = { searchHighlight:'#fef08a', clickHighlight:'#dbeafe' };
  fields.forEach(f => {
    const el = document.getElementById('tp-' + f);
    if (el) el.value = saved[f] || fieldDefaults[f] || '#ffffff';
  });
  const fontEl = document.getElementById('tp-font');
  if (fontEl) fontEl.value = saved.font || 'Inter';
};

// Color helpers
window._hexToRgb = function(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? [parseInt(r[1],16), parseInt(r[2],16), parseInt(r[3],16)] : [0,0,0];
};
window._luminance = function(hex) {
  const [r,g,b] = window._hexToRgb(hex).map(v => { v/=255; return v<=.03928 ? v/12.92 : Math.pow((v+.055)/1.055,2.4); });
  return .2126*r + .7152*g + .0722*b;
};
window._darken = function(hex, pct) {
  let [r,g,b] = window._hexToRgb(hex);
  r = Math.max(0, r - Math.round(255*pct/100));
  g = Math.max(0, g - Math.round(255*pct/100));
  b = Math.max(0, b - Math.round(255*pct/100));
  return '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
};
window._lighten = function(hex, pct) {
  let [r,g,b] = window._hexToRgb(hex);
  r = Math.min(255, r + Math.round((255-r)*pct/100));
  g = Math.min(255, g + Math.round((255-g)*pct/100));
  b = Math.min(255, b + Math.round((255-b)*pct/100));
  return '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
};
