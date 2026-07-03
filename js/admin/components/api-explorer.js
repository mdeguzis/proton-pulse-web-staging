// Admin API Explorer tab (issue #186).
//
// Inspect the raw JSON a Steam endpoint returns for a game -- handy for
// debugging box art, content descriptors, and Steam Deck verdicts. Accepts an
// app ID or a game name (resolved against the search index). The actual fetch
// goes through the steam-explore edge function because Steam is CORS-blocked
// from the browser.

import { dataUrl } from '../../lib/data-url.js?v=3c2e7ac9';
import { escapeHtml } from '../utils.js?v=bd5a67c2';
import { exploreSteam } from '../api/steam-explore.js?v=536d3280';

// Reference docs for the known fields per endpoint, shown in a popup. Keep in
// sync with the pipeline (scripts/pipeline/common.py ADULT_DESCRIPTOR_IDS,
// deck_status.py DECK_CAT_MAP / DECK_DISPLAY_MAP) and the web wiki.
const FIELD_DOCS = {
  appdetails: {
    title: 'Steam appdetails',
    rows: [
      ['content_descriptors.ids', 'Developer-set content flags. We treat 3 and 4 as adult and hide those games by default. 1 = Some Nudity or Sexual Content (NOT filtered -- too broad, catches BG3 / Cyberpunk / GTA V). 2 = Frequent Violence or Gore (not filtered). 3 = Adult Only Sexual Content (adult). 4 = Frequent Nudity or Sexual Content (adult). 5 = General Mature Content (not filtered -- CS2 / Rust / DBD).'],
      ['content_descriptors.notes', 'Free-text summary of the descriptors above.'],
      ['required_age', 'Age gate on the store page. Often 0 even for genuine adult games (Steam relies on content_descriptors instead), so we do NOT use it for the adult flag.'],
      ['type', 'App kind: game / dlc / demo / music / ...'],
      ['is_free', 'Whether the app is free to play.'],
      ['header_image', 'The 460x215 box-art / header URL.'],
      ['pc_requirements.minimum / .recommended', 'Raw HTML requirement strings (rendered on the game page).'],
      ['success', 'false = app removed, region-locked, or the fetch was rate-limited -- no data returned.'],
    ],
  },
  deck: {
    title: 'Steam Deck compatibility (ajaxgetdeckappcompatibilityreport)',
    rows: [
      ['resolved_category', "Valve's overall Deck verdict. 0 = Unknown, 1 = Unsupported, 2 = Playable, 3 = Verified. This is what our badge shows."],
      ['steamos_resolved_category', 'The Proton / OS-layer status, tracked separately. Frequently 2 even when the game is overall Verified (it runs through a translation layer, not native).'],
      ['resolved_items[]', 'Per-criterion Deck-experience checks: default controller config works, controller glyphs match the Deck, interface text is legible, default graphics perform well.'],
      ['resolved_items[].display_type', '0 = Neutral / info. 1 = Incompatible / blocked (red x). 2 = Minor issue (yellow !). 3 = System pass (internal, may not show as a green bullet). 4 = Full pass (green check).'],
      ['resolved_items[].loc_token', 'The criterion identifier, e.g. #SteamDeckVerified_TestResult_InterfaceTextIsLegible.'],
      ['steamos_resolved_items[]', 'Backend Proton-layer checks (e.g. GameStartupFunctional).'],
    ],
  },
};

