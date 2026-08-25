// ===== MODAL HELPERS =====
(function() {
  // Close modal on overlay click
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal-overlay')) { 
      e.target.classList.remove('active'); 
    }
  });
  
  // Close modal/overlay on ESC key press
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      // Close active modal overlays
      const activeModal = document.querySelector('.modal-overlay.active');
      if (activeModal) {
        activeModal.classList.remove('active');
        e.preventDefault();
        return;
      }
      
      // Close edit lead overlay
      const editOverlay = document.querySelector('.edit-lead-overlay');
      if (editOverlay) {
        editOverlay.remove();
        e.preventDefault();
        return;
      }
      
      // Close context menu
      const ctxMenu = document.getElementById('ctxMenu');
      if (ctxMenu && ctxMenu.style.display !== 'none') {
        ctxMenu.style.display = 'none';
        e.preventDefault();
        return;
      }
      
      // Close chat panel
      const chatPanel = document.getElementById('chatPanel');
      if (chatPanel && chatPanel.classList.contains('open')) {
        chatPanel.classList.remove('open');
        e.preventDefault();
        return;
      }
    }
  });
})();
