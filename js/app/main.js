// Entry point for the app page: bootstraps routing and search wiring.
// (Replaces the inline bootstrap that lived at the top/bottom of app.js.)
import { route } from './router.js?v=740b3e34';
import { wireSearch } from './components/search.js?v=0b8cef0e';

window.addEventListener('hashchange', () => route());
window.addEventListener('popstate', () => route());

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireSearch);
} else {
  wireSearch();
}

route();

// Signal icon click popup. Called via inline onclick on each .signal-icon span.
window.__showSignalPopup = function (icon) {
  const label = icon.getAttribute('data-tip') || '';
  if (!label) return;
  let p = document.getElementById('__signal_popup');
  if (!p) {
    p = document.createElement('div');
    p.id = '__signal_popup';
    p.className = 'signal-popup';
    document.body.appendChild(p);
  }
  p.textContent = label;
  p.classList.add('visible');
  const rect = icon.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = p.offsetWidth || 180;
  const h = p.offsetHeight || 30;
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(8, Math.min(left, vw - w - 8));
  const topBelow = rect.bottom + 6;
  p.style.left = left + 'px';
  p.style.top = (topBelow + h > vh ? rect.top - h - 6 : topBelow) + 'px';
};

// Dismiss signal popup and filter panel when clicking outside them.
document.addEventListener('click', function (e) {
  if (!e.target.closest('.signal-icon')) {
    document.getElementById('__signal_popup')?.classList.remove('visible');
  }
  if (!e.target.closest('.filter-wrap')) {
    document.getElementById('filterPanel')?.classList.remove('open');
  }
});