function _showFieldDocs(endpoint) {
  const doc = FIELD_DOCS[endpoint] || FIELD_DOCS.appdetails;
  const existing = document.getElementById('apix-fields-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'apix-fields-modal';
  modal.className = 'apix-modal-overlay';
  const rows = doc.rows
    .map((r) => `<tr><th>${escapeHtml(r[0])}</th><td>${escapeHtml(r[1])}</td></tr>`)
    .join('');
  modal.innerHTML = `
    <div class="apix-modal">
      <div class="apix-modal-head">
        <h3>Field descriptions — ${escapeHtml(doc.title)}</h3>
        <button class="apix-modal-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="apix-modal-body">
        <table class="apix-fields-table">${rows}</table>
      </div>
    </div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('.apix-modal-close')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
}

let _index = null;
async function _loadIndex() {
  if (_index) return _index;
  try {
    const r = await fetch(await dataUrl('search-index.json'));
    _index = r.ok ? await r.json() : [];
  } catch {
    _index = [];
  }
  return _index;
}

// Resolve free-text input to a Steam app id. A numeric input passes through; a
// name does a case-insensitive title match against the search index (exact
// first, then a substring match), Steam rows only.
async function _resolveAppId(input) {
  const q = String(input || '').trim();
  if (!q) return { id: null, error: 'Enter an app ID or a game name.' };
  if (/^\d+$/.test(q)) return { id: q };
  const idx = await _loadIndex();
  const ql = q.toLowerCase();
  const isSteam = (r) => Array.isArray(r) && (r[5] === 'steam' || /^\d+$/.test(String(r[0])));
  const exact = idx.find((r) => isSteam(r) && String(r[1] || '').toLowerCase() === ql);
  const match = exact || idx.find((r) => isSteam(r) && String(r[1] || '').toLowerCase().includes(ql));
  if (!match) return { id: null, error: `No Steam game matched "${q}".` };
  return { id: String(match[0]), title: String(match[1] || '') };
}

export function renderApiExplorer() {
  const el = document.getElementById('api-explorer-content');
  if (!el) return;
  el.innerHTML = `
    <div class="admin-card" style="padding:14px 16px; margin-bottom:16px">
      <div class="admin-subhead">Steam API Explorer</div>
      <p class="admin-hint" style="margin:6px 0 10px">Inspect the raw JSON a Steam endpoint returns for a game. Enter an app ID or a game name (resolved against the search index). Fetched server-side because Steam is CORS-blocked from the browser.</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
        <input id="apix-input" class="admin-input" type="text" placeholder="App ID or game name" style="flex:0 1 300px; min-width:0">
        <select id="apix-endpoint" class="admin-select" title="Which Steam endpoint to fetch">
          <option value="appdetails">appdetails (metadata + content descriptors)</option>
          <option value="deck">Steam Deck compatibility</option>
        </select>
        <button id="apix-fetch" class="admin-btn admin-btn--primary">Fetch</button>
        <button id="apix-fields" class="admin-btn" type="button" title="What the JSON fields mean">Field descriptions</button>
      </div>
      <p id="apix-status" class="admin-hint" style="margin:10px 0 0" hidden></p>
      <div id="apix-toolbar" class="apix-toolbar" hidden>
        <label class="apix-wrap-toggle"><input type="checkbox" id="apix-wrap"> Word wrap</label>
        <button id="apix-copy" class="admin-btn" type="button">Copy JSON</button>
        <button id="apix-download" class="admin-btn" type="button">Download JSON</button>
      </div>
      <pre id="apix-output" class="apix-output" hidden></pre>
    </div>`;

  // Last rendered JSON string + a filename stem, for copy / download.
  let lastJson = '';
  let lastName = 'steam';

  const setStatus = (text, isError) => {
    const s = document.getElementById('apix-status');
    if (!s) return;
    s.hidden = false;
    s.textContent = text;
    s.className = 'admin-hint' + (isError ? ' admin-error' : '');
  };

  const doFetch = async () => {
    const input = document.getElementById('apix-input')?.value || '';
    const endpoint = document.getElementById('apix-endpoint')?.value || 'appdetails';
    setStatus('Resolving...');
    const resolved = await _resolveAppId(input);
    if (!resolved.id) { setStatus(resolved.error, true); return; }
    setStatus(`Fetching ${endpoint} for app ${resolved.id}${resolved.title ? ` (${resolved.title})` : ''}...`);
    const btn = document.getElementById('apix-fetch');
    if (btn) btn.disabled = true;
    const payload = await exploreSteam(endpoint, resolved.id);
    if (btn) btn.disabled = false;
    // Show the upstream JSON if we got one, else the whole proxy payload.
    lastJson = JSON.stringify(payload && 'data' in payload ? payload.data : payload, null, 2);
    lastName = `steam-${endpoint}-${resolved.id}`;
    const out = document.getElementById('apix-output');
    if (out) { out.hidden = false; out.textContent = lastJson; }
    document.getElementById('apix-toolbar').hidden = false;
    setStatus(
      payload.ok ? `HTTP ${payload.status || 200} — ${payload.url || ''}` : `Failed: ${payload.error || 'unknown'}`,
      !payload.ok,
    );
  };

  el.querySelector('#apix-fetch')?.addEventListener('click', doFetch);
  el.querySelector('#apix-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doFetch(); }
  });
  el.querySelector('#apix-fields')?.addEventListener('click', () => {
    _showFieldDocs(document.getElementById('apix-endpoint')?.value || 'appdetails');
  });

  // Word wrap: toggle a class on the <pre> (default off -> horizontal scroll).
  el.querySelector('#apix-wrap')?.addEventListener('change', (e) => {
    document.getElementById('apix-output')?.classList.toggle('apix-wrap', e.target.checked);
  });

  el.querySelector('#apix-copy')?.addEventListener('click', async () => {
    if (!lastJson) return;
    try {
      await navigator.clipboard.writeText(lastJson);
      setStatus('Copied JSON to clipboard.');
    } catch {
      setStatus('Copy failed -- select the text and copy manually.', true);
    }
  });

  el.querySelector('#apix-download')?.addEventListener('click', () => {
    if (!lastJson) return;
    const blob = new Blob([lastJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${lastName}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}
