// router (entry) for the app page. Relocated from app.js.

import { renderGamePage } from './components/game-page.js?v=117415ae';
import { renderHomePage } from './components/home.js?v=9c751f07';
import { renderSearchPage } from './components/search.js?v=0b8cef0e';

export function getRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const m = h.match(/^app\/(\d+)/);
  const q = new URLSearchParams(location.search).get('q')?.trim() || '';
  if (m) return { page: 'app', appId: m[1], query: q };
  if (q) return { page: 'search', query: q };
  return { page: 'home', query: '' };
}


export async function route() {
  const r = getRoute();
  const routeSearchInput = document.getElementById('search');
  if (routeSearchInput) {
    routeSearchInput.value = r.page === 'search' ? r.query : '';
  }
  if (r.page === 'app') await renderGamePage(r.appId);
  else if (r.page === 'search') await renderSearchPage(r.query);
  else await renderHomePage();
}
