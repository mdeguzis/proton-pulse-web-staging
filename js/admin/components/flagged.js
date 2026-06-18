// flagged (components) for the admin page.

import { escapeHtml, fmtDateTime, friendlyReason } from '../utils.js?v=86489fcb';

const STATUS_LABELS = { open: 'Open', in_review: 'In Review', complete: 'Complete' };

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

  tbody.innerHTML = rows.map(r => {
    const appLink = `app.html#/app/${encodeURIComponent(r.app_id)}`;
    const name    = escapeHtml(r.title || `App ${r.app_id}`);
    const source  = escapeHtml(r.source || 'unknown');
    const status  = r.status || 'open';
    const statusLabel = escapeHtml(STATUS_LABELS[status] || status);
    const rowId   = escapeHtml(String(r.id));

    return `<tr data-id="${rowId}">
      <td><a href="${escapeHtml(appLink)}" target="_blank" rel="noopener" class="admin-link">${name}</a>
          <div class="admin-sub">App ${escapeHtml(String(r.app_id))}</div></td>
      <td>${source}</td>
      <td><span class="admin-status admin-status--${escapeHtml(status)}">${statusLabel}</span></td>
      <td>
        <button class="admin-btn admin-btn--sm" data-action="review-flag" data-id="${rowId}">Review</button>
      </td>
    </tr>`;
  }).join('');
}

export function renderFlagDetail(r) {
  const appLink    = `app.html#/app/${encodeURIComponent(r.app_id)}`;
  const name       = escapeHtml(r.title || `App ${r.app_id}`);
  const source     = escapeHtml(r.source || 'unknown');
  const reason     = escapeHtml(friendlyReason(r.reason_category || r.flagged_reason));
  const noteText   = r.reason_text ? escapeHtml(r.reason_text) : '';
  const reporter   = escapeHtml((r.reporter_client_id || '').slice(0, 20) || 'anonymous');
  const flaggedAt  = escapeHtml(fmtDateTime(r.flagged_at));
  const status     = r.status || 'open';
  const statusLabel = escapeHtml(STATUS_LABELS[status] || status);
  const rowId      = escapeHtml(String(r.id));

  return `
    <button class="admin-btn admin-btn--ghost admin-btn--sm" data-action="back-to-flagged" style="margin-bottom:16px">&#8592; Back</button>

    <div class="flag-detail-reason">
      <div class="flag-detail-reason-label">Flag reason</div>
      <div class="flag-detail-reason-value">${reason}</div>
      ${noteText ? `<div class="flag-detail-reason-note">${noteText}</div>` : ''}
    </div>

    <div class="flag-detail-meta">
      <div><span class="admin-label-text">Game</span>
        <a href="${escapeHtml(appLink)}" target="_blank" rel="noopener" class="admin-link">${name}</a>
        <span class="admin-sub"> (App ${escapeHtml(String(r.app_id))})</span></div>
      <div><span class="admin-label-text">Source</span> ${source}</div>
      <div><span class="admin-label-text">Reporter</span> <span class="admin-sub">${reporter}</span></div>
      <div><span class="admin-label-text">Flagged</span> ${flaggedAt}</div>
      <div><span class="admin-label-text">Status</span>
        <span class="admin-status admin-status--${escapeHtml(status)}" id="flag-detail-status">${statusLabel}</span></div>
    </div>

    <div class="flag-detail-actions">
      <button class="admin-btn admin-btn--ok" data-action="flag-set-status" data-status="open" data-id="${rowId}">Dismiss</button>
      <button class="admin-btn admin-btn--warn" data-action="flag-set-status" data-status="in_review" data-id="${rowId}">In Review</button>
      <button class="admin-btn" data-action="flag-set-status" data-status="complete" data-id="${rowId}">Complete</button>
      <button class="admin-btn admin-btn--danger" data-action="flag-delete" data-id="${rowId}">Delete</button>
    </div>`;
}
