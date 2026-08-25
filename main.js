// ===== MAIN BOOTSTRAP =====
(function() {
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('active'); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active')); }
  });
  document.querySelectorAll('.nav-item').forEach(n => {
    n.addEventListener('keydown', e => { if (e.key === 'Enter') n.click(); });
  });
})();