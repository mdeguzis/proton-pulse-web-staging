// flagged (components) for the admin page.

import { escapeHtml, fmtDateTime, friendlyReason } from '../utils.js?v=86489fcb';

export function renderFlagged(rows) {
  const loading = document.getElementById('flagged-loading');
  const empty   = document.getElementById('flagged-empty');
  const table   = document.getElementById('flagged-table');
  const tbody   = document.getElementById('flagged-tbody');

  loading.hidden = true;

  if (!rows.length) {
    empty.hidden = false;
    table.hidden = true;
    return;
  }

  empty.hidden = true;
  table.hidden = false;

  const STATUS_LABELS = { open: 'Open', in_review: 'In Review', complete: 'Complete' };

  tbody.innerHTML = rows.map(r => {
    const appLink = `app.html#/app/${encodeURIComponent(r.app_id)}`;
    const name = escapeHtml(r.title || `App ${r.app_id}`);
    const source = escapeHtml(r.source || 'unknown');
    const reporter = escapeHtml((r.reporter_client_id || '').slice(0, 12) || 'anon');
    const reason = escapeHtml(friendlyReason(r.reason_category || r.flagged_reason));
    const notesTip = r.reason_text ? ` title="${escapeHtml(r.reason_text)}"` : '';
    const status = r.status || 'open';
    const statusLabel = escapeHtml(STATUS_LABELS[status] || status);
    const flaggedAt = escapeHtml(fmtDateTime(r.flagged_at));
    const rowId = escapeHtml(String(r.id));
    const reporterClientId = escapeHtml(r.reporter_client_id || '');

    return `<tr data-id="${rowId}">
      <td><a href="${escapeHtml(appLink)}" target="_blank" rel="noopener" class="admin-link">${name}</a>
          <div class="admin-sub">App ${escapeHtml(String(r.app_id))}</div></td>
      <td>${source}</td>
      <td class="admin-sub">${reporter}</td>
      <td><span class="admin-reason"${notesTip}>${reason}</span></td>
      <td><span class="admin-status admin-status--${escapeHtml(status)}">${statusLabel}</span></td>
      <td>${flaggedAt}</td>
      <td>
        <div class="admin-actions">
          <button class="admin-btn admin-btn--sm admin-btn--ok" data-action="dismiss" data-id="${rowId}">Dismiss</button>
          <button class="admin-btn admin-btn--sm admin-btn--warn" data-action="in-review" data-id="${rowId}">In Review</button>
          <button class="admin-btn admin-btn--sm admin-btn--danger" data-action="complete" data-id="${rowId}">Complete</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}
