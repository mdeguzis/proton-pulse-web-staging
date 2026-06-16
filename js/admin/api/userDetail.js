// userDetail (api) for the admin page - fetches and manages a single user's data.

import { SUPABASE_URL } from '../config.js?v=ffed3d84';
import { supabaseHeaders } from '../utils.js?v=86489fcb';

export async function fetchUserReports(session, { userId, clientId }) {
  const select = 'id,app_id,title,rating,proton_version,launch_options,created_at,updated_at,is_hidden,is_flagged,source';
  let filter;
  if (userId) {
    filter = `proton_pulse_user_id=eq.${encodeURIComponent(userId)}`;
  } else if (clientId) {
    filter = `client_id=eq.${encodeURIComponent(clientId)}`;
  } else {
    return [];
  }
  const url = `${SUPABASE_URL}/rest/v1/user_configs?${filter}&select=${select}&order=created_at.desc&limit=100`;
  const res = await fetch(url, { headers: supabaseHeaders(session) });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`fetchUserReports failed (${res.status}): ${text}`);
  }
  const rows = await res.json();
  console.debug('[userDetail] fetchUserReports', { userId, clientId, count: rows.length, source: 'user_configs', filter });
  return rows;
}

export async function deleteUserReport(session, id) {
  const url = `${SUPABASE_URL}/rest/v1/user_configs?id=eq.${id}`;
  const res = await fetch(url, { method: 'DELETE', headers: supabaseHeaders(session, { Prefer: 'return=minimal' }) });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export async function hideUserReport(session, id, hidden) {
  const url = `${SUPABASE_URL}/rest/v1/user_configs?id=eq.${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: supabaseHeaders(session, { Prefer: 'return=minimal' }),
    body: JSON.stringify({ is_hidden: hidden }),
  });
  if (!res.ok) throw new Error(`Hide failed: ${res.status}`);
}

export async function editUserReport(session, id, fields) {
  const url = `${SUPABASE_URL}/rest/v1/user_configs?id=eq.${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: supabaseHeaders(session, { Prefer: 'return=minimal' }),
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`Edit failed: ${res.status}`);
}

export async function fetchUserActivity(session, { userId }) {
  if (!userId) return [];
  const select = 'id,event_type,page,metadata,created_at';
  const url = `${SUPABASE_URL}/rest/v1/site_events?proton_pulse_user_id=eq.${encodeURIComponent(userId)}&select=${select}&order=created_at.desc&limit=200`;
  const res = await fetch(url, { headers: supabaseHeaders(session) });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status);
    throw new Error(`fetchUserActivity failed (${res.status}): ${text}`);
  }
  const rows = await res.json();
  console.debug('[userDetail] fetchUserActivity', { userId, count: rows.length, source: 'site_events' });
  return rows;
}
