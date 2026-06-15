// Entry point for the app page: bootstraps routing and search wiring.
// (Replaces the inline bootstrap that lived at the top/bottom of app.js.)
import { route } from './router.js?v=4437228a';
import { wireSearch } from './components/search.js?v=d99224a7';

window.addEventListener('hashchange', () => route());
window.addEventListener('popstate', () => route());

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireSearch);
} else {
  wireSearch();
}

route();

// Signal icon click popup -- show title text in a floating card near the icon.
// Dismiss on any outside click. Hover title attribute is preserved.
(function () {
  let popup = null;

  function getOrCreatePopup() {
    if (!popup) {
      popup = document.createElement('div');
      popup.className = 'signal-popup';
      document.body.appendChild(popup);
    }
    return popup;
  }

  document.addEventListener('click', function (e) {
    const icon = e.target.closest('.signal-icon');
    const p = getOrCreatePopup();

    if (!icon) {
      p.classList.remove('visible');
      return;
    }

    const label = icon.getAttribute('title') || '';
    if (!label) return;

    p.textContent = label;
    p.classList.add('visible');

    const rect = icon.getBoundingClientRect();
    const vw = window.innerWidth;
    const popupW = p.offsetWidth || 160;
    let left = rect.left + rect.width / 2 - popupW / 2;
    left = Math.max(8, Math.min(left, vw - popupW - 8));
    const top = rect.bottom + 6;
    p.style.left = left + 'px';
    p.style.top = top + 'px';
  });
}());

// Close the filter panel when clicking outside it.
document.addEventListener('click', function (e) {
  if (!e.target.closest('.filter-wrap')) {
    document.getElementById('filterPanel')?.classList.remove('open');
  }
});
